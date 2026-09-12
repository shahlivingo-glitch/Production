var UNIVERSAL_MODEL_TAG = 'Universal';

function addToExtraPartInventory(modelName, partName, size, qty) {
  if (!partName || !qty) {
    return;
  }
  var matchFn = function (r) {
    return String(r.ModelName) === String(modelName) &&
      String(r.PartName) === String(partName) &&
      String(r.Size || '') === String(size || '');
  };
  var existing = findRow('ExtraPartInventory', matchFn);
  if (existing) {
    updateRow('ExtraPartInventory', matchFn, {
      Qty: (Number(existing.Qty) || 0) + qty,
      UpdatedAt: nowIso()
    });
  } else {
    appendRow('ExtraPartInventory', {
      ModelName: modelName,
      PartName: partName,
      Size: size || '',
      Qty: qty,
      UpdatedAt: nowIso()
    });
  }
}

function getExtraPartInventoryQty(modelName, partName, size) {
  if (!partName) return 0;
  var row = findRow('ExtraPartInventory', function (r) {
    return String(r.ModelName) === String(modelName) &&
      String(r.PartName) === String(partName) &&
      String(r.Size || '') === String(size || '');
  });
  return row ? (Number(row.Qty) || 0) : 0;
}

// { partName: qty } of leftover-ledger stock already sitting for `modelName`,
// for every non-extra part referenced anywhere in `sheets` (extras are
// excluded - they're never auto-posted to the ledger either, see
// applyCutStockAndLedger). Purely a read - used for Cutting Stage's
// "already available in leftover stock" badge, which never changes the
// cutting output itself. Only includes parts that actually have stock, so
// the frontend can just check `leftoverByPart[partName]`.
function getLeftoverByPartForSheets(modelName, sheets) {
  var names = {};
  (sheets || []).forEach(function (sheet) {
    (sheet.outputs || []).forEach(function (o) {
      if (!o.isExtra && o.partName) names[o.partName] = true;
    });
  });
  var out = {};
  Object.keys(names).forEach(function (partName) {
    var qty = getExtraPartInventoryQty(modelName, partName, '');
    if (qty > 0) out[partName] = qty;
  });
  return out;
}

// Consumes up to `qty` units of a part's leftover stock (floored at 0 - a
// missing/empty row just means nothing to consume). Used when Bending marks
// an entry done and that part already has surplus sitting in the ledger, so
// it isn't offered again for a later order. Returns how much was actually
// consumed (<= qty, may be 0).
function consumeExtraPartInventory(modelName, partName, size, qty) {
  if (!partName || !(qty > 0)) return 0;
  var matchFn = function (r) {
    return String(r.ModelName) === String(modelName) &&
      String(r.PartName) === String(partName) &&
      String(r.Size || '') === String(size || '');
  };
  var existing = findRow('ExtraPartInventory', matchFn);
  var available = existing ? (Number(existing.Qty) || 0) : 0;
  if (available <= 0) return 0;
  var consumed = Math.min(available, qty);
  updateRow('ExtraPartInventory', matchFn, { Qty: available - consumed, UpdatedAt: nowIso() });
  return consumed;
}

// Which ExtraPartInventory "model" bucket a logged extra part belongs to -
// shared between addCuttingExtra (posting to it) and the Bending queue
// (checking/consuming it), so both always agree on the same ledger row.
function resolveExtraInventoryModel(orderModelName, details) {
  if (!details.isExtra) return orderModelName;
  return details.isUniversal ? UNIVERSAL_MODEL_TAG : (details.modelName || orderModelName);
}

// payload.addToInventory: whether this logged extra should ALSO be posted
// to the Leftover Ledger, on top of becoming its own Bending task (see
// getExtraBendingEntries in Bending.gs) - an explicit choice now, not
// automatic, since the part's already accounted for via that bending task
// either way. Independent of the extra-sheet's raw stock deduction below,
// which always happens since a sheet really was cut regardless.
//
// AddedToInventory (JSON { "<partName-or-'main'>": true }) records which
// part(s) from this log have already been posted - checked here so the
// second-chance "Add to Extra Part Inventory" button in Bending Stage
// (addExtraToInventoryNow) knows not to double-post one already added here.
// 'main' is the key for an extra-part log (always exactly one part); an
// extra-sheet log uses the actual partName since it can log several.
function addCuttingExtra(payload) {
  var order = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!order) {
    throw new Error('PO not found: ' + payload.poNumber);
  }
  if (payload.type !== 'extra-sheet' && payload.type !== 'extra-part') {
    throw new Error('Unknown extra type: ' + payload.type);
  }
  var extraId = generateId('EX');
  var details = payload.details || {};
  var addToInventory = !!payload.addToInventory;
  var addedMap = {};

  if (payload.type === 'extra-sheet') {
    if (addToInventory) {
      var partsProduced = details.partsProduced || {};
      Object.keys(partsProduced).forEach(function (partName) {
        addToExtraPartInventory(order.ModelName, partName, '', Number(partsProduced[partName]) || 0);
        addedMap[partName] = true;
      });
    }
    // one scrap/extra sheet was physically consumed - independent of the
    // inventory choice, a real sheet was cut either way
    try {
      applySheetStockDelta(
        details.width, details.height, details.thickness,
        -1, 'extra-sheet-cut', payload.poNumber, 'Extra Sheet Cut'
      );
    } catch (err) {
      // best-effort: never block logging the extra
    }
  } else if (addToInventory) {
    var inventoryModel = resolveExtraInventoryModel(order.ModelName, details);
    addToExtraPartInventory(inventoryModel, details.partName, details.size || '', Number(details.qty) || 0);
    addedMap.main = true;
  }

  appendRow('CuttingExtras', {
    ExtraId: extraId,
    PoNumber: payload.poNumber,
    Type: payload.type,
    Details: JSON.stringify(details),
    Timestamp: nowIso(),
    AddedToInventory: JSON.stringify(addedMap)
  });

  return { extraId: extraId };
}

