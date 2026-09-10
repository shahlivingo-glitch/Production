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
  var multiYieldDecisions = parseJsonSafe(r.MultiYieldDecisions, {});
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
    createdAt: r.CreatedAt,
    multiYieldDecisions: multiYieldDecisions,
    sheetStockConsumed: parseJsonSafe(r.SheetStockConsumed, {}),
    hasPendingMultiYield: hasPendingMultiYield(multiYieldDecisions)
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
  var multiYieldDecisions = buildMultiYieldDecisions(sheets, qty, payload.multiYieldDecisions || {});

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
    CreatedAt: nowIso(),
    MultiYieldDecisions: JSON.stringify(multiYieldDecisions),
    SheetStockConsumed: JSON.stringify({})
  });

  return getOrder(poNumber);
}

// When a sheet-type is first marked done: deduct its physical sheet count from
// raw stock and post any "extra full sheet" surplus to the Leftover Ledger
// (ExtraPartInventory). Runs once per sheet-type - SheetStockConsumed guards
// re-checks. Not reversed on uncheck (matches the existing mark-done extras
// prompt). Best-effort: a stock/ledger failure must never block the checkbox.
function applyCutStockAndLedger(row, sheetIndex, sheets, consumed) {
  if (consumed[String(sheetIndex)]) {
    return consumed;
  }
  try {
    var poQty = Number(row.Qty) || 0;
    var decisions = parseJsonSafe(row.MultiYieldDecisions, {});
    var sheetPlan = computeOrderSheetPlan(sheets, poQty, decisions)[sheetIndex];
    if (sheetPlan) {
      if (sheetPlan.physicalSheets > 0) {
        applySheetStockDelta(
          sheetPlan.width, sheetPlan.height, sheetPlan.thickness,
          -sheetPlan.physicalSheets, 'po-cut', row.PoNumber,
          'Sheet ' + (sheetIndex + 1) + ' cut'
        );
      }
      sheetPlan.rows.forEach(function (r) {
        if (r.multiYield && r.choice === 'extra-sheet' && r.surplus > 0) {
          addToExtraPartInventory(row.ModelName, r.partName, '', r.surplus);
        }
      });
    }
  } catch (err) {
    // swallow - completion must still record
  }
  consumed[String(sheetIndex)] = true;
  return consumed;
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
  var sheets = getOrderActiveSheets(row);
  var totalSheets = sheets.length;
  var completion = parseJsonSafe(row.SheetCompletion, []);
  completion[idx] = !!payload.completed;
  var updates = {
    SheetCompletion: JSON.stringify(completion),
    CuttingStatus: computeCuttingStatus(completion, totalSheets)
  };
  if (payload.completed) {
    var consumed = parseJsonSafe(row.SheetStockConsumed, {});
    applyCutStockAndLedger(row, idx, sheets, consumed);
    updates.SheetStockConsumed = JSON.stringify(consumed);
  }
  writeRowUpdates('Orders', row._rowIndex, updates);
  return getOrder(payload.poNumber);
}

function markAllSheetsComplete(payload) {
  var row = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!row) {
    throw new Error('PO not found: ' + payload.poNumber);
  }
  var sheets = getOrderActiveSheets(row);
  var totalSheets = sheets.length;
  var filled = [];
  var consumed = parseJsonSafe(row.SheetStockConsumed, {});
  for (var i = 0; i < totalSheets; i++) {
    filled.push(true);
    applyCutStockAndLedger(row, i, sheets, consumed);
  }
  writeRowUpdates('Orders', row._rowIndex, {
    SheetCompletion: JSON.stringify(filled),
    CuttingStatus: computeCuttingStatus(filled, totalSheets),
    SheetStockConsumed: JSON.stringify(consumed)
  });
  return getOrder(payload.poNumber);
}

// Resolve one still-pending multi-yield remainder decision (from the Cutting
// dashboard / PO screen). choice is 'extra-sheet' or 'scrap'.
function setMultiYieldDecision(payload) {
  var row = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!row) {
    throw new Error('PO not found: ' + payload.poNumber);
  }
  if (payload.choice !== 'extra-sheet' && payload.choice !== 'scrap') {
    throw new Error('Invalid choice: ' + payload.choice);
  }
  var decisions = parseJsonSafe(row.MultiYieldDecisions, {});
  var entry = decisions[payload.key];
  if (!entry) {
    // Key not in the stored map - happens when a plan gained a multi-yield
    // flag after this PO was created (or the PO predates the feature).
    // Rebuild the entry from the currently active plan.
    var parts = String(payload.key).split(':');
    var sheets = getOrderActiveSheets(row);
    var sheet = sheets[Number(parts[0])];
    var output = sheet && sheet.outputs ? sheet.outputs[Number(parts[1])] : null;
    var my = output ? computeMultiYieldForOutput(output, Number(row.Qty) || 0) : null;
    if (!my || !my.multiYield || my.remainder <= 0) {
      throw new Error('No multi-yield remainder at ' + payload.key);
    }
    entry = {
      partName: my.partName,
      totalNeeded: my.totalNeeded,
      yieldPerSheet: my.yieldPerSheet,
      fullSheets: my.fullSheets,
      remainder: my.remainder
    };
    decisions[payload.key] = entry;
  }
  entry.choice = payload.choice;
  entry.decidedAt = nowIso();
  writeRowUpdates('Orders', row._rowIndex, {
    MultiYieldDecisions: JSON.stringify(decisions)
  });
  return getOrder(payload.poNumber);
}
