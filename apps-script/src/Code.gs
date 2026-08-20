function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var action = e.parameter.action;
  try {
    if (action === 'users') {
      return jsonOutput({ ok: true, data: getUsersForLogin() });
    }
    return jsonOutput({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonOutput({ ok: false, error: err.message });
  }
}

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOutput({ ok: false, error: 'Invalid request body' });
  }

  try {
    if (body.action === 'login') {
      return jsonOutput(validatePinAndLogin(body.userId, body.pin));
    }
    return jsonOutput({ ok: false, error: 'Unknown action: ' + body.action });
  } catch (err) {
    return jsonOutput({ ok: false, error: err.message });
  }
}
