function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return jsonOutput({ ok: false, error: 'Not configured yet - starting fresh.' });
}

function doPost(e) {
  return jsonOutput({ ok: false, error: 'Not configured yet - starting fresh.' });
}
