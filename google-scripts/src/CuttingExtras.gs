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
  if (payload.type === 'extra-sheet') {
    var partsProduced = details.partsProduced || {};
    Object.keys(partsProduced).forEach(function (partName) {
      addToExtraPartInventory(order.ModelName, partName, '', Number(partsProduced[partName]) || 0);
    });
  } else {
    var inventoryModel = order.ModelName;
    if (details.isExtra) {
      inventoryModel = details.isUniversal ? UNIVERSAL_MODEL_TAG : (details.modelName || order.ModelName);
    }
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
