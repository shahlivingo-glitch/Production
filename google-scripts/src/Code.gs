function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var action = e.parameter.action;
  var userId = e.parameter.userId;
  try {
    if (action === 'users') {
      return jsonOutput({ ok: true, data: getUsersForLogin() });
    }
    if (action === 'orders') {
      return jsonOutput({ ok: true, data: listOrders(userId) });
    }
    if (action === 'models') {
      return jsonOutput({ ok: true, data: listModels(userId) });
    }
    if (action === 'model') {
      return jsonOutput({ ok: true, data: getModel(userId, e.parameter.modelNoName) });
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
    if (body.action === 'createOrder') {
      return jsonOutput({ ok: true, data: createOrder(body) });
    }
    if (body.action === 'saveModel') {
      return jsonOutput({ ok: true, data: saveModel(body) });
    }
    return jsonOutput({ ok: false, error: 'Unknown action: ' + body.action });
  } catch (err) {
    return jsonOutput({ ok: false, error: err.message });
  }
}
