// Multi-yield cutting math. A plan output row may be flagged multiYield with a
// yieldPerSheet: one physical cut of that sheet produces yieldPerSheet copies
// of the part, not just the per-unit qty. Pure functions - no sheet I/O - so
// the same logic runs on the PO form (projection) and in Cutting Stage.
//
// Each multi-yield row is evaluated on its own (locked with the user: "prompt
// each part separately"), even when several sit on one sheet. The one place a
// physical tie-breaker is needed is the sheet-type's raw-stock consumption:
// you must cut at least as many physical sheets as the hungriest row needs, so
// physicalSheets = max across the sheet's rows.

function multiYieldDecisionKey(sheetIndex, outputIndex) {
  return sheetIndex + ':' + outputIndex;
}

function computeMultiYieldForOutput(outputRow, poQty) {
  var perUnit = Number(outputRow.qty) || 0;
  var yieldPerSheet = Number(outputRow.yieldPerSheet) || 0;
  if (!outputRow.multiYield || yieldPerSheet < 1) {
    return { multiYield: false, partName: outputRow.partName, perUnit: perUnit };
  }
  var totalNeeded = (Number(poQty) || 0) * perUnit;
  var fullSheets = Math.floor(totalNeeded / yieldPerSheet);
  var remainder = totalNeeded % yieldPerSheet;
  return {
    multiYield: true,
    partName: outputRow.partName,
    perUnit: perUnit,
    totalNeeded: totalNeeded,
    yieldPerSheet: yieldPerSheet,
    fullSheets: fullSheets,
    remainder: remainder
  };
}

// Per sheet-type breakdown for a PO. decisionsMap is Orders.MultiYieldDecisions
// (may be {}). Returns one entry per sheet in the active plan.
function computeOrderSheetPlan(sheets, poQty, decisionsMap) {
  poQty = Number(poQty) || 0;
  decisionsMap = decisionsMap || {};
  return (sheets || []).map(function (sheet, sheetIndex) {
    var outputs = sheet.outputs || [];
    var rows = outputs.map(function (output, outputIndex) {
      var my = computeMultiYieldForOutput(output, poQty);
      var key = multiYieldDecisionKey(sheetIndex, outputIndex);
      var decision = decisionsMap[key];
      var choice = decision ? decision.choice
        : (my.multiYield && my.remainder > 0 ? 'pending' : null);

      var rowPhysical = my.multiYield
        ? my.fullSheets + (choice === 'extra-sheet' ? 1 : 0)
        : poQty;
      var surplus = (my.multiYield && choice === 'extra-sheet' && my.remainder > 0)
        ? (my.yieldPerSheet - my.remainder) : 0;

      return {
        outputIndex: outputIndex,
        partName: output.partName,
        isExtra: !!output.isExtra,
        multiYield: my.multiYield,
        perUnit: my.perUnit,
        totalNeeded: my.multiYield ? my.totalNeeded : poQty * my.perUnit,
        yieldPerSheet: my.multiYield ? my.yieldPerSheet : 0,
        fullSheets: my.multiYield ? my.fullSheets : rowPhysical,
        remainder: my.multiYield ? my.remainder : 0,
        choice: choice,
        surplus: surplus,
        rowPhysicalSheets: rowPhysical
      };
    });

    var physicalSheets = outputs.length === 0 ? poQty : 0;
    rows.forEach(function (r) {
      if (r.rowPhysicalSheets > physicalSheets) physicalSheets = r.rowPhysicalSheets;
    });

    return {
      sheetIndex: sheetIndex,
      sizeKey: sheetSizeKey(sheet.width, sheet.height, sheet.thickness),
      width: Number(sheet.width) || 0,
      height: Number(sheet.height) || 0,
      thickness: Number(sheet.thickness) || 0,
      physicalSheets: physicalSheets,
      rows: rows
    };
  });
}

// { sizeKey: totalPhysicalSheetsNeeded } across every sheet-type in the plan.
function computeOrderStockNeed(sheets, poQty, decisionsMap) {
  var need = {};
  computeOrderSheetPlan(sheets, poQty, decisionsMap).forEach(function (s) {
    need[s.sizeKey] = (need[s.sizeKey] || 0) + s.physicalSheets;
  });
  return need;
}

// Build the Orders.MultiYieldDecisions map at PO creation. chosenMap is the
// partial { "s:o": "extra-sheet"|"scrap" } from the PO form; anything missing
// or invalid becomes 'pending' (decide later).
function buildMultiYieldDecisions(sheets, poQty, chosenMap) {
  var decisions = {};
  (sheets || []).forEach(function (sheet, sheetIndex) {
    (sheet.outputs || []).forEach(function (output, outputIndex) {
      var my = computeMultiYieldForOutput(output, poQty);
      if (!my.multiYield || my.remainder <= 0) return;
      var key = multiYieldDecisionKey(sheetIndex, outputIndex);
      var chosen = chosenMap && chosenMap[key];
      var choice = (chosen === 'extra-sheet' || chosen === 'scrap') ? chosen : 'pending';
      decisions[key] = {
        partName: my.partName,
        totalNeeded: my.totalNeeded,
        yieldPerSheet: my.yieldPerSheet,
        fullSheets: my.fullSheets,
        remainder: my.remainder,
        choice: choice,
        decidedAt: choice === 'pending' ? null : nowIso()
      };
    });
  });
  return decisions;
}

function hasPendingMultiYield(decisionsMap) {
  if (!decisionsMap) return false;
  return Object.keys(decisionsMap).some(function (k) {
    return decisionsMap[k] && decisionsMap[k].choice === 'pending';
  });
}
