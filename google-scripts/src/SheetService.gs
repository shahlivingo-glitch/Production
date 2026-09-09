var TAB_HEADERS = {
  Models: ['ModelName', 'PartsPerUnit', 'UpdatedAt'],
  CuttingPlans: ['ModelName', 'PlanName', 'Sheets', 'UpdatedAt'],
  Orders: ['PoNumber', 'ModelName', 'PlanName', 'Qty', 'DxfRefNo', 'ColourPlan', 'DeliveryDeadline', 'PartyName', 'PlanVersionId', 'SheetCompletion', 'BendingCompletion', 'TotalSheetsRequired', 'CuttingStatus', 'BendingStatus', 'CreatedAt'],
  PlanVersions: ['VersionId', 'ModelName', 'VersionNumber', 'SourcePlanName', 'Sheets', 'CreatedAt', 'Note'],
  CuttingExtras: ['ExtraId', 'PoNumber', 'Type', 'Details', 'Timestamp'],
  ExtraPartInventory: ['ModelName', 'PartName', 'Size', 'Qty', 'UpdatedAt']
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

function getAllRows(tabName) {
  return rowsToObjects(getSheet(tabName));
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
  return rows.length;
}
