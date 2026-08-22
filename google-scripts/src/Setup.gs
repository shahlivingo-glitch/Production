function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Almirah Tracker')
    .addItem('Run Sheet Setup', 'setupSpreadsheet')
    .addToUi();
}

function setupSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TAB_HEADERS).forEach(function (tabName) {
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
    }
    var headers = TAB_HEADERS[tabName];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setNumberFormat('@');
  });
  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }
  SpreadsheetApp.flush();
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('All tabs are set up.', 'Almirah Tracker', 5);
  } catch (err) {
    // no UI session open (e.g. triggered via the API) - setup itself already succeeded
  }
}
