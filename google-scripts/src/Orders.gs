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
    sheetQtyOverrides: parseJsonSafe(r.SheetQtyOverrides, {}),
    hasPendingMultiYield: hasPendingMultiYield(multiYieldDecisions),
    planType: r.PlanType === 'bulk' ? 'bulk' : 'per-unit',
    bulkBaseQty: Number(r.BulkBaseQty) || 0,
    bulkMultiplier: Number(r.BulkMultiplier) || 0
  };
}

// The "N" that drives sheet math for this order: a bulk PO's plan rows are
// denominated per baseQty-batch, so N is the batch multiplier, not the raw
// unit Qty. A per-unit PO's plan rows are denominated per unit, so N is Qty.
// Snapshotted on the order at creation - never re-derived from the model's
// current plan, so a later plan edit can't change how an existing PO's
// sheets are computed.
function getOrderSheetMultiplier(row) {
  if (row.PlanType === 'bulk') {
    return Number(row.BulkMultiplier) || 0;
  }
  return Number(row.Qty) || 0;
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

  if (!modelName) {
    throw new Error('Model is required');
  }
  if (!planName) {
    throw new Error('Cutting plan is required');
  }

  var plan = findPlanRow(modelName, planName);
  if (!plan) {
    throw new Error('Plan not found: ' + modelName + ' / ' + planName);
  }
  var planType = plan.PlanType === 'bulk' ? 'bulk' : 'per-unit';
  var baseQty = Number(plan.BaseQty) || 0;

  // sheetMultiplier is the "N" fed into the sheet math (computeOrderSheetPlan
  // treats it generically as "however many times the plan's rows repeat");
  // qty is always the real total unit count, used everywhere else.
  var qty, bulkMultiplier, sheetMultiplier;
  if (planType === 'bulk') {
    bulkMultiplier = Number(payload.bulkMultiplier) || 0;
    if (bulkMultiplier < 1) {
      throw new Error('Choose a multiplier of at least 1x for this Bulk plan');
    }
    if (baseQty < 1) {
      throw new Error('This Bulk plan has no Base Qty configured');
    }
    qty = bulkMultiplier * baseQty;
    sheetMultiplier = bulkMultiplier;
  } else {
    bulkMultiplier = 0;
    qty = Number(payload.qty) || 0;
    if (qty <= 0) {
      throw new Error('Qty must be greater than 0');
    }
    sheetMultiplier = qty;
  }

  var sheets = parseJsonSafe(plan.Sheets, []);
  var multiYieldDecisions = buildMultiYieldDecisions(sheets, sheetMultiplier, payload.multiYieldDecisions || {});
  // Manual per-sheet overrides from the PO form's editable "Sheets Required"
  // qty fields (only entries the user actually touched away from the
  // calculated default land here - see sanitizeSheetQtyOverrides).
  var sheetQtyOverrides = sanitizeSheetQtyOverrides(payload.sheetQtyOverrides, sheets.length);
  var totalSheetsRequired = 0;
  computeOrderSheetPlan(sheets, sheetMultiplier, multiYieldDecisions, sheetQtyOverrides).forEach(function (s) {
    totalSheetsRequired += s.physicalSheets;
  });

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
    SheetStockConsumed: JSON.stringify({}),
    PlanType: planType,
    BulkBaseQty: planType === 'bulk' ? baseQty : 0,
    BulkMultiplier: bulkMultiplier,
    SheetQtyOverrides: JSON.stringify(sheetQtyOverrides)
  });

  return getOrder(poNumber);
}

