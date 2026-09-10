function nowIso() {
  return new Date().toISOString();
}

function parseJsonSafe(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'object') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function generateId(prefix) {
  return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
}

function padNumber(n, width) {
  var s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

function flattenPlanOutputs(sheets) {
  var entries = [];
  (sheets || []).forEach(function (sheet, sheetIndex) {
    (sheet.outputs || []).forEach(function (output, outputIndex) {
      entries.push({
        sheetIndex: sheetIndex,
        outputIndex: outputIndex,
        partName: output.partName,
        qty: Number(output.qty) || 0,
        isExtra: !!output.isExtra,
        size: output.size || '',
        multiYield: !!output.multiYield,
        yieldPerSheet: Number(output.yieldPerSheet) || 0
      });
    });
  });
  return entries;
}
