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
function addCuttingExtra(payload) {
  var order = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!order) {
    throw new Error('PO not found: ' + payload.poNumber);
  }
  if (payload.type !== 'extra-sheet' && payload.type !== 'extra-part') {
    throw new Error('Unknown extra type: ' + payload.type);
  }
  var extraId = generateId('EX');
  appendRow('CuttingExtras', {
    ExtraId: extraId,
    PoNumber: payload.poNumber,
    Type: payload.type,
    Details: JSON.stringify(payload.details || {}),
    Timestamp: nowIso()
  });

  var details = payload.details || {};
  var addToInventory = !!payload.addToInventory;
  if (payload.type === 'extra-sheet') {
    if (addToInventory) {
      var partsProduced = details.partsProduced || {};
      Object.keys(partsProduced).forEach(function (partName) {
        addToExtraPartInventory(order.ModelName, partName, '', Number(partsProduced[partName]) || 0);
      });
    }
    // one scrap/extra sheet was physically consumed
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
  }

  return { extraId: extraId };
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
        timestamp: r.Timestamp
      };
    })
    .sort(function (a, b) { return a.timestamp < b.timestamp ? -1 : 1; });
}
