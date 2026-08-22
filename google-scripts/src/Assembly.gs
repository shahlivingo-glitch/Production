function getAllRequiredParts(model) {
  var partsPerSheet = parseJsonSafe(model.PartsPerSheet, {});
  var set = {};
  Object.keys(partsPerSheet).forEach(function (sheetCode) {
    var partsMap = partsForSheet(partsPerSheet, sheetCode);
    Object.keys(partsMap).forEach(function (part) {
      set[part] = true;
    });
  });
  return Object.keys(set);
}

function perUnitQtyForPart(model, partName) {
  var partsPerSheet = parseJsonSafe(model.PartsPerSheet, {});
  var total = 0;
  Object.keys(partsPerSheet).forEach(function (sheetCode) {
    var partsMap = partsForSheet(partsPerSheet, sheetCode);
    if (partsMap[partName]) {
      total += Number(partsMap[partName]) || 0;
    }
  });
  return total;
}

function completedAssemblyCount(orderId) {
  return getAllRows('AssemblyLog').filter(function (r) {
    return r.OrderID === orderId && r.CompletedAt;
  }).length;
}

function unitsReadyForAssembly(order, model) {
  var requiredParts = getAllRequiredParts(model);
  if (requiredParts.length === 0) {
    return 0;
  }
  var alreadyAssembled = completedAssemblyCount(order.OrderID);
  var minUnits = null;
  requiredParts.forEach(function (part) {
    var perUnit = perUnitQtyForPart(model, part);
    if (!perUnit) {
      return;
    }
    var totalPassed = totalPassedBendingQtyForPart(order.OrderID, part);
    var unitsFromThisPart = Math.floor(totalPassed / perUnit);
    if (minUnits === null || unitsFromThisPart < minUnits) {
      minUnits = unitsFromThisPart;
    }
  });
  if (minUnits === null) {
    return 0;
  }
  return Math.max(0, minUnits - alreadyAssembled);
}

function listReadyAssemblyOrders(userId) {
  requirePermission(userId, 'assembly');

  var results = [];
  getAllRows('Orders').forEach(function (order) {
    var model = findRowById('ModelSettings', 'ModelNoName', order.ModelNoName);
    if (!model) {
      return;
    }
    var alreadyAssembled = completedAssemblyCount(order.OrderID);
    if (alreadyAssembled >= Number(order.Qty)) {
      return;
    }
    var ready = unitsReadyForAssembly(order, model);
    if (ready <= 0) {
      return;
    }
    results.push({
      orderId: order.OrderID,
      modelNoName: order.ModelNoName,
      qty: order.Qty,
      unitsReady: ready,
      unitsAssembled: alreadyAssembled,
      customerName: order.CustomerName,
      assemblyTimeTarget: model.AssemblyTimeTarget
    });
  });

  return results;
}

function getAssemblyOrderDetail(userId, orderId) {
  requirePermission(userId, 'assembly');
  var order = findRowById('Orders', 'OrderID', orderId);
  if (!order) {
    throw new Error('Order not found');
  }
  var model = findRowById('ModelSettings', 'ModelNoName', order.ModelNoName);
  if (!model) {
    throw new Error('Model not configured');
  }

  var bom = parseJsonSafe(model.BOM, {});
  var plannedBOM = {};
  var shortages = [];

  Object.keys(bom).forEach(function (item) {
    var needed = Number(bom[item]) || 0;
    plannedBOM[item] = needed;
    var invRow = findRowById('InventoryLive', 'SKU', item);
    var available = invRow ? Number(invRow.CurrentStock) || 0 : 0;
    if (available < needed) {
      shortages.push({ item: item, needed: needed, available: available });
    }
  });

  return {
    orderId: order.OrderID,
    modelNoName: order.ModelNoName,
    qty: order.Qty,
    unitsAssembled: completedAssemblyCount(orderId),
    unitsReady: unitsReadyForAssembly(order, model),
    customerName: order.CustomerName,
    assemblyTimeTarget: model.AssemblyTimeTarget,
    plannedBOM: plannedBOM,
    shortages: shortages
  };
}

