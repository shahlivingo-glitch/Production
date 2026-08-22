function bendingTargetForPart(model, partName) {
  if (!model) {
    return 0;
  }
  var targets = parseJsonSafe(model.BendingTimeTargets, {});
  return Number(targets[String(partName)]) || 0;
}

function getBendingQueue(userId) {
  requirePermission(userId, 'bending');

  var rows = getAllRows('BendingQueue').filter(function (r) {
    return r.Status === 'unlocked' || (r.Status === 'in-progress' && r.OperatorID === userId);
  });

  rows.sort(function (a, b) {
    return Number(a.Priority) - Number(b.Priority);
  });

  var mine = rows.filter(function (r) {
    return r.Status === 'in-progress' && r.OperatorID === userId;
  });
  var next = mine.length ? mine[0] : rows[0];
  if (!next) {
    return null;
  }

  var order = findRowById('Orders', 'OrderID', next.OrderID);
  var model = order ? findRowById('ModelSettings', 'ModelNoName', order.ModelNoName) : null;

  return {
    queueId: next.QueueID,
    orderId: next.OrderID,
    partName: next.PartName,
    sheetCode: next.SheetCode,
    qty: next.Qty,
    status: next.Status,
    startedAt: next.StartedAt,
    customerName: order ? order.CustomerName : '',
    modelNoName: order ? order.ModelNoName : '',
    bendingTimeTarget: bendingTargetForPart(model, next.PartName)
  };
}

function startBendingPart(payload) {
  requirePermission(payload.userId, 'bending');
  var row = findRowById('BendingQueue', 'QueueID', payload.queueId);
  if (!row) {
    throw new Error('Part not found');
  }
  if (row.Status !== 'unlocked') {
    throw new Error('Part is not unlocked');
  }
  updateRowById('BendingQueue', 'QueueID', payload.queueId, {
    Status: 'in-progress',
    StartedAt: nowIso(),
    OperatorID: payload.userId
  });
  return { queueId: payload.queueId };
}

function completeBendingPart(payload) {
  requirePermission(payload.userId, 'bending');
  var row = findRowById('BendingQueue', 'QueueID', payload.queueId);
  if (!row) {
    throw new Error('Part not found');
  }
  if (row.Status !== 'in-progress') {
    throw new Error('Part is not in progress');
  }

  var order = findRowById('Orders', 'OrderID', row.OrderID);
  var model = order ? findRowById('ModelSettings', 'ModelNoName', order.ModelNoName) : null;
  var qty = Number(row.Qty) || 0;
  var target = bendingTargetForPart(model, row.PartName) * qty;
  var startedAt = new Date(row.StartedAt).getTime();
  var completedAt = new Date();
  var actualMinutes = (completedAt.getTime() - startedAt) / 60000;
  var points = computeSpeedPoints(target, actualMinutes);

  updateRowById('BendingQueue', 'QueueID', payload.queueId, {
    Status: 'done',
    CompletedAt: completedAt.toISOString(),
    Points: points
  });

  return {
    queueId: payload.queueId,
    orderId: row.OrderID,
    partName: row.PartName,
    sheetCode: row.SheetCode,
    qty: row.Qty,
    expectedQty: row.Qty,
    points: points,
    actualMinutes: Math.round(actualMinutes * 10) / 10
  };
}

function submitBendingQC(payload) {
  requirePermission(payload.userId, 'bending');
  var row = findRowById('BendingQueue', 'QueueID', payload.queueId);
  if (!row) {
    throw new Error('Part not found');
  }

  var result = payload.result === 'pass' ? 'pass' : 'fail';
  var failAction = result === 'fail' ? payload.failAction : '';

  appendRow('BendingQC', {
    QCID: generateId('BQC'),
    OrderID: row.OrderID,
    PartName: row.PartName,
    SheetCode: row.SheetCode,
    CheckedQty: Number(payload.checkedQty) || 0,
    ExpectedQty: Number(payload.expectedQty) || 0,
    Result: result,
    FailAction: failAction,
    CheckerID: payload.userId,
    Timestamp: nowIso()
  });

  appendRow('QCLog', {
    LogID: generateId('QCL'),
    OrderID: row.OrderID,
    Stage: 'bending',
    ItemRef: row.QueueID,
    Result: result,
    FailAction: failAction,
    CheckerID: payload.userId,
    Timestamp: nowIso(),
    Notes: payload.notes || ''
  });

  if (failAction === 'recut') {
    appendRow('BendingQueue', {
      QueueID: generateId('BQ'),
      OrderID: row.OrderID,
      PartName: row.PartName,
      SheetCode: row.SheetCode,
      Qty: row.Qty,
      Status: 'unlocked',
      Priority: new Date().getTime(),
      StartedAt: '',
      CompletedAt: '',
      OperatorID: '',
      Points: ''
    });
  }

  return { result: result, failAction: failAction };
}

function listUnlockedBendingQueue(userId) {
  requirePermission(userId, 'bending');
  var rows = getAllRows('BendingQueue').filter(function (r) {
    return r.Status === 'unlocked';
  });
  rows.sort(function (a, b) {
    return Number(a.Priority) - Number(b.Priority);
  });
  return rows.map(function (r) {
    return {
      queueId: r.QueueID,
      orderId: r.OrderID,
      partName: r.PartName,
      sheetCode: r.SheetCode,
      qty: r.Qty,
      priority: r.Priority
    };
  });
}

function reorderBendingQueue(payload) {
  requirePermission(payload.userId, 'bending');
  var orderedIds = payload.orderedQueueIds || [];
  orderedIds.forEach(function (queueId, index) {
    updateRowById('BendingQueue', 'QueueID', queueId, { Priority: (index + 1) * 1000 });
  });
  return { reordered: orderedIds.length };
}

function totalPassedBendingQtyForPart(orderId, partName) {
  var passedQueueIds = {};
  getAllRows('QCLog').filter(function (r) {
    return r.Stage === 'bending' && (r.Result === 'pass' || r.FailAction === 'continue');
  }).forEach(function (r) {
    passedQueueIds[r.ItemRef] = true;
  });

  return getAllRows('BendingQueue').filter(function (r) {
    return r.OrderID === orderId && r.PartName === partName && r.Status === 'done' && passedQueueIds[r.QueueID];
  }).reduce(function (sum, r) {
    return sum + (Number(r.Qty) || 0);
  }, 0);
}
