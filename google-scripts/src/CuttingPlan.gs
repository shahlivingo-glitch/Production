function modelRequiresPlanning(model) {
  if (!model) {
    return false;
  }
  var req = parseJsonSafe(model.PartRequirement, {});
  return Object.keys(req).length > 0;
}

function orderNeedsPlanning(order, model) {
  if (!order || !modelRequiresPlanning(model)) {
    return false;
  }
  var resolved = parseJsonSafe(order.ResolvedSheetSequence, []);
  return resolved.length === 0;
}

function getOrderPlanContext(userId, orderId) {
  requirePermission(userId, 'settings');
  var order = findRowById('Orders', 'OrderID', orderId);
  if (!order) {
    throw new Error('Order not found');
  }
  var model = findRowById('ModelSettings', 'ModelNoName', order.ModelNoName);
  if (!model) {
    throw new Error('Model not configured');
  }

  return {
    orderId: order.OrderID,
    modelNoName: order.ModelNoName,
    qty: order.Qty,
    sheetSequence: parseJsonSafe(model.SheetSequence, []),
    sheetSizes: parseJsonSafe(model.SheetSizes, {}),
    resolvedSheetSequence: parseJsonSafe(order.ResolvedSheetSequence, [])
  };
}

function previewCuttingPlan(payload) {
  requirePermission(payload.userId, 'settings');
  var order = findRowById('Orders', 'OrderID', payload.orderId);
  if (!order) {
    throw new Error('Order not found');
  }
  return computeCuttingPlan(order.ModelNoName, Number(order.Qty) || 0, payload.availableStock || {});
}

function confirmCuttingPlan(payload) {
  requirePermission(payload.userId, 'settings');
  var order = findRowById('Orders', 'OrderID', payload.orderId);
  if (!order) {
    throw new Error('Order not found');
  }

  var sequence = payload.sequence || [];
  if (sequence.length === 0) {
    throw new Error('Cannot confirm an empty cutting plan');
  }

  var existingCutting = getAllRows('CuttingLog').filter(function (r) {
    return r.OrderID === payload.orderId;
  });
  var hasStartedWork = existingCutting.some(function (r) {
    return r.Status !== 'pending';
  });
  if (hasStartedWork) {
    throw new Error('Cutting has already started on this order - the plan can no longer be changed');
  }

  updateRowById('Orders', 'OrderID', payload.orderId, {
    ResolvedSheetSequence: JSON.stringify(sequence)
  });

  deleteRowsWhere('CuttingLog', function (r) {
    return r.OrderID === payload.orderId;
  });

  var newRows = sequence.map(function (sheetCode, index) {
    return {
      LogID: generateId('CUT'),
      OrderID: payload.orderId,
      ModelNoName: order.ModelNoName,
      SheetCode: sheetCode,
      SheetSequencePos: index + 1,
      UnitIndex: 1,
      Status: 'pending',
      StartedAt: '',
      CompletedAt: '',
      OperatorID: '',
      Points: ''
    };
  });
  appendRows('CuttingLog', newRows);

  return { orderId: payload.orderId, sheetsPlanned: sequence.length };
}

function computeShortfallMap(required, produced) {
  var shortfall = {};
  Object.keys(required).forEach(function (partName) {
    var diff = required[partName] - (produced[partName] || 0);
    if (diff > 0) {
      shortfall[partName] = diff;
    }
  });
  return shortfall;
}

function computeCuttingPlan(modelNoName, qty, availableStock) {
  var model = findRowById('ModelSettings', 'ModelNoName', modelNoName);
  if (!model) {
    throw new Error('Unknown model: ' + modelNoName);
  }

  var partRequirement = parseJsonSafe(model.PartRequirement, {});
  var partsPerSheet = parseJsonSafe(model.PartsPerSheet, {});
  var sheetCodes = parseJsonSafe(model.SheetSequence, []);

  var required = {};
  Object.keys(partRequirement).forEach(function (partName) {
    required[partName] = (Number(partRequirement[partName]) || 0) * Number(qty);
  });

  var best = null;

  function evaluate(counts) {
    var produced = {};
    Object.keys(required).forEach(function (partName) {
      produced[partName] = 0;
    });

    sheetCodes.forEach(function (code) {
      var n = counts[code] || 0;
      if (!n) {
        return;
      }
      var partsMap = partsForSheet(partsPerSheet, code);
      Object.keys(partsMap).forEach(function (partName) {
        if (!(partName in produced)) {
          produced[partName] = 0;
        }
        produced[partName] += n * (Number(partsMap[partName]) || 0);
      });
    });

    var leftover = {};
    var totalLeftover = 0;
    var totalShortfall = 0;
    Object.keys(required).forEach(function (partName) {
      var diff = produced[partName] - required[partName];
      leftover[partName] = diff;
      if (diff > 0) {
        totalLeftover += diff;
      }
      if (diff < 0) {
        totalShortfall += -diff;
      }
    });

    var totalSheets = sheetCodes.reduce(function (sum, code) {
      return sum + (counts[code] || 0);
    }, 0);

    return {
      counts: Object.assign({}, counts),
      produced: produced,
      leftover: leftover,
      totalLeftover: totalLeftover,
      totalShortfall: totalShortfall,
      totalSheets: totalSheets
    };
  }

  function isBetter(a, b) {
    if (!b) {
      return true;
    }
    if (a.totalShortfall !== b.totalShortfall) {
      return a.totalShortfall < b.totalShortfall;
    }
    if (a.totalLeftover !== b.totalLeftover) {
      return a.totalLeftover < b.totalLeftover;
    }
    return a.totalSheets < b.totalSheets;
  }

  function search(index, counts) {
    if (index === sheetCodes.length) {
      var result = evaluate(counts);
      if (isBetter(result, best)) {
        best = result;
      }
      return;
    }
    var code = sheetCodes[index];
    var maxCount = Math.max(0, Number(availableStock[code]) || 0);
    for (var n = 0; n <= maxCount; n++) {
      counts[code] = n;
      search(index + 1, counts);
    }
    delete counts[code];
  }

  search(0, {});

  if (!best) {
    return { sequence: [], leftover: {}, shortfall: required, totalSheets: 0 };
  }

  var sequence = [];
  sheetCodes.forEach(function (code) {
    var n = best.counts[code] || 0;
    for (var i = 0; i < n; i++) {
      sequence.push(code);
    }
  });

  return {
    sequence: sequence,
    leftover: best.leftover,
    shortfall: computeShortfallMap(required, best.produced),
    totalSheets: best.totalSheets
  };
}
