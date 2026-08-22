function computeSpeedPoints(targetMinutes, actualMinutes) {
  var target = Number(targetMinutes) || 0;
  var actual = Math.max(Number(actualMinutes) || 0, 0.1);
  if (!target) {
    return 100;
  }
  var ratio = target / actual;
  return Math.max(0, Math.min(200, Math.round(ratio * 100)));
}

function canonicalSheetCode(model, sheetSequencePos, fallback) {
  if (!model) {
    return fallback;
  }
  var sequence = parseJsonSafe(model.SheetSequence, []);
  var index = Number(sheetSequencePos) - 1;
  return sequence[index] !== undefined ? sequence[index] : fallback;
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

function cuttingTargetForSheet(model, sheetCode) {
  if (!model) {
    return 0;
  }
  var targets = parseJsonSafe(model.CuttingTimeTargets, {});
  return Number(targets[String(sheetCode)]) || 0;
}

function isFirstCuttingJobForOrder(sheetSequencePos, unitIndex) {
  return Number(sheetSequencePos) === 1 && Number(unitIndex) === 1;
}

function effectiveCuttingTarget(model, sheetCode, sheetSequencePos, unitIndex) {
  var base = cuttingTargetForSheet(model, sheetCode);
  if (!isFirstCuttingJobForOrder(sheetSequencePos, unitIndex)) {
    return base;
  }
  var setup = getSetupTime('cutting');
  return base + setup;
}

function getOrdersById() {
  var map = {};
  getAllRows('Orders').forEach(function (o) {
    map[o.OrderID] = o;
  });
  return map;
}

function bendingSequenceIndex(model, partName) {
  if (!model) {
    return 999;
  }
  var sequence = parseJsonSafe(model.BendingSequence, []);
  var index = sequence.indexOf(partName);
  return index === -1 ? 999 : index;
}

function addToBendingQueue(orderId, partName, sheetCode, addQty, priority) {
  var matchFn = function (r) {
    return r.OrderID === orderId && r.PartName === partName && r.Status === 'unlocked';
  };
  var existing = findRow('BendingQueue', matchFn);
  if (existing) {
    updateRow('BendingQueue', matchFn, { Qty: (Number(existing.Qty) || 0) + addQty });
  } else {
    appendRow('BendingQueue', {
      QueueID: generateId('BQ'),
      OrderID: orderId,
      PartName: partName,
      SheetCode: sheetCode,
      Qty: addQty,
      Status: 'unlocked',
      Priority: priority,
      StartedAt: '',
      CompletedAt: '',
      OperatorID: '',
      Points: ''
    });
  }
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
    if (Number(a.SheetSequencePos) !== Number(b.SheetSequencePos)) {
      return Number(a.SheetSequencePos) - Number(b.SheetSequencePos);
    }
    return Number(a.UnitIndex) - Number(b.UnitIndex);
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
  var sheetCode = canonicalSheetCode(model, next.SheetSequencePos, next.SheetCode);
  var partsPerSheet = model ? parseJsonSafe(model.PartsPerSheet, {}) : {};
  var partsMap = partsForSheet(partsPerSheet, sheetCode);

  return {
    logId: next.LogID,
    orderId: next.OrderID,
    modelNoName: next.ModelNoName,
    sheetCode: sheetCode,
    sheetSequencePos: next.SheetSequencePos,
    unitIndex: next.UnitIndex,
    totalUnits: orderQty,
    status: next.Status,
    startedAt: next.StartedAt,
    customerName: order ? order.CustomerName : '',
    cuttingTimeTarget: effectiveCuttingTarget(model, sheetCode, next.SheetSequencePos, next.UnitIndex),
    includesSetup: isFirstCuttingJobForOrder(next.SheetSequencePos, next.UnitIndex),
    parts: Object.keys(partsMap).map(function (name) {
      return name + ' x' + (Number(partsMap[name]) || 0);
    }),
    expectedQty: totalPartsQty(partsMap)
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
  var sheetCode = canonicalSheetCode(model, row.SheetSequencePos, row.SheetCode);
  var startedAt = new Date(row.StartedAt).getTime();
  var completedAt = new Date();
  var actualMinutes = (completedAt.getTime() - startedAt) / 60000;
  var target = effectiveCuttingTarget(model, sheetCode, row.SheetSequencePos, row.UnitIndex);
  var points = computeSpeedPoints(target, actualMinutes);

  updateRowById('CuttingLog', 'LogID', payload.logId, {
    Status: 'done',
    CompletedAt: completedAt.toISOString(),
    Points: points
  });

  var partsPerSheet = model ? parseJsonSafe(model.PartsPerSheet, {}) : {};
  var partsMap = partsForSheet(partsPerSheet, sheetCode);

  return {
    logId: payload.logId,
    orderId: row.OrderID,
    sheetCode: sheetCode,
    unitIndex: row.UnitIndex,
    points: points,
    actualMinutes: Math.round(actualMinutes * 10) / 10,
    parts: Object.keys(partsMap).map(function (name) {
      return name + ' x' + (Number(partsMap[name]) || 0);
    }),
    expectedQty: totalPartsQty(partsMap)
  };
}

function submitCuttingQC(payload) {
  requirePermission(payload.userId, 'cutting');
  var row = findRowById('CuttingLog', 'LogID', payload.logId);
  if (!row) {
    throw new Error('Sheet not found');
  }

  var model = findRowById('ModelSettings', 'ModelNoName', row.ModelNoName);
  var sheetCode = canonicalSheetCode(model, row.SheetSequencePos, row.SheetCode);

  var result = payload.result === 'pass' ? 'pass' : 'fail';
  var failAction = result === 'fail' ? payload.failAction : '';

  appendRow('CuttingQC', {
    QCID: generateId('CQC'),
    OrderID: row.OrderID,
    SheetCode: sheetCode,
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
    ItemRef: row.LogID,
    Result: result,
    FailAction: failAction,
    CheckerID: payload.userId,
    Timestamp: nowIso(),
    Notes: payload.notes || ''
  });

  var pushedParts = [];
  var shouldPushToBending = result === 'pass' || failAction === 'continue';

  if (shouldPushToBending) {
    var partsPerSheet = model ? parseJsonSafe(model.PartsPerSheet, {}) : {};
    var partsMap = partsForSheet(partsPerSheet, sheetCode);
    var order = findRowById('Orders', 'OrderID', row.OrderID);
    var orderCreatedMs = order ? new Date(order.CreatedAt).getTime() : Date.now();

    Object.keys(partsMap).forEach(function (partName) {
      var addQty = Number(partsMap[partName]) || 0;
      var priority = orderCreatedMs + bendingSequenceIndex(model, partName) * 0.001;
      addToBendingQueue(row.OrderID, partName, sheetCode, addQty, priority);
      pushedParts.push(partName + ' x' + addQty);
    });
  } else if (failAction === 'recut') {
    appendRow('CuttingLog', {
      LogID: generateId('CUT'),
      OrderID: row.OrderID,
      ModelNoName: row.ModelNoName,
      SheetCode: sheetCode,
      SheetSequencePos: row.SheetSequencePos,
      UnitIndex: row.UnitIndex,
      Status: 'pending',
      StartedAt: '',
      CompletedAt: '',
      OperatorID: '',
      Points: ''
    });
  }

  return { result: result, failAction: failAction, pushedParts: pushedParts };
}