function startAssembly(payload) {
  requirePermission(payload.userId, 'assembly');
  var detail = getAssemblyOrderDetail(payload.userId, payload.orderId);

  if (detail.unitsReady <= 0) {
    throw new Error('No units ready to assemble yet');
  }

  var logId = generateId('ASM');
  var startedAt = nowIso();
  appendRow('AssemblyLog', {
    LogID: logId,
    OrderID: detail.orderId,
    ModelNoName: detail.modelNoName,
    Qty: 1,
    PlannedBOM: JSON.stringify(detail.plannedBOM),
    ActualBOM: '',
    InventoryShortageFlag: detail.shortages.length > 0,
    StartedAt: startedAt,
    CompletedAt: '',
    OperatorID: payload.userId
  });

  return {
    logId: logId,
    orderId: detail.orderId,
    unitNumber: detail.unitsAssembled + 1,
    totalUnits: Number(detail.qty),
    startedAt: startedAt,
    plannedBOM: detail.plannedBOM,
    shortages: detail.shortages,
    assemblyTimeTarget: detail.assemblyTimeTarget
  };
}

function completeAssembly(payload) {
  requirePermission(payload.userId, 'assembly');
  var row = findRowById('AssemblyLog', 'LogID', payload.logId);
  if (!row) {
    throw new Error('Assembly not found');
  }
  if (row.CompletedAt) {
    throw new Error('Already completed');
  }

  var actualBOM = payload.actualBOM || {};
  var shortages = [];

  Object.keys(actualBOM).forEach(function (item) {
    var qtyUsed = Number(actualBOM[item]) || 0;
    var invRow = findRowById('InventoryLive', 'SKU', item);
    if (invRow) {
      var newStock = (Number(invRow.CurrentStock) || 0) - qtyUsed;
      updateRowById('InventoryLive', 'SKU', item, { CurrentStock: newStock, LastSyncedAt: nowIso() });
      if (newStock < 0) {
        shortages.push(item);
      }
    } else {
      shortages.push(item);
    }
  });

  updateRowById('AssemblyLog', 'LogID', payload.logId, {
    ActualBOM: JSON.stringify(actualBOM),
    InventoryShortageFlag: shortages.length > 0,
    CompletedAt: nowIso()
  });

  var order = findRowById('Orders', 'OrderID', row.OrderID);
  var totalCompleted = completedAssemblyCount(row.OrderID);
  var isLastUnit = !!(order && totalCompleted >= Number(order.Qty));
  var powderQueued = 0;

  if (isLastUnit) {
    var alreadyQueued = getAllRows('PowderQueue').some(function (r) {
      return r.OrderID === row.OrderID;
    });
    if (!alreadyQueued) {
      var colourPlan = parseJsonSafe(order.ColourPlan, {});
      Object.keys(colourPlan).forEach(function (colour) {
        appendRow('PowderQueue', {
          QueueID: generateId('PQ'),
          OrderID: row.OrderID,
          ModelNoName: row.ModelNoName,
          Colour: colour,
          Qty: colourPlan[colour],
          Status: 'pending',
          PlannedPowderKg: '',
          ActualPowderKg: '',
          FromMainStockKg: '',
          FromPersonalStockKg: '',
          LeftoverKg: '',
          OperatorID: '',
          StartedAt: '',
          CompletedAt: ''
        });
        powderQueued++;
      });
    }
  }

  return {
    logId: payload.logId,
    orderId: row.OrderID,
    shortages: shortages,
    unitsCompleted: totalCompleted,
    totalUnits: order ? Number(order.Qty) : 0,
    isLastUnit: isLastUnit,
    powderQueued: powderQueued
  };
}