// The Bending Stage "second chance" action: post a logged extra (or one
// part of an extra-sheet log) to the Leftover Ledger now, for whoever
// didn't check "Also add to Extra Part Inventory" at logging time. extraKey
// matches getExtraBendingEntries' own key shape - the bare ExtraId for an
// extra-part log, or "ExtraId:partName" for one part of an extra-sheet log.
// Refuses if that specific part was already added (either at logging time
// or via a previous call here) - AddedToInventory is the single source of
// truth either way, so the two paths can never double-post the same part.
function addExtraToInventoryNow(payload) {
  var poNumber = String(payload.poNumber || '');
  var extraKey = String(payload.extraKey || '');
  var sepIdx = extraKey.indexOf(':');
  var extraId = sepIdx === -1 ? extraKey : extraKey.substring(0, sepIdx);
  var partNameFromKey = sepIdx === -1 ? null : extraKey.substring(sepIdx + 1);

  var extraRow = findRow('CuttingExtras', function (r) {
    return String(r.PoNumber) === poNumber && String(r.ExtraId) === extraId;
  });
  if (!extraRow) {
    throw new Error('Logged extra not found: ' + extraKey);
  }
  var order = findRowById('Orders', 'PoNumber', poNumber);
  if (!order) {
    throw new Error('PO not found: ' + poNumber);
  }

  var addedMap = parseJsonSafe(extraRow.AddedToInventory, {});
  var mapKey = partNameFromKey || 'main';
  if (addedMap[mapKey]) {
    throw new Error('Already added to Extra Part Inventory.');
  }

  var d = parseJsonSafe(extraRow.Details, {});
  var partName, qty, size, inventoryModel;
  if (extraRow.Type === 'extra-part') {
    partName = d.partName;
    qty = Number(d.qty) || 0;
    size = d.size || '';
    inventoryModel = resolveExtraInventoryModel(order.ModelName, d);
  } else if (extraRow.Type === 'extra-sheet' && partNameFromKey) {
    var produced = d.partsProduced || {};
    partName = partNameFromKey;
    qty = Number(produced[partNameFromKey]) || 0;
    size = '';
    inventoryModel = order.ModelName;
  }
  if (!partName || !(qty > 0)) {
    throw new Error('Nothing to add for ' + extraKey);
  }

  addToExtraPartInventory(inventoryModel, partName, size, qty);
  addedMap[mapKey] = true;
  writeRowUpdates('CuttingExtras', extraRow._rowIndex, { AddedToInventory: JSON.stringify(addedMap) });
  return { extraKey: extraKey, added: true };
}

function listExtraPartInventory() {
  return getAllRows('ExtraPartInventory').map(function (r) {
    return {
      modelName: String(r.ModelName),
      partName: String(r.PartName),
      size: r.Size || '',
      qty: Number(r.Qty) || 0,
      updatedAt: r.UpdatedAt
    };
  }).sort(function (a, b) {
    if (a.modelName !== b.modelName) return a.modelName < b.modelName ? -1 : 1;
    return a.partName < b.partName ? -1 : (a.partName > b.partName ? 1 : 0);
  });
}

function listKnownExtraParts() {
  var byName = {};
  getAllRows('CuttingExtras').forEach(function (r) {
    if (r.Type !== 'extra-part') {
      return;
    }
    var details = parseJsonSafe(r.Details, {});
    if (!details.isExtra || !details.partName) {
      return;
    }
    var key = String(details.partName).toLowerCase();
    var existing = byName[key];
    if (!existing || String(r.Timestamp) > String(existing.timestamp)) {
      byName[key] = { partName: details.partName, size: details.size || '', timestamp: r.Timestamp };
    }
  });
  return Object.keys(byName).map(function (key) {
    return { partName: byName[key].partName, size: byName[key].size };
  }).sort(function (a, b) {
    return a.partName < b.partName ? -1 : (a.partName > b.partName ? 1 : 0);
  });
}

function listCuttingExtras(poNumber) {
  return getAllRows('CuttingExtras')
    .filter(function (r) { return String(r.PoNumber) === String(poNumber); })
    .map(function (r) {
      return {
        extraId: String(r.ExtraId),
        poNumber: String(r.PoNumber),
        type: r.Type,
        details: parseJsonSafe(r.Details, {}),
        timestamp: r.Timestamp,
        addedToInventory: parseJsonSafe(r.AddedToInventory, {})
      };
    })
    .sort(function (a, b) { return a.timestamp < b.timestamp ? -1 : 1; });
}
