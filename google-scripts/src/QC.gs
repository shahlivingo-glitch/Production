function getCuttingQcHistory() {
  return getAllRows('CuttingQC').slice(-50).reverse().map(function (r) {
    return {
      orderId: r.OrderID,
      ref: r.SheetCode,
      result: r.Result,
      failAction: r.FailAction,
      checkerId: r.CheckerID,
      timestamp: r.Timestamp
    };
  });
}

function getBendingQcHistory() {
  return getAllRows('BendingQC').slice(-50).reverse().map(function (r) {
    return {
      orderId: r.OrderID,
      ref: r.PartName,
      result: r.Result,
      failAction: r.FailAction,
      checkerId: r.CheckerID,
      timestamp: r.Timestamp
    };
  });
}

function getPendingAssemblyQC() {
  var checked = {};
  getAllRows('QCLog').filter(function (r) { return r.Stage === 'assembly'; }).forEach(function (r) {
    checked[r.OrderID] = true;
  });

  var orders = getOrdersById();
  return getAllRows('AssemblyLog').filter(function (r) {
    return r.CompletedAt && !checked[r.OrderID];
  }).map(function (r) {
    return {
      orderId: r.OrderID,
      modelNoName: r.ModelNoName,
      qty: r.Qty,
      customerName: orders[r.OrderID] ? orders[r.OrderID].CustomerName : ''
    };
  });
}

function getPendingPowderQC() {
  var checked = {};
  getAllRows('QCLog').filter(function (r) { return r.Stage === 'powder'; }).forEach(function (r) {
    checked[r.ItemRef] = true;
  });

  var orders = getOrdersById();
  return getAllRows('PowderQueue').filter(function (r) {
    return r.Status === 'done' && !checked[r.QueueID];
  }).map(function (r) {
    return {
      queueId: r.QueueID,
      orderId: r.OrderID,
      modelNoName: r.ModelNoName,
      colour: r.Colour,
      qty: r.Qty,
      customerName: orders[r.OrderID] ? orders[r.OrderID].CustomerName : ''
    };
  });
}

function getPendingFittingReturns() {
  var orders = getOrdersById();
  return getAllRows('FittingLog').filter(function (r) {
    return isActiveValue(r.ReturnedConfirmedByFitter) && !isActiveValue(r.ReturnedConfirmedByChecker);
  }).map(function (r) {
    return {
      logId: r.LogID,
      orderId: r.OrderID,
      modelNoName: r.ModelNoName,
      qty: r.Qty,
      customerName: orders[r.OrderID] ? orders[r.OrderID].CustomerName : ''
    };
  });
}

function getCheckerQueue(userId, stage) {
  requirePermission(userId, 'checker');
  if (stage === 'cutting') return getCuttingQcHistory();
  if (stage === 'bending') return getBendingQcHistory();
  if (stage === 'assembly') return getPendingAssemblyQC();
  if (stage === 'powder') return getPendingPowderQC();
  if (stage === 'fitting') return getPendingFittingReturns();
  throw new Error('Unknown stage: ' + stage);
}

function submitAssemblyQC(payload) {
  requirePermission(payload.userId, 'checker');
  var result = payload.result === 'pass' ? 'pass' : 'fail';

  appendRow('QCLog', {
    LogID: generateId('QCL'),
    OrderID: payload.orderId,
    Stage: 'assembly',
    ItemRef: payload.orderId,
    Result: result,
    FailAction: '',
    CheckerID: payload.userId,
    Timestamp: nowIso(),
    Notes: payload.notes || ''
  });

  return { orderId: payload.orderId, result: result };
}

function submitPowderQC(payload) {
  requirePermission(payload.userId, 'checker');
  var row = findRowById('PowderQueue', 'QueueID', payload.queueId);
  if (!row) {
    throw new Error('Batch not found');
  }

  var result = payload.result === 'pass' ? 'pass' : 'fail';

  appendRow('QCLog', {
    LogID: generateId('QCL'),
    OrderID: row.OrderID,
    Stage: 'powder',
    ItemRef: row.QueueID,
    Result: result,
    FailAction: '',
    CheckerID: payload.userId,
    Timestamp: nowIso(),
    Notes: payload.notes || ''
  });

  if (result === 'fail') {
    appendRow('PowderQueue', {
      QueueID: generateId('PQ'),
      OrderID: row.OrderID,
      ModelNoName: row.ModelNoName,
      Colour: row.Colour,
      Qty: row.Qty,
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
  }

  return { queueId: payload.queueId, result: result };
}