// When a sheet-type is first marked done: deduct its physical sheet count from
// raw stock and post EVERY overproduced row's surplus to the Leftover Ledger
// (ExtraPartInventory) - in the shared-sheet model, cutting for the binding
// part overproduces every other part on that sheet. Runs once per sheet-type -
// SheetStockConsumed guards re-checks. Not reversed on uncheck (matches the
// existing mark-done extras prompt). Best-effort: a stock/ledger failure must
// never block the checkbox.
function applyCutStockAndLedger(row, sheetIndex, sheets, consumed, overrides) {
  if (consumed[String(sheetIndex)]) {
    return consumed;
  }
  try {
    var multiplier = getOrderSheetMultiplier(row);
    var decisions = parseJsonSafe(row.MultiYieldDecisions, {});
    var sheetPlan = computeOrderSheetPlan(sheets, multiplier, decisions, overrides)[sheetIndex];
    if (sheetPlan) {
      if (sheetPlan.physicalSheets > 0) {
        applySheetStockDelta(
          sheetPlan.width, sheetPlan.height, sheetPlan.thickness,
          -sheetPlan.physicalSheets, 'po-cut', row.PoNumber,
          'Sheet ' + (sheetIndex + 1) + ' cut'
        );
      }
      sheetPlan.rows.forEach(function (r) {
        if (r.surplus > 0 && r.partName && !r.isExtra) {
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
  var overrides = sanitizeSheetQtyOverrides(parseJsonSafe(row.SheetQtyOverrides, {}), totalSheets);
  if (payload.completed) {
    // The actual sheets cut, entered on the Cutting Stage "mark done" prompt
    // right before the extra-parts question - overwrites any earlier
    // estimate (from PO creation, or a previous mark-done) for this sheet,
    // since it's the most authoritative number available at cut time.
    if (payload.actualSheetsCut !== undefined && payload.actualSheetsCut !== null && payload.actualSheetsCut !== '') {
      var actualVal = Number(payload.actualSheetsCut);
      if (!isNaN(actualVal) && actualVal >= 0) {
        overrides[String(idx)] = actualVal;
        updates.SheetQtyOverrides = JSON.stringify(overrides);
      }
    }
    var consumed = parseJsonSafe(row.SheetStockConsumed, {});
    applyCutStockAndLedger(row, idx, sheets, consumed, overrides);
    updates.SheetStockConsumed = JSON.stringify(consumed);
    var decisions = parseJsonSafe(row.MultiYieldDecisions, {});
    var total = 0;
    computeOrderSheetPlan(sheets, getOrderSheetMultiplier(row), decisions, overrides).forEach(function (s) {
      total += s.physicalSheets;
    });
    updates.TotalSheetsRequired = total;
  }
  writeRowUpdates('Orders', row._rowIndex, updates);
  return getOrder(payload.poNumber);
}

// Lets the operator adjust a sheet's planned cut count directly from its
// Cutting Plan card, independent of (and ahead of) marking it done - that's
// still a separate, later confirmation via setSheetComplete's
// actualSheetsCut, which pre-fills from whatever's set here. payload.value
// blank/null clears the override back to the calculated default. Refused
// once the sheet is already marked done: stock/ledger were already computed
// from whatever number was locked in at that moment, and this must never
// silently diverge from it - correcting stock after the fact is a separate,
// explicit Raw Sheet Stock adjustment instead.
function setSheetQtyOverride(payload) {
  var row = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!row) {
    throw new Error('PO not found: ' + payload.poNumber);
  }
  var idx = Number(payload.sheetIndex);
  if (idx < 0 || isNaN(idx)) {
    throw new Error('Invalid sheet index');
  }
  var sheets = getOrderActiveSheets(row);
  if (idx >= sheets.length) {
    throw new Error('Invalid sheet index');
  }
  var completion = parseJsonSafe(row.SheetCompletion, []);
  if (completion[idx]) {
    throw new Error('This sheet is already marked done - its actual cut count is locked in.');
  }

  var overrides = sanitizeSheetQtyOverrides(parseJsonSafe(row.SheetQtyOverrides, {}), sheets.length);
  if (payload.value === '' || payload.value === null || payload.value === undefined) {
    delete overrides[String(idx)];
  } else {
    var v = Number(payload.value);
    if (isNaN(v) || v < 0) {
      throw new Error('Enter a valid sheet count (0 or more)');
    }
    overrides[String(idx)] = v;
  }

  var decisions = parseJsonSafe(row.MultiYieldDecisions, {});
  var total = 0;
  computeOrderSheetPlan(sheets, getOrderSheetMultiplier(row), decisions, overrides).forEach(function (s) {
    total += s.physicalSheets;
  });

  writeRowUpdates('Orders', row._rowIndex, {
    SheetQtyOverrides: JSON.stringify(overrides),
    TotalSheetsRequired: total
  });
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
  var overrides = sanitizeSheetQtyOverrides(parseJsonSafe(row.SheetQtyOverrides, {}), totalSheets);
  for (var i = 0; i < totalSheets; i++) {
    filled.push(true);
    applyCutStockAndLedger(row, i, sheets, consumed, overrides);
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
    // Rebuild it from the currently active plan; the key must be the binding
    // row of its sheet-type for a decision to be valid.
    var sheetIndex = Number(String(payload.key).split(':')[0]);
    var sheets = getOrderActiveSheets(row);
    var existingOverrides = sanitizeSheetQtyOverrides(parseJsonSafe(row.SheetQtyOverrides, {}), sheets.length);
    var sheetPlan = computeOrderSheetPlan(sheets, getOrderSheetMultiplier(row), {}, existingOverrides)[sheetIndex];
    if (!sheetPlan || sheetPlan.decisionKey !== payload.key) {
      throw new Error('No multi-yield remainder at ' + payload.key);
    }
    var bindingRow = null;
    sheetPlan.rows.forEach(function (r) { if (r.isBinding) bindingRow = r; });
    entry = {
      partName: bindingRow.partName,
      totalNeeded: bindingRow.totalNeeded,
      yieldPerSheet: bindingRow.yieldPerSheet,
      fullSheets: bindingRow.floorSheets,
      remainder: bindingRow.remainder
    };
    decisions[payload.key] = entry;
  }
  entry.choice = payload.choice;
  entry.decidedAt = nowIso();

  var activeSheets = getOrderActiveSheets(row);
  var overridesForTotal = sanitizeSheetQtyOverrides(parseJsonSafe(row.SheetQtyOverrides, {}), activeSheets.length);
  var total = 0;
  computeOrderSheetPlan(activeSheets, getOrderSheetMultiplier(row), decisions, overridesForTotal).forEach(function (s) {
    total += s.physicalSheets;
  });
  writeRowUpdates('Orders', row._rowIndex, {
    MultiYieldDecisions: JSON.stringify(decisions),
    TotalSheetsRequired: total
  });
  return getOrder(payload.poNumber);
}
