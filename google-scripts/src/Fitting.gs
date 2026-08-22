function isPowderColourReadyForFitting(orderId, colour, passedQueueIds) {
  var rows = getAllRows('PowderQueue').filter(function (r) {
    return r.OrderID === orderId && r.Colour === colour;
  });
  return rows.some(function (r) {
    return passedQueueIds[r.QueueID];
  });
}

function effectiveFittingTarget(model, unitsFitted) {
  var base = Number(model.FittingTimeTarget) || 0;
  if (unitsFitted > 0) {
    return base;
  }
  return base + (Number(model.FittingSetupTime) || 0);
}

function completedFittingCount(orderId) {
  return getAllRows('FittingLog').filter(function (r) {
    return r.OrderID === orderId && r.CompletedAt;
  }).length;
}

function listReadyFittingOrders(userId) {
  requirePermission(userId, 'fitting');

  var passedQueueIds = {};
  getAllRows('QCLog').filter(function (r) {
    return r.Stage === 'powder' && r.Result === 'pass';
  }).forEach(function (r) {
    passedQueueIds[r.ItemRef] = true;
  });

  var results = [];
  getAllRows('Orders').forEach(function (order) {
    var alreadyFitted = completedFittingCount(order.OrderID);
    if (alreadyFitted >= Number(order.Qty)) {
      return;
    }
    var colours = Object.keys(parseJsonSafe(order.ColourPlan, {}));
    if (colours.length === 0) {
      return;
    }
    var allReady = colours.every(function (colour) {
      return isPowderColourReadyForFitting(order.OrderID, colour, passedQueueIds);
    });
    if (!allReady) {
      return;
    }

    var model = findRowById('ModelSettings', 'ModelNoName', order.ModelNoName);
    results.push({
      orderId: order.OrderID,
      modelNoName: order.ModelNoName,
      qty: order.Qty,
      unitsFitted: alreadyFitted,
      customerName: order.CustomerName,
      fittingTimeTarget: model ? effectiveFittingTarget(model, alreadyFitted) : 0
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
    kitList[item] = Number(bom[item]) || 0;
  });

  return {
    orderId: order.OrderID,
    modelNoName: order.ModelNoName,
    qty: order.Qty,
    unitsFitted: completedFittingCount(orderId),
    customerName: order.CustomerName,
    fittingTimeTarget: effectiveFittingTarget(model, completedFittingCount(orderId)),
    kitList: kitList
  };
}

function startFitting(payload) {
  requirePermission(payload.userId, 'fitting');
  var detail = getFittingOrderDetail(payload.userId, payload.orderId);

  if (detail.unitsFitted >= Number(detail.qty)) {
    throw new Error('All units for this order are already fitted');
  }

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
    Qty: 1,
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
    unitNumber: detail.unitsFitted + 1,
    totalUnits: Number(detail.qty),
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
