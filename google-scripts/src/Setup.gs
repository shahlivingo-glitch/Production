// Simple triggers (onOpen/onEdit) only fire in a CONTAINER-BOUND script,
// and this project is standalone - so the Sheet's "Almirah Tracker" menu
// is gone. setupSpreadsheet is still reachable over the API
// (GET ?action=runSetup), which is how it is actually invoked anyway.
//
// onEdit matters more: it bumps the shared tab cache version so a manual
// Sheet edit invalidates cached reads. As a simple trigger it no longer
// fires, so installTriggers() below registers it as an INSTALLABLE trigger
// on the spreadsheet instead. Run that once from the editor after setup.
function installTriggers() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Set the SPREADSHEET_ID script property first.');

  // Drop any previous registration so re-running never stacks duplicates.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onEdit') ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('onEdit').forSpreadsheet(id).onEdit().create();
  return { installed: 'onEdit' };
}

function setupSpreadsheet() {
  var ss = getSpreadsheet();
  Object.keys(TAB_HEADERS).forEach(function (tabName) {
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
    }
    var headers = TAB_HEADERS[tabName];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    bumpSharedTabVersion(tabName);
    sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setNumberFormat('@');
  });
  SpreadsheetApp.flush();
  try {
    ss.toast('Sheets are set up.', 'Almirah Tracker', 5);
  } catch (err) {
    // no UI session open (e.g. triggered via the API) - setup itself already succeeded
  }
}
