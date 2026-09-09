function generatePoNumber() {
  var max = 0;
  getAllRows('Orders').forEach(function (r) {
    var m = /^PO-(\d+)$/.exec(String(r.PoNumber));
    if (m) {
      var n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  });
  return 'PO-' + padNumber(max + 1, 4);
}

function previewNextPoNumber() {
  return { poNumber: generatePoNumber() };
}

function orderRowToObject(r) {
  return {
    poNumber: String(r.PoNumber),
    modelName: String(r.ModelName),
    planName: String(r.PlanName),
    qty: Number(r.Qty) || 0,
    dxfRefNo: r.DxfRefNo || '',
    colourPlan: r.ColourPlan || '',
    deliveryDeadline: r.DeliveryDeadline || '',
    partyName: r.PartyName || '',
    planVersionId: r.PlanVersionId || '',
    sheetCompletion: parseJsonSafe(r.SheetCompletion, []),
    bendingCompletion: parseJsonSafe(r.BendingCompletion, []),
    totalSheetsRequired: Number(r.TotalSheetsRequired) || 0,
    cuttingStatus: r.CuttingStatus || 'pending',
    bendingStatus: r.BendingStatus || 'pending',
    createdAt: r.CreatedAt
  };
}

// completion arrays are built via completion[idx] = value, which on a
// sparse/short array leaves untouched indices as real "holes" - and
// Array.prototype.every SKIPS holes entirely rather than treating them as
// false. So "every" on a partially-filled array can come back true after
// only the FIRST index has ever been touched. Always check against the
// known true total instead of trusting completion.length or .every().
function isCompletionFull(completion, totalCount) {
  if (!totalCount) {
    return false;
  }
  for (var i = 0; i < totalCount; i++) {
    if (!completion || completion[i] !== true) {
      return false;
    }
  }
  return true;
}

function computeCuttingStatus(completion, totalCount) {
  return isCompletionFull(completion, totalCount) ? 'complete' : 'pending';
}

function computeBendingStatus(completion, totalCount) {
  return isCompletionFull(completion, totalCount) ? 'complete' : 'pending';
}

function listOrders() {
  return getAllRows('Orders').map(orderRowToObject);
}

function listPendingOrders() {
  return listOrders().filter(function (o) { return o.cuttingStatus !== 'complete'; });
}

function getOrder(poNumber) {
  var row = findRowById('Orders', 'PoNumber', poNumber);
  if (!row) {
    throw new Error('PO not found: ' + poNumber);
  }
  return orderRowToObject(row);
}

function createOrder(payload) {
  var modelName = payload.modelName;
  var planName = payload.planName;
  var qty = Number(payload.qty) || 0;

  if (!modelName) {
    throw new Error('Model is required');
  }
  if (!planName) {
    throw new Error('Cutting plan is required');
  }
  if (qty <= 0) {
    throw new Error('Qty must be greater than 0');
  }

  var plan = findPlanRow(modelName, planName);
  if (!plan) {
    throw new Error('Plan not found: ' + modelName + ' / ' + planName);
  }
  var sheets = parseJsonSafe(plan.Sheets, []);
  var totalSheetsRequired = sheets.length * qty;

  var poNumber = generatePoNumber();
  appendRow('Orders', {
    PoNumber: poNumber,
    ModelName: modelName,
    PlanName: planName,
    Qty: qty,
    DxfRefNo: payload.dxfRefNo || '',
    ColourPlan: payload.colourPlan || '',
    DeliveryDeadline: payload.deliveryDeadline || '',
    PartyName: payload.partyName || '',
    PlanVersionId: '',
    SheetCompletion: JSON.stringify([]),
    BendingCompletion: JSON.stringify([]),
    TotalSheetsRequired: totalSheetsRequired,
    CuttingStatus: 'pending',
    BendingStatus: 'pending',
    CreatedAt: nowIso()
  });

  return getOrder(poNumber);
}

function setSheetComplete(payload) {
  var row = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!row) {
    throw new Error('PO not found: ' + payload.poNumber);
  }
  var idx = Number(payload.sheetIndex);
  if (idx < 0) {
    throw new Error('Invalid sheet index');
  }
  var totalSheets = getOrderActiveSheets(row).length;
  var completion = parseJsonSafe(row.SheetCompletion, []);
  completion[idx] = !!payload.completed;
  writeRowUpdates('Orders', row._rowIndex, {
    SheetCompletion: JSON.stringify(completion),
    CuttingStatus: computeCuttingStatus(completion, totalSheets)
  });
  return getOrder(payload.poNumber);
}

function markAllSheetsComplete(payload) {
  var row = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!row) {
    throw new Error('PO not found: ' + payload.poNumber);
  }
  var totalSheets = getOrderActiveSheets(row).length;
  var filled = [];
  for (var i = 0; i < totalSheets; i++) {
    filled.push(true);
  }
  writeRowUpdates('Orders', row._rowIndex, {
    SheetCompletion: JSON.stringify(filled),
    CuttingStatus: computeCuttingStatus(filled, totalSheets)
  });
  return getOrder(payload.poNumber);
}
