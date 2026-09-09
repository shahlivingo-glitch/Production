function getOrderActiveSheets(order) {
  // Mirrors getActivePlanVersionForOrder's fallback (PlanVersions.gs): an
  // order has no PlanVersionId at all until a version is explicitly saved
  // for it - until then it's still following the model's named plan
  // directly. Returning [] in that case (as this used to) makes Cutting's
  // own completion tracking and Bending's queue both see zero sheets for
  // every order that hasn't saved a version yet, which is the common case.
  if (order.PlanVersionId) {
    var version = findRowById('PlanVersions', 'VersionId', order.PlanVersionId);
    return version ? parseJsonSafe(version.Sheets, []) : [];
  }
  var plan = findPlanRow(order.ModelName, order.PlanName);
  return plan ? parseJsonSafe(plan.Sheets, []) : [];
}

function sheetLabelForBending(sheet, sheetIndex) {
  var label = 'Sheet ' + (sheetIndex + 1);
  if (sheet) {
    var dims = [sheet.width, sheet.height, sheet.thickness]
      .filter(function (v) { return v !== undefined && v !== ''; })
      .join(' × ');
    if (dims) {
      label += ' — ' + dims + ' mm';
    }
  }
  return label;
}

function getBendingQueueForOrder(poNumber) {
  var order = findRowById('Orders', 'PoNumber', poNumber);
  if (!order) {
    throw new Error('PO not found: ' + poNumber);
  }
  var sheets = getOrderActiveSheets(order);
  var sheetCompletion = parseJsonSafe(order.SheetCompletion, []);
  var bendingCompletion = parseJsonSafe(order.BendingCompletion, []);

  var entries = flattenPlanOutputs(sheets).map(function (entry, index) {
    return {
      index: index,
      sheetIndex: entry.sheetIndex,
      sheetLabel: sheetLabelForBending(sheets[entry.sheetIndex], entry.sheetIndex),
      partName: entry.partName,
      qty: entry.qty,
      isExtra: entry.isExtra,
      size: entry.size,
      unlocked: !!sheetCompletion[entry.sheetIndex],
      done: !!bendingCompletion[index]
    };
  });

  return {
    poNumber: String(order.PoNumber),
    modelName: String(order.ModelName),
    qty: Number(order.Qty) || 0,
    entries: entries,
    bendingStatus: order.BendingStatus || 'pending'
  };
}

function setBendingComplete(payload) {
  var row = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!row) {
    throw new Error('PO not found: ' + payload.poNumber);
  }
  var idx = Number(payload.entryIndex);
  if (idx < 0 || isNaN(idx)) {
    throw new Error('Invalid entry index');
  }

  var sheets = getOrderActiveSheets(row);
  var flat = flattenPlanOutputs(sheets);
  var entry = flat[idx];
  if (!entry) {
    throw new Error('Bending entry not found');
  }

  var sheetCompletion = parseJsonSafe(row.SheetCompletion, []);
  if (payload.completed && !sheetCompletion[entry.sheetIndex]) {
    throw new Error('That part\'s sheet has not been marked complete in Cutting yet');
  }

  var completion = parseJsonSafe(row.BendingCompletion, []);
  completion[idx] = !!payload.completed;
  writeRowUpdates('Orders', row._rowIndex, {
    BendingCompletion: JSON.stringify(completion),
    BendingStatus: computeBendingStatus(completion, flat.length)
  });
  return getBendingQueueForOrder(payload.poNumber);
}

function markAllBendingComplete(payload) {
  var row = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!row) {
    throw new Error('PO not found: ' + payload.poNumber);
  }
  var sheets = getOrderActiveSheets(row);
  var flat = flattenPlanOutputs(sheets);
  var sheetCompletion = parseJsonSafe(row.SheetCompletion, []);
  var completion = parseJsonSafe(row.BendingCompletion, []);

  flat.forEach(function (entry, idx) {
    if (sheetCompletion[entry.sheetIndex]) {
      completion[idx] = true;
    }
  });

  writeRowUpdates('Orders', row._rowIndex, {
    BendingCompletion: JSON.stringify(completion),
    BendingStatus: computeBendingStatus(completion, flat.length)
  });
  return getBendingQueueForOrder(payload.poNumber);
}

function listPendingBendingOrders() {
  var result = [];
  getAllRows('Orders').forEach(function (r) {
    if ((r.BendingStatus || 'pending') === 'complete') {
      return;
    }
    var sheetCompletion = parseJsonSafe(r.SheetCompletion, []);
    var hasStarted = sheetCompletion.some(function (v) { return v === true; });
    if (!hasStarted) {
      return;
    }

    var sheets = getOrderActiveSheets(r);
    var flat = flattenPlanOutputs(sheets);
    var bendingCompletion = parseJsonSafe(r.BendingCompletion, []);
    var availableParts = 0;
    var donePartsCount = 0;
    flat.forEach(function (entry, idx) {
      if (sheetCompletion[entry.sheetIndex]) {
        availableParts++;
        if (bendingCompletion[idx]) {
          donePartsCount++;
        }
      }
    });

    result.push({
      poNumber: String(r.PoNumber),
      modelName: String(r.ModelName),
      qty: Number(r.Qty) || 0,
      createdAt: r.CreatedAt,
      partyName: r.PartyName || '',
      availableParts: availableParts,
      donePartsCount: donePartsCount,
      totalPartsInPlan: flat.length
    });
  });
  return result;
}
