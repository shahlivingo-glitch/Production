function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

var GET_ACTIONS = {
  cuttingConfigModels: function (p) { return listCuttingConfigModels(); },
  cuttingConfigModel: function (p) { return getCuttingConfigModel(p.modelName); },
  runSetup: function (p) {
    setupSpreadsheet();
    return { ran: true };
  }
};

var POST_ACTIONS = {
  createCuttingConfigModel: function (b) { return createCuttingConfigModel(b); },
  deleteCuttingConfigModel: function (b) { return deleteCuttingConfigModel(b); },
  saveCuttingConfigModel: function (b) { return saveCuttingConfigModel(b); }
};

function doGet(e) {
  var handler = GET_ACTIONS[e.parameter.action];
  if (!handler) {
    return jsonOutput({ ok: false, error: 'Unknown action: ' + e.parameter.action });
  }
  try {
    return jsonOutput({ ok: true, data: handler(e.parameter) });
  } catch (err) {
    return jsonOutput({ ok: false, error: err.message });
  }
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOutput({ ok: false, error: 'Invalid request body' });
  }

  var handler = POST_ACTIONS[body.action];
  if (!handler) {
    return jsonOutput({ ok: false, error: 'Unknown action: ' + body.action });
  }
  try {
    return jsonOutput({ ok: true, data: handler(body) });
  } catch (err) {
    return jsonOutput({ ok: false, error: err.message });
  }
}
