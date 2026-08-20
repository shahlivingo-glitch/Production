function listReadyFittingOrders(userId) {
  requirePermission(userId, 'fitting');

  var completedOrderIds = {};
  getAllRows('FittingLog').forEach(function (f) {
    if (f.CompletedAt) {
      completedOrderIds[f.OrderID] = true;
    }
  });

  var powderStatusByOrder = {};
  getAllRows('PowderQueue').forEach(function (r) {
    if (!powderStatusByOrder[r.OrderID]) {
      powderStatusByOrder[r.OrderID] = [];
    }
    powderStatusByOrder[r.OrderID].push(r.Status);
  });

  var results = [];
  getAllRows('Orders').forEach(function (order) {
    if (completedOrderIds[order.OrderID]) {
      return;
    }
    var statuses = powderStatusByOrder[order.OrderID];
    if (!statuses || statuses.length === 0) {
      return;
    }
    var allDone = statuses.every(function (s) {
      return s === 'done';
    });
    if (!allDone) {
      return;
    }

    var model = findRowById('ModelSettings', 'ModelNoName', order.ModelNoName);
    results.push({
      orderId: order.OrderID,
      modelNoName: order.ModelNoName,
      qty: order.Qty,
      customerName: order.CustomerName,
      fittingTimeTarget: model ? model.FittingTimeTarget : 0
    });
  });

  return results;
}

function getFittingOrderDetail(userId, orderId) {
  requirePermission(userId, 'fitting');
  var order = findRowById('Orders', 'OrderID', orderId);
  if (!order) {
    throw new Error('Order not found');
  }
  var model = findRowById('ModelSettings', 'ModelNoName', order.ModelNoName);
  if (!model) {
    throw new Error('Model not configured');
  }

  var bom = parseJsonSafe(model.BOM, {});
  var kitList = {};
  Object.keys(bom).forEach(function (item) {
    kitList[item] = (Number(bom[item]) || 0) * Number(order.Qty);
  });

  return {
    orderId: order.OrderID,
    modelNoName: order.ModelNoName,
    qty: order.Qty,
    customerName: order.CustomerName,
    fittingTimeTarget: model.FittingTimeTarget,
    kitList: kitList
  };
}

function startFitting(payload) {
  requirePermission(payload.userId, 'fitting');
  var detail = getFittingOrderDetail(payload.userId, payload.orderId);

  Object.keys(detail.kitList).forEach(function (item) {
    var qty = detail.kitList[item];
    var invRow = findRowById('InventoryLive', 'SKU', item);
    if (invRow) {
      updateRowById('InventoryLive', 'SKU', item, {
        CurrentStock: (Number(invRow.CurrentStock) || 0) - qty,
        LastSyncedAt: nowIso()
      });
    }
  });

  var logId = generateId('FIT');
  var startedAt = nowIso();
  appendRow('FittingLog', {
    LogID: logId,
    OrderID: detail.orderId,
    ModelNoName: detail.modelNoName,
    Qty: detail.qty,
    KitList: JSON.stringify(detail.kitList),
    ReturnedQty: '',
    ReturnedConfirmedByFitter: false,
    ReturnedConfirmedByChecker: false,
    StartedAt: startedAt,
    CompletedAt: '',
    OperatorID: payload.userId
  });

  return {
    logId: logId,
    orderId: detail.orderId,
    startedAt: startedAt,
    kitList: detail.kitList,
    fittingTimeTarget: detail.fittingTimeTarget
  };
}

function completeFitting(payload) {
  requirePermission(payload.userId, 'fitting');
  var row = findRowById('FittingLog', 'LogID', payload.logId);
  if (!row) {
    throw new Error('Fitting job not found');
  }
  if (row.CompletedAt) {
    throw new Error('Already completed');
  }

  var returnedQty = payload.returnedQty || {};

  Object.keys(returnedQty).forEach(function (item) {
    var qty = Number(returnedQty[item]) || 0;
    if (qty <= 0) {
      return;
    }
    var invRow = findRowById('InventoryLive', 'SKU', item);
    if (invRow) {
      updateRowById('InventoryLive', 'SKU', item, {
        CurrentStock: (Number(invRow.CurrentStock) || 0) + qty,
        LastSyncedAt: nowIso()
      });
    } else {
      appendRow('InventoryLive', { SKU: item, ItemName: item, CurrentStock: qty, LastSyncedAt: nowIso() });
    }
  });

  updateRowById('FittingLog', 'LogID', payload.logId, {
    ReturnedQty: JSON.stringify(returnedQty),
    ReturnedConfirmedByFitter: true,
    CompletedAt: nowIso()
  });

  return { logId: payload.logId, orderId: row.OrderID };
}

function confirmFittingReturnByChecker(payload) {
  requirePermission(payload.userId, 'checker');
  var row = findRowById('FittingLog', 'LogID', payload.logId);
  if (!row) {
    throw new Error('Fitting job not found');
  }

  updateRowById('FittingLog', 'LogID', payload.logId, {
    ReturnedConfirmedByChecker: true
  });

  appendRow('QCLog', {
    LogID: generateId('QCL'),
    OrderID: row.OrderID,
    Stage: 'fitting',
    ItemRef: row.OrderID,
    Result: 'pass',
    FailAction: '',
    CheckerID: payload.userId,
    Timestamp: nowIso(),
    Notes: 'Return confirmed'
  });

  return { logId: payload.logId };
}
