var TAB_HEADERS = {
  Models: ['ModelName', 'PartsPerUnit', 'UpdatedAt'],
  CuttingPlans: ['ModelName', 'PlanName', 'Sheets', 'UpdatedAt', 'PlanType', 'BaseQty'],
  Orders: ['PoNumber', 'ModelName', 'PlanName', 'Qty', 'DxfRefNo', 'ColourPlan', 'DeliveryDeadline', 'PartyName', 'PlanVersionId', 'SheetCompletion', 'BendingCompletion', 'TotalSheetsRequired', 'CuttingStatus', 'BendingStatus', 'CreatedAt', 'MultiYieldDecisions', 'SheetStockConsumed', 'PlanType', 'BulkBaseQty', 'BulkMultiplier', 'SheetQtyOverrides', 'BendingLeftoverConsumed', 'ExtraBendingCompletion', 'PlanEntryAddedToInventory'],
  PlanVersions: ['VersionId', 'ModelName', 'VersionNumber', 'SourcePlanName', 'Sheets', 'CreatedAt', 'Note'],
  CuttingExtras: ['ExtraId', 'PoNumber', 'Type', 'Details', 'Timestamp', 'AddedToInventory'],
  ExtraPartInventory: ['ModelName', 'PartName', 'Size', 'Qty', 'UpdatedAt'],
  SheetStock: ['Size', 'Width', 'Height', 'Thickness', 'Qty', 'UpdatedAt'],
  SheetStockLog: ['LogId', 'Size', 'Delta', 'Reason', 'PoNumber', 'Timestamp', 'Note'],
  // Named AppUsers/AppSessions, not Users/Sessions - a tab literally named
  // "Users" already existed in this spreadsheet from before the project's
  // full reset (a different, unrelated login system). setupSpreadsheet()
  // only rewrites header LABELS, never touches existing data rows (gotcha
  // #2), so reusing that name would have silently relabeled that old tab's
  // stale row underneath our new columns instead of starting fresh - caught
  // live via a stray "Admin" row dated from before this rebuild even began.
  AppUsers: ['UserId', 'Username', 'PasswordHash', 'PasswordSalt', 'Role', 'Permissions', 'CreatedAt', 'CreatedBy'],
  AppSessions: ['Token', 'UserId', 'CreatedAt', 'ExpiresAt']
};

function getSheet(tabName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    throw new Error('Unknown tab: ' + tabName);
  }
  return sheet;
}

function rowsToObjects(sheet) {
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      obj[headers[c]] = row[c];
    }
    obj._rowIndex = i + 1;
    out.push(obj);
  }
  return out;
}

// Per-execution read cache. A single doGet/doPost call routinely reads the
// same tab many times over (e.g. listPendingBendingOrders reads
// CuttingPlans/PlanVersions once per order row) and every one of those was
// a fresh getDataRange().getValues() round trip - that N+1 pattern is what
// was making pages take 30+ seconds to load. This var is a fresh, empty
// object at the start of every execution (Apps Script gives each web app
// request its own runtime), so caching here never leaks stale data across
// requests - only repeat reads *within* the same request are served from
// memory. Any write (appendRow/writeRowUpdates/deleteRowsWhere) invalidates
// the affected tab immediately so a read-after-write in the same execution
// (e.g. createOrder appending then immediately re-reading its own row)
// always sees fresh data.
var _sheetRowCache = {};

function invalidateSheetCache(tabName) {
  delete _sheetRowCache[tabName];
}

function getAllRows(tabName) {
  if (!_sheetRowCache.hasOwnProperty(tabName)) {
    _sheetRowCache[tabName] = rowsToObjects(getSheet(tabName));
  }
  return _sheetRowCache[tabName];
}

function findRows(tabName, matchFn) {
  return getAllRows(tabName).filter(matchFn);
}

function findRowById(tabName, idColumn, idValue) {
  var rows = getAllRows(tabName);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][idColumn]) === String(idValue)) return rows[i];
  }
  return null;
}

function appendRow(tabName, rowObj) {
  var sheet = getSheet(tabName);
  var headers = TAB_HEADERS[tabName];
  var row = headers.map(function (h) {
    return rowObj.hasOwnProperty(h) ? rowObj[h] : '';
  });
  sheet.appendRow(row);
  invalidateSheetCache(tabName);
  return rowObj;
}

function writeRowUpdates(tabName, rowIndex, updates) {
  var sheet = getSheet(tabName);
  var headers = TAB_HEADERS[tabName];
  var idxByHeader = {};
  headers.forEach(function (h, i) {
    idxByHeader[h] = i + 1;
  });
  Object.keys(updates).forEach(function (key) {
    if (!idxByHeader.hasOwnProperty(key)) return;
    sheet.getRange(rowIndex, idxByHeader[key]).setValue(updates[key]);
  });
  invalidateSheetCache(tabName);
}

function updateRowById(tabName, idColumn, idValue, updates) {
  var existing = findRowById(tabName, idColumn, idValue);
  if (!existing) {
    throw new Error('Row not found: ' + tabName + '.' + idColumn + ' = ' + idValue);
  }
  writeRowUpdates(tabName, existing._rowIndex, updates);
  return findRowById(tabName, idColumn, idValue);
}

function findRow(tabName, matchFn) {
  var rows = getAllRows(tabName);
  for (var i = 0; i < rows.length; i++) {
    if (matchFn(rows[i])) return rows[i];
  }
  return null;
}

function updateRow(tabName, matchFn, updates) {
  var existing = findRow(tabName, matchFn);
  if (!existing) {
    throw new Error('Row not found in ' + tabName);
  }
  writeRowUpdates(tabName, existing._rowIndex, updates);
  return findRow(tabName, matchFn);
}

function deleteRowsWhere(tabName, matchFn) {
  var sheet = getSheet(tabName);
  var rows = findRows(tabName, matchFn);
  rows.sort(function (a, b) {
    return b._rowIndex - a._rowIndex;
  });
  rows.forEach(function (r) {
    sheet.deleteRow(r._rowIndex);
  });
  invalidateSheetCache(tabName);
  return rows.length;
}
