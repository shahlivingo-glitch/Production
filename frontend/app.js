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
// the PO form and Cutting Stage can show the multi-yield sheet math instantly
// without a round trip. sheets = active plan sheets, qty = PO qty, decisions =
// Orders.MultiYieldDecisions ({} on the PO form where nothing is saved yet;
// pass a { "s:o": "extra-sheet"|"scrap" } choices map there instead).
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
      var yieldPerSheet = Number(output.yieldPerSheet) || 0;
      var isMulti = !!output.multiYield && yieldPerSheet >= 1;
      var totalNeeded = qty * perUnit;
      var fullSheets = isMulti ? Math.floor(totalNeeded / yieldPerSheet) : qty;
      var remainder = isMulti ? (totalNeeded % yieldPerSheet) : 0;

      var key = sheetIndex + ':' + outputIndex;
      var d = decisions[key];
      var choice = (d && typeof d === 'object') ? d.choice : (typeof d === 'string' ? d : null);
      if (!choice) choice = (isMulti && remainder > 0) ? 'pending' : null;

      var rowPhysical = isMulti ? (fullSheets + (choice === 'extra-sheet' ? 1 : 0)) : qty;
      var surplus = (isMulti && choice === 'extra-sheet' && remainder > 0)
        ? (yieldPerSheet - remainder) : 0;

      return {
        outputIndex: outputIndex,
        partName: output.partName,
        isExtra: !!output.isExtra,
        multiYield: isMulti,
        perUnit: perUnit,
        totalNeeded: totalNeeded,
        yieldPerSheet: isMulti ? yieldPerSheet : 0,
        fullSheets: isMulti ? fullSheets : rowPhysical,
        remainder: remainder,
        choice: choice,
        surplus: surplus,
        rowPhysicalSheets: rowPhysical
      };
    });

    var physicalSheets = outputs.length === 0 ? qty : 0;
    rows.forEach(function (r) {
      if (r.rowPhysicalSheets > physicalSheets) physicalSheets = r.rowPhysicalSheets;
    });

    return {
      sheetIndex: sheetIndex,
      sizeKey: sheetSizeKeyClient(sheet.width, sheet.height, sheet.thickness),
      width: Number(sheet.width) || 0,
      height: Number(sheet.height) || 0,
      thickness: Number(sheet.thickness) || 0,
      physicalSheets: physicalSheets,
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
