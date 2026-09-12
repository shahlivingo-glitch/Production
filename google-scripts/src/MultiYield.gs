// Multi-yield cutting math. Pure functions (no sheet I/O) so the same logic
// runs on the PO form (projection) and in Cutting Stage. Mirrored client-side
// in app.js as computeSheetPlanClient - keep the two in sync.
//
// Shared-sheet model: one physical cut of a sheet yields EVERY output row's
// per-sheet amount at once. A plain row's per-sheet amount is its per-unit qty
// (the classic "1 sheet = 1 unit's worth"); a multiYield row's is
// yieldPerSheet. So a sheet-type is cut as many times as its hungriest row
// needs - max of floor(need / perSheetYield) - and every other row on it
// overproduces, with the surplus posting to the Leftover Ledger at cut time.
// Only the binding row can have a leftover "remainder", and only it gets the
// extra-full-sheet vs cut-on-scrap decision.

function multiYieldDecisionKey(sheetIndex, outputIndex) {
  return sheetIndex + ':' + outputIndex;
}

// Orders.SheetQtyOverrides is a { "<sheetIndex>": physicalSheets } map that
// replaces the auto-calculated physical sheet count for that sheet-type,
// wherever it's set. Refined over an order's life: the PO form can set an
// entry at creation (a manual override of the calculated default), and
// Cutting Stage overwrites it with the actual sheets cut once that sheet is
// marked done - always the latest known truth for that sheet-type. Sanitize
// on the way in so a bad/stale key or a negative or non-numeric value never
// reaches the sheet math.
function sanitizeSheetQtyOverrides(raw, sheetCount) {
  var out = {};
  if (!raw || typeof raw !== 'object') return out;
  Object.keys(raw).forEach(function (k) {
    var idx = Number(k);
    if (isNaN(idx) || idx < 0 || (sheetCount !== undefined && idx >= sheetCount)) return;
    var v = Number(raw[k]);
    if (isNaN(v) || v < 0) return;
    out[String(idx)] = v;
  });
  return out;
}

// Per sheet-type breakdown for a PO. decisionsMap is Orders.MultiYieldDecisions
// (may be {} or a partial { "s:o": "extra-sheet"|"scrap" } from the PO form).
// physicalOverrides is Orders.SheetQtyOverrides (see above) - when a sheet-
// index has an entry, it replaces the calculated physicalSheets for that
// sheet-type before the per-row produced/surplus/shortOnScrap math runs, so
// every downstream number (stock need, Leftover Ledger surplus, the "need X,
// actual Y x qty/sheet" summary) is consistent with the override.
function computeOrderSheetPlan(sheets, poQty, decisionsMap, physicalOverrides) {
  poQty = Number(poQty) || 0;
  decisionsMap = decisionsMap || {};
  physicalOverrides = physicalOverrides || {};

  return (sheets || []).map(function (sheet, sheetIndex) {
    var outputs = sheet.outputs || [];

    var rows = outputs.map(function (output, outputIndex) {
      var perUnit = Number(output.qty) || 0;
      var yps = Number(output.yieldPerSheet) || 0;
      var isMulti = !!output.multiYield && yps >= 1;
      var perSheetYield = isMulti ? yps : perUnit;
      var need = poQty * perUnit;
      var floorSheets = perSheetYield > 0 ? Math.floor(need / perSheetYield) : 0;
      var remainder = perSheetYield > 0 ? (need % perSheetYield) : 0;
      return {
        outputIndex: outputIndex,
        partName: output.partName,
        isExtra: !!output.isExtra,
        multiYield: isMulti,
        perUnit: perUnit,
        totalNeeded: need,
        yieldPerSheet: perSheetYield,
        floorSheets: floorSheets,
        remainder: remainder
      };
    });

    var baseSheets = outputs.length === 0 ? poQty : 0;
    rows.forEach(function (r) {
      if (r.floorSheets > baseSheets) baseSheets = r.floorSheets;
    });
    var binding = null;
    rows.forEach(function (r) {
      if (r.floorSheets === baseSheets && (!binding || (r.remainder > 0 && binding.remainder === 0))) {
        binding = r;
      }
    });

    var decisionKey = null;
    var bindingRemainder = 0;
    var choice = null;
    if (binding && binding.remainder > 0) {
      decisionKey = multiYieldDecisionKey(sheetIndex, binding.outputIndex);
      bindingRemainder = binding.remainder;
      var d = decisionsMap[decisionKey];
      choice = (d && typeof d === 'object') ? d.choice : (typeof d === 'string' ? d : null);
      if (!choice) choice = 'pending';
    }

    var physicalSheets = baseSheets + (choice === 'extra-sheet' ? 1 : 0);
    var overridden = physicalOverrides[String(sheetIndex)];
    if (overridden !== undefined) {
      physicalSheets = overridden;
    }

    rows.forEach(function (r) {
      r.isBinding = !!(binding && r.outputIndex === binding.outputIndex);
      r.produced = physicalSheets * r.yieldPerSheet;
      r.surplus = Math.max(0, r.produced - r.totalNeeded);
      r.shortOnScrap = (r.isBinding && choice === 'scrap') ? r.remainder : 0;
    });

    return {
      sheetIndex: sheetIndex,
      sizeKey: sheetSizeKey(sheet.width, sheet.height, sheet.thickness),
      width: Number(sheet.width) || 0,
      height: Number(sheet.height) || 0,
      thickness: Number(sheet.thickness) || 0,
      baseSheets: baseSheets,
      physicalSheets: physicalSheets,
      overridden: overridden !== undefined,
      decisionKey: decisionKey,
      bindingRemainder: bindingRemainder,
      choice: choice,
      rows: rows
    };
  });
}

// { sizeKey: totalPhysicalSheetsNeeded } across every sheet-type in the plan.
function computeOrderStockNeed(sheets, poQty, decisionsMap, physicalOverrides) {
  var need = {};
  computeOrderSheetPlan(sheets, poQty, decisionsMap, physicalOverrides).forEach(function (s) {
    need[s.sizeKey] = (need[s.sizeKey] || 0) + s.physicalSheets;
  });
  return need;
}

// Build the Orders.MultiYieldDecisions map at PO creation - one entry per
// sheet-type whose binding row has a remainder. chosenMap is the partial
// { "s:o": "extra-sheet"|"scrap" } from the PO form; missing/invalid → 'pending'.
function buildMultiYieldDecisions(sheets, poQty, chosenMap) {
  var decisions = {};
  computeOrderSheetPlan(sheets, poQty, {}).forEach(function (sheetPlan) {
    if (!sheetPlan.decisionKey) return;
    var bindingRow = null;
    sheetPlan.rows.forEach(function (r) { if (r.isBinding) bindingRow = r; });
    if (!bindingRow) return;
    var chosen = chosenMap && chosenMap[sheetPlan.decisionKey];
    var choice = (chosen === 'extra-sheet' || chosen === 'scrap') ? chosen : 'pending';
    decisions[sheetPlan.decisionKey] = {
      partName: bindingRow.partName,
      totalNeeded: bindingRow.totalNeeded,
      yieldPerSheet: bindingRow.yieldPerSheet,
      fullSheets: bindingRow.floorSheets,
      remainder: bindingRow.remainder,
      choice: choice,
      decidedAt: choice === 'pending' ? null : nowIso()
    };
  });
  return decisions;
}

function hasPendingMultiYield(decisionsMap) {
  if (!decisionsMap) return false;
  return Object.keys(decisionsMap).some(function (k) {
    return decisionsMap[k] && decisionsMap[k].choice === 'pending';
  });
}
