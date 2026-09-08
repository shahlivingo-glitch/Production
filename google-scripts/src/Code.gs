function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

var GET_ACTIONS = {
  cuttingConfigModels: function (p) { return listCuttingConfigModels(); },
  modelParts: function (p) { return getModelParts(p.modelName); },
  cuttingConfigPlans: function (p) { return listCuttingConfigPlans(p.modelName); },
  cuttingConfigPlan: function (p) { return getCuttingConfigPlan(p.modelName, p.planName); },
  orders: function (p) { return listOrders(); },
  pendingOrders: function (p) { return listPendingOrders(); },
  order: function (p) { return getOrder(p.poNumber); },
  previewNextPoNumber: function (p) { return previewNextPoNumber(); },
  planVersionsForModel: function (p) { return listPlanVersionsForModel(p.modelName); },
  planVersion: function (p) { return getPlanVersion(p.versionId); },
  cuttingExtras: function (p) { return listCuttingExtras(p.poNumber); },
  runSetup: function (p) {
    setupSpreadsheet();
    return { ran: true };
  }
};

var POST_ACTIONS = {
  createCuttingConfigModel: function (b) { return createCuttingConfigModel(b); },
  createCuttingConfigPlan: function (b) { return createCuttingConfigPlan(b); },
  deleteCuttingConfigModel: function (b) { return deleteCuttingConfigModel(b); },
  deleteCuttingConfigPlan: function (b) { return deleteCuttingConfigPlan(b); },
  saveModelParts: function (b) { return saveModelParts(b); },
  removeCuttingConfigPart: function (b) { return removeCuttingConfigPart(b); },
  saveCuttingConfigPlan: function (b) { return saveCuttingConfigPlan(b); },
  createOrder: function (b) { return createOrder(b); },
  setSheetComplete: function (b) { return setSheetComplete(b); },
  markAllSheetsComplete: function (b) { return markAllSheetsComplete(b); },
  activePlanVersionForOrder: function (b) { return getActivePlanVersionForOrder(b); },
  saveNewPlanVersion: function (b) { return saveNewPlanVersion(b); },
  setActivePlanVersionForOrder: function (b) { return setActivePlanVersionForOrder(b); },
  addCuttingExtra: function (b) { return addCuttingExtra(b); }
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
