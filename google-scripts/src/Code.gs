function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Cutting Stage's openOrder() used to fire this as 3 sequential round trips
// (5 parallel calls, then modelParts, then planVersionsForModel - each
// dependent on the previous wave's result) - on Apps Script's ~3-5s-per-call
// overhead that's 9-15s just to open a PO. Bundling them into one execution
// cuts it to a single round trip; the per-request sheet-read cache in
// SheetService.gs already dedupes any tab these sub-calls share (e.g. both
// getOrder and getActivePlanVersionForOrder touch Orders).
function getOrderDetailBundle(poNumber) {
  var order = getOrder(poNumber);
  return {
    order: order,
    activeVersion: getActivePlanVersionForOrder({ poNumber: poNumber }),
    extras: listCuttingExtras(poNumber),
    allModels: listCuttingConfigModels(),
    knownExtraParts: listKnownExtraParts(),
    modelParts: getModelParts(order.modelName),
    versionHistory: listPlanVersionsForModel(order.modelName)
  };
}

var GET_ACTIONS = {
  cuttingConfigModels: function (p) { return listCuttingConfigModels(); },
  modelParts: function (p) { return getModelParts(p.modelName); },
  cuttingConfigPlans: function (p) { return listCuttingConfigPlans(p.modelName); },
  cuttingConfigPlan: function (p) { return getCuttingConfigPlan(p.modelName, p.planName); },
  orders: function (p) { return listOrders(); },
  pendingOrders: function (p) { return listPendingOrders(); },
  order: function (p) { return getOrder(p.poNumber); },
  orderDetailBundle: function (p) { return getOrderDetailBundle(p.poNumber); },
  previewNextPoNumber: function (p) { return previewNextPoNumber(); },
  planVersionsForModel: function (p) { return listPlanVersionsForModel(p.modelName); },
  planVersion: function (p) { return getPlanVersion(p.versionId); },
  cuttingExtras: function (p) { return listCuttingExtras(p.poNumber); },
  extraPartInventory: function (p) { return listExtraPartInventory(); },
  knownExtraParts: function (p) { return listKnownExtraParts(); },
  pendingBendingOrders: function (p) { return listPendingBendingOrders(); },
  bendingQueueForOrder: function (p) { return getBendingQueueForOrder(p.poNumber); },
  sheetStock: function (p) { return listSheetStock(); },
  sheetStockLog: function (p) { return listSheetStockLog(p.limit); },
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
  addCuttingExtra: function (b) { return addCuttingExtra(b); },
  setBendingComplete: function (b) { return setBendingComplete(b); },
  markAllBendingComplete: function (b) { return markAllBendingComplete(b); },
  setMultiYieldDecision: function (b) { return setMultiYieldDecision(b); },
  receiveSheetStock: function (b) { return receiveSheetStock(b); },
  adjustSheetStock: function (b) { return adjustSheetStock(b); }
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
