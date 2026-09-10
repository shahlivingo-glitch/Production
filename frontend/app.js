var API_URL = 'https://script.google.com/macros/s/AKfycbycgBW8zp3sF20h90ZqpxLFGQ-kBO2Z6yKCkjcnnXbXMcr1ZI2HSqa3onKmu-n70n6Qcw/exec';

function el(id) { return document.getElementById(id); }

function apiGet(action, params) {
  var url = new URL(API_URL);
  url.searchParams.set('action', action);
  Object.keys(params || {}).forEach(function (k) {
    url.searchParams.set(k, params[k]);
  });
  return fetch(url.toString()).then(function (r) { return r.json(); });
}

function apiPost(action, payload) {
  var body = Object.assign({ action: action }, payload || {});
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  }).then(function (r) { return r.json(); });
}

function showFatalError(err) {
  alert('Something went wrong: ' + (err && err.message ? err.message : err));
}

// Client-side mirror of MultiYield.gs / computeOrderSheetPlan - kept in sync so
// the PO form and Cutting Stage can show the sheet math instantly without a
// round trip. sheets = active plan sheets, qty = PO qty, decisions =
// Orders.MultiYieldDecisions ({} on the PO form; pass a
// { "s:o": "extra-sheet"|"scrap" } choices map there instead).
//
// Shared-sheet model: one physical cut of a sheet yields every output row's
// per-sheet amount at once (a plain row's per-sheet amount = its per-unit qty;
// a multiYield row's = yieldPerSheet). So a sheet-type is cut as many times as
// its HUNGRIEST row needs (max of floor(need/yield)); every other row on it
// overproduces and the surplus posts to the Leftover Ledger. Only the binding
// row gets a "remainder" and the extra-sheet/scrap decision.
function sheetSizeKeyClient(w, h, t) {
  return (Number(w) || 0) + 'x' + (Number(h) || 0) + 'x' + (Number(t) || 0);
}

function computeSheetPlanClient(sheets, qty, decisions) {
  qty = Number(qty) || 0;
  decisions = decisions || {};
  return (sheets || []).map(function (sheet, sheetIndex) {
    var outputs = sheet.outputs || [];

    var rows = outputs.map(function (output, outputIndex) {
      var perUnit = Number(output.qty) || 0;
      var yps = Number(output.yieldPerSheet) || 0;
      var isMulti = !!output.multiYield && yps >= 1;
      var perSheetYield = isMulti ? yps : perUnit;   // plain row: 1 cut = perUnit
      var need = qty * perUnit;
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

    // Binding row = highest floor; when tied, prefer one with a remainder
    // (that's the row that needs a decision).
    var baseSheets = outputs.length === 0 ? qty : 0;
    var binding = null;
    rows.forEach(function (r) {
      if (r.floorSheets > baseSheets) baseSheets = r.floorSheets;
    });
    rows.forEach(function (r) {
      if (r.floorSheets === baseSheets && (!binding || (r.remainder > 0 && binding.remainder === 0))) {
        binding = r;
      }
    });

    var decisionKey = null;
    var bindingRemainder = 0;
    var choice = null;
    if (binding && binding.remainder > 0) {
      decisionKey = sheetIndex + ':' + binding.outputIndex;
      bindingRemainder = binding.remainder;
      var d = decisions[decisionKey];
      choice = (d && typeof d === 'object') ? d.choice : (typeof d === 'string' ? d : null);
      if (!choice) choice = 'pending';
    }

    var physicalSheets = baseSheets + (choice === 'extra-sheet' ? 1 : 0);

    rows.forEach(function (r) {
      r.isBinding = binding && r.outputIndex === binding.outputIndex;
      r.produced = physicalSheets * r.yieldPerSheet;
      // binding row on 'scrap' cuts exactly baseSheets and makes up the
      // remainder elsewhere, so it isn't credited the +0 rounding surplus
      r.surplus = Math.max(0, r.produced - r.totalNeeded);
      r.shortOnScrap = (r.isBinding && choice === 'scrap') ? r.remainder : 0;
    });

    return {
      sheetIndex: sheetIndex,
      sizeKey: sheetSizeKeyClient(sheet.width, sheet.height, sheet.thickness),
      width: Number(sheet.width) || 0,
      height: Number(sheet.height) || 0,
      thickness: Number(sheet.thickness) || 0,
      baseSheets: baseSheets,
      physicalSheets: physicalSheets,
      decisionKey: decisionKey,
      bindingRemainder: bindingRemainder,
      choice: choice,
      rows: rows
    };
  });
}

function computeStockNeedClient(sheets, qty, decisions) {
  var need = {};
  computeSheetPlanClient(sheets, qty, decisions).forEach(function (s) {
    need[s.sizeKey] = (need[s.sizeKey] || 0) + s.physicalSheets;
  });
  return need;
}

document.addEventListener('DOMContentLoaded', function () {
  if (typeof initCuttingConfig === 'function') {
    initCuttingConfig();
  }
});
