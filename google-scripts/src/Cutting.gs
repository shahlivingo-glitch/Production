function computeSpeedPoints(targetMinutes, actualMinutes) {
  var target = Number(targetMinutes) || 0;
  var actual = Math.max(Number(actualMinutes) || 0, 0.1);
  if (!target) {
    return 100;
  }
  var ratio = target / actual;
  return Math.max(0, Math.min(200, Math.round(ratio * 100)));
}

function partsForSheet(partsPerSheet, sheetCode) {
  var raw = partsPerSheet[String(sheetCode)];
  if (!raw) {
    return {};
  }
  if (Array.isArray(raw)) {
    var map = {};
    raw.forEach(function (name) {
      map[name] = (map[name] || 0) + 1;
    });
    return map;
  }
  return raw;
}

function totalPartsQty(partsMap) {
  return Object.keys(partsMap).reduce(function (sum, name) {
    return sum + (Number(partsMap[name]) || 0);
  }, 0);
}

function getOrdersById() {
  var map = {};
  getAllRows('Orders').forEach(function (o) {
    map[o.OrderID] = o;
  });
  return map;
}

function getCuttingQueue(userId) {
  requirePermission(userId, 'cutting');

  var orders = getOrdersById();
  var rows = getAllRows('CuttingLog').filter(function (r) {
    return r.Status === 'pending' || (r.Status === 'in-progress' && r.OperatorID === userId);
  });

  rows.sort(function (a, b) {
    var aCreated = orders[a.OrderID] ? orders[a.OrderID].CreatedAt : '';
    var bCreated = orders[b.OrderID] ? orders[b.OrderID].CreatedAt : '';
    if (aCreated !== bCreated) {
      return aCreated < bCreated ? -1 : 1;
    }
    return Number(a.SheetSequencePos) - Number(b.SheetSequencePos);
  });

  var mine = rows.filter(function (r) {
    return r.Status === 'in-progress' && r.OperatorID === userId;
  });
  var next = mine.length ? mine[0] : rows[0];
  if (!next) {
    return null;
  }

  var model = findRowById('ModelSettings', 'ModelNoName', next.ModelNoName);
  var order = orders[next.OrderID];
  var orderQty = order ? Number(order.Qty) || 0 : 0;
  var partsPerSheet = model ? parseJsonSafe(model.PartsPerSheet, {}) : {};
  var partsMap = partsForSheet(partsPerSheet, next.SheetCode);

  return {
    logId: next.LogID,
    orderId: next.OrderID,
    modelNoName: next.ModelNoName,
    sheetCode: next.SheetCode,
    sheetSequencePos: next.SheetSequencePos,
    status: next.Status,
    startedAt: next.StartedAt,
    customerName: order ? order.CustomerName : '',
    cuttingTimeTarget: model ? model.CuttingTimeTarget : 0,
    parts: Object.keys(partsMap).map(function (name) {
      return name + ' x' + ((Number(partsMap[name]) || 0) * orderQty);
    }),
    expectedQty: totalPartsQty(partsMap) * orderQty
  };
}

function startCuttingSheet(payload) {
  requirePermission(payload.userId, 'cutting');
  var row = findRowById('CuttingLog', 'LogID', payload.logId);
  if (!row) {
    throw new Error('Sheet not found');
  }
  if (row.Status !== 'pending') {
    throw new Error('Sheet is not pending');
  }
  updateRowById('CuttingLog', 'LogID', payload.logId, {
    Status: 'in-progress',
    StartedAt: nowIso(),
    OperatorID: payload.userId
  });
  return { logId: payload.logId };
}

function completeCuttingSheet(payload) {
  requirePermission(payload.userId, 'cutting');
  var row = findRowById('CuttingLog', 'LogID', payload.logId);
  if (!row) {
    throw new Error('Sheet not found');
  }
  if (row.Status !== 'in-progress') {
    throw new Error('Sheet is not in progress');
  }

  var model = findRowById('ModelSettings', 'ModelNoName', row.ModelNoName);
  var order = findRowById('Orders', 'OrderID', row.OrderID);
  var orderQty = order ? Number(order.Qty) || 0 : 0;
  var startedAt = new Date(row.StartedAt).getTime();
  var completedAt = new Date();
  var actualMinutes = (completedAt.getTime() - startedAt) / 60000;
  var points = computeSpeedPoints(model ? model.CuttingTimeTarget : 0, actualMinutes);

  updateRowById('CuttingLog', 'LogID', payload.logId, {
    Status: 'done',
    CompletedAt: completedAt.toISOString(),
    Points: points
  });

  var partsPerSheet = model ? parseJsonSafe(model.PartsPerSheet, {}) : {};
  var partsMap = partsForSheet(partsPerSheet, row.SheetCode);

  return {
    logId: payload.logId,
    orderId: row.OrderID,
    sheetCode: row.SheetCode,
    points: points,
    actualMinutes: Math.round(actualMinutes * 10) / 10,
    parts: Object.keys(partsMap).map(function (name) {
      return name + ' x' + ((Number(partsMap[name]) || 0) * orderQty);
    }),
    expectedQty: totalPartsQty(partsMap) * orderQty
  };
}

function submitCuttingQC(payload) {
  requirePermission(payload.userId, 'cutting');
  var row = findRowById('CuttingLog', 'LogID', payload.logId);
  if (!row) {
    throw new Error('Sheet not found');
  }

  var result = payload.result === 'pass' ? 'pass' : 'fail';
  var failAction = result === 'fail' ? payload.failAction : '';

  appendRow('CuttingQC', {
    QCID: generateId('CQC'),
    OrderID: row.OrderID,
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
    Stage: 'cutting',
    ItemRef: row.SheetCode,
    Result: result,
    FailAction: failAction,
    CheckerID: payload.userId,
    Timestamp: nowIso(),
    Notes: payload.notes || ''
  });

  var pushedParts = [];
  var shouldPushToBending = result === 'pass' || failAction === 'continue';

  if (shouldPushToBending) {
    var model = findRowById('ModelSettings', 'ModelNoName', row.ModelNoName);
    var order = findRowById('Orders', 'OrderID', row.OrderID);
    var orderQty = order ? Number(order.Qty) || 0 : 0;
    var partsPerSheet = model ? parseJsonSafe(model.PartsPerSheet, {}) : {};
    var partsMap = partsForSheet(partsPerSheet, row.SheetCode);

    Object.keys(partsMap).forEach(function (partName) {
      var totalQty = (Number(partsMap[partName]) || 0) * orderQty;
      appendRow('BendingQueue', {
        QueueID: generateId('BQ'),
        OrderID: row.OrderID,
        PartName: partName,
        SheetCode: row.SheetCode,
        Qty: totalQty,
        Status: 'unlocked',
        Priority: new Date().getTime(),
        StartedAt: '',
        CompletedAt: '',
        OperatorID: '',
        Points: ''
      });
      pushedParts.push(partName + ' x' + totalQty);
    });
  } else if (failAction === 'recut') {
    appendRow('CuttingLog', {
      LogID: generateId('CUT'),
      OrderID: row.OrderID,
      ModelNoName: row.ModelNoName,
      SheetCode: row.SheetCode,
      SheetSequencePos: row.SheetSequencePos,
      Status: 'pending',
      StartedAt: '',
      CompletedAt: '',
      OperatorID: '',
      Points: ''
    });
  }

  return { result: result, failAction: failAction, pushedParts: pushedParts };
}
