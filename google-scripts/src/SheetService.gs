var TAB_HEADERS = {
  Orders: ['OrderID', 'ModelNoName', 'Qty', 'DXFRefNo', 'ColourPlan', 'DeliveryDeadline', 'CustomerName', 'Status', 'CreatedAt', 'CreatedBy'],
  ModelSettings: ['ModelNoName', 'SheetSequence', 'PartsPerSheet', 'BOM', 'CuttingTimeTarget', 'BendingTimeTarget', 'AssemblyTimeTarget', 'FittingTimeTarget', 'UpdatedAt', 'UpdatedBy'],
  CuttingLog: ['LogID', 'OrderID', 'ModelNoName', 'SheetCode', 'SheetSequencePos', 'Status', 'StartedAt', 'CompletedAt', 'OperatorID', 'Points'],
  CuttingQC: ['QCID', 'OrderID', 'SheetCode', 'CheckedQty', 'ExpectedQty', 'Result', 'FailAction', 'CheckerID', 'Timestamp'],
  BendingQueue: ['QueueID', 'OrderID', 'PartName', 'SheetCode', 'Qty', 'Status', 'Priority', 'StartedAt', 'CompletedAt', 'OperatorID', 'Points'],
  BendingQC: ['QCID', 'OrderID', 'PartName', 'SheetCode', 'CheckedQty', 'ExpectedQty', 'Result', 'FailAction', 'CheckerID', 'Timestamp'],
  AssemblyLog: ['LogID', 'OrderID', 'ModelNoName', 'Qty', 'PlannedBOM', 'ActualBOM', 'InventoryShortageFlag', 'StartedAt', 'CompletedAt', 'OperatorID'],
  PowderQueue: ['QueueID', 'OrderID', 'ModelNoName', 'Colour', 'Qty', 'Status', 'PlannedPowderKg', 'ActualPowderKg', 'FromMainStockKg', 'FromPersonalStockKg', 'LeftoverKg', 'OperatorID', 'StartedAt', 'CompletedAt'],
  PowderMainStock: ['Colour', 'CurrentKg', 'LastVerifiedKg', 'LastVerifiedBy', 'LastVerifiedAt'],
  PowderPersonalStock: ['OperatorID', 'Colour', 'CurrentKg', 'LastVerifiedKg', 'LastVerifiedBy', 'LastVerifiedAt'],
  FittingLog: ['LogID', 'OrderID', 'ModelNoName', 'Qty', 'KitList', 'ReturnedQty', 'ReturnedConfirmedByFitter', 'ReturnedConfirmedByChecker', 'StartedAt', 'CompletedAt', 'OperatorID'],
  QCLog: ['LogID', 'OrderID', 'Stage', 'ItemRef', 'Result', 'FailAction', 'CheckerID', 'Timestamp', 'Notes'],
  InventoryLive: ['SKU', 'ItemName', 'CurrentStock', 'LastSyncedAt'],
  Users: ['UserID', 'Name', 'PIN', 'Role', 'Stages', 'Active', 'CreatedAt']
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
    if (rows[i][idColumn] === idValue) return rows[i];
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
