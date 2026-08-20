function getAllRequiredParts(model) {
  var partsPerSheet = parseJsonSafe(model.PartsPerSheet, {});
  var set = {};
  Object.keys(partsPerSheet).forEach(function (sheetCode) {
    (partsPerSheet[sheetCode] || []).forEach(function (part) {
      set[part] = true;
    });
  });
  return Object.keys(set);
}

function isPartReadyForAssembly(orderId, partName) {
  var qcRows = getAllRows('BendingQC').filter(function (r) {
    return r.OrderID === orderId && r.PartName === partName;
  });
  return qcRows.some(function (qc) {
    return qc.Result === 'pass' || qc.FailAction === 'continue';
  });
}

function listReadyAssemblyOrders(userId) {
  requirePermission(userId, 'assembly');

  var completedOrderIds = {};
  getAllRows('AssemblyLog').forEach(function (a) {
    if (a.CompletedAt) {
      completedOrderIds[a.OrderID] = true;
    }
  });

  var results = [];
  getAllRows('Orders').forEach(function (order) {
    if (completedOrderIds[order.OrderID]) {
      return;
    }
    var model = findRowById('ModelSettings', 'ModelNoName', order.ModelNoName);
    if (!model) {
      return;
    }
    var requiredParts = getAllRequiredParts(model);
    if (requiredParts.length === 0) {
      return;
    }
    var allReady = requiredParts.every(function (part) {
      return isPartReadyForAssembly(order.OrderID, part);
    });
    if (!allReady) {
      return;
    }
    results.push({
      orderId: order.OrderID,
      modelNoName: order.ModelNoName,
      qty: order.Qty,
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
    var needed = (Number(bom[item]) || 0) * Number(order.Qty);
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
    customerName: order.CustomerName,
    assemblyTimeTarget: model.AssemblyTimeTarget,
    plannedBOM: plannedBOM,
    shortages: shortages
  };
}

function startAssembly(payload) {
  requirePermission(payload.userId, 'assembly');
  var detail = getAssemblyOrderDetail(payload.userId, payload.orderId);

  var logId = generateId('ASM');
  var startedAt = nowIso();
  appendRow('AssemblyLog', {
    LogID: logId,
    OrderID: detail.orderId,
    ModelNoName: detail.modelNoName,
    Qty: detail.qty,
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

  return { logId: payload.logId, orderId: row.OrderID, shortages: shortages };
}
