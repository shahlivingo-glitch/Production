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
    totalSheetsRequired: Number(r.TotalSheetsRequired) || 0,
    cuttingStatus: r.CuttingStatus || 'pending',
    createdAt: r.CreatedAt
  };
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
    TotalSheetsRequired: totalSheetsRequired,
    CuttingStatus: 'pending',
    CreatedAt: nowIso()
  });

  return getOrder(poNumber);
}

function markOrderCuttingComplete(payload) {
  var row = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!row) {
    throw new Error('PO not found: ' + payload.poNumber);
  }
  writeRowUpdates('Orders', row._rowIndex, { CuttingStatus: 'complete' });
  return getOrder(payload.poNumber);
}
