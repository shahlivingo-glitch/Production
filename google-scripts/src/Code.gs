function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

var GET_ACTIONS = {
  users: function (p) { return getUsersForLogin(); },
  orders: function (p) { return listOrders(p.userId); },
  models: function (p) { return listModels(p.userId); },
  model: function (p) { return getModel(p.userId, p.modelNoName); },
  cuttingQueue: function (p) { return getCuttingQueue(p.userId); },
  bendingQueue: function (p) { return getBendingQueue(p.userId); },
  bendingUnlockedList: function (p) { return listUnlockedBendingQueue(p.userId); },
  readyAssemblyOrders: function (p) { return listReadyAssemblyOrders(p.userId); },
  assemblyOrderDetail: function (p) { return getAssemblyOrderDetail(p.userId, p.orderId); },
  powderQueue: function (p) { return listPowderQueue(p.userId); },
  powderStockSummary: function (p) { return getPowderStockSummary(p.userId); },
  personalStockList: function (p) { return listAllPersonalStock(p.userId); }
};

var POST_ACTIONS = {
  createOrder: function (b) { return createOrder(b); },
  saveModel: function (b) { return saveModel(b); },
  startCutting: function (b) { return startCuttingSheet(b); },
  completeCutting: function (b) { return completeCuttingSheet(b); },
  submitCuttingQC: function (b) { return submitCuttingQC(b); },
  startBending: function (b) { return startBendingPart(b); },
  completeBending: function (b) { return completeBendingPart(b); },
  submitBendingQC: function (b) { return submitBendingQC(b); },
  reorderBending: function (b) { return reorderBendingQueue(b); },
  startAssembly: function (b) { return startAssembly(b); },
  completeAssembly: function (b) { return completeAssembly(b); },
  startPowderBatch: function (b) { return startPowderBatch(b); },
  completePowderBatch: function (b) { return completePowderBatch(b); },
  verifyMainStock: function (b) { return verifyMainStock(b); },
  verifyPersonalStock: function (b) { return verifyPersonalStock(b); }
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

  if (body.action === 'login') {
    try {
      return jsonOutput(validatePinAndLogin(body.userId, body.pin));
    } catch (err) {
      return jsonOutput({ ok: false, error: err.message });
    }
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
