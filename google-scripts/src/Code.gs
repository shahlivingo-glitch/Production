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
  var activeVersion = getActivePlanVersionForOrder({ poNumber: poNumber });
  return {
    order: order,
    activeVersion: activeVersion,
    extras: listCuttingExtras(poNumber),
    allModels: listCuttingConfigModels(),
    knownExtraParts: listKnownExtraParts(),
    modelParts: getModelParts(order.modelName),
    versionHistory: listPlanVersionsForModel(order.modelName),
    // { partName: qty } already sitting in the Leftover Ledger for this
    // model - purely informational "already available" badge in the
    // Cutting Plan tab, doesn't affect the cutting math at all.
    leftoverByPart: getLeftoverByPartForSheets(order.modelName, activeVersion.sheets)
  };
}

// Same idea as getOrderDetailBundle: the Production Order Form's initial
// load used to fire 4 parallel round trips (models, orders, sheet stock,
// next PO number) - each still pays Apps Script's ~3-5s-per-call dispatch
// overhead regardless of running in parallel client-side. One execution,
// one round trip.
function getOrdersFormBundle() {
  return {
    models: listCuttingConfigModels(),
    orders: listOrders(),
    sheetStock: listSheetStock(),
    nextPoNumber: generatePoNumber()
  };
}

// Raw Sheet Stock's initial load: 2 parallel calls (on-hand levels + recent
// movements) collapsed into 1, same reasoning as above.
function getSheetStockBundle(limit) {
  return {
    stock: listSheetStock(),
    log: listSheetStockLog(limit)
  };
}

// --- Access control -------------------------------------------------------
// Every action requires a valid session token EXCEPT the 3 below (you can't
// have a token before you've logged in, or before the very first admin
// account exists). Beyond "is signed in", most actions ALSO belong to one of
// the 6 page menus (Auth.gs's MENU_KEYS) and need 'view' (reads) or 'edit'
// (writes) on that menu specifically - admins bypass this part entirely.
// A few reference reads used across multiple pages' own workflows (e.g. the
// model dropdown on the PO form) are left at "just signed in", not tied to
// one page's grant - see the comment below ACTION_MENUS.
// runSetup is public too: it only (re)writes tab/header labels from the
// constant TAB_HEADERS - no data exposed or mutated - and it has to be
// callable before any user/session exists yet (it's what CREATES the
// Users/Sessions tabs in the first place on a fresh spreadsheet).
var PUBLIC_ACTIONS = { bootstrapStatus: true, login: true, createInitialAdmin: true, runSetup: true };

var ACTION_MENUS = {
  // Cutting Configuration
  createCuttingConfigModel: ['cuttingConfig', 'edit'],
  createCuttingConfigPlan: ['cuttingConfig', 'edit'],
  deleteCuttingConfigModel: ['cuttingConfig', 'edit'],
  deleteCuttingConfigPlan: ['cuttingConfig', 'edit'],
  saveModelParts: ['cuttingConfig', 'edit'],
  removeCuttingConfigPart: ['cuttingConfig', 'edit'],
  saveCuttingConfigPlan: ['cuttingConfig', 'edit'],
  modelParts: ['cuttingConfig', 'view'],

  // Production Order Form
  orders: ['orders', 'view'],
  order: ['orders', 'view'],
  createOrder: ['orders', 'edit'],
  previewNextPoNumber: ['orders', 'view'],
  ordersFormBundle: ['orders', 'view'],

  // Cutting Stage
  pendingOrders: ['cuttingStage', 'view'],
  orderDetailBundle: ['cuttingStage', 'view'],
  setSheetComplete: ['cuttingStage', 'edit'],
  setSheetQtyOverride: ['cuttingStage', 'edit'],
  markAllSheetsComplete: ['cuttingStage', 'edit'],
  activePlanVersionForOrder: ['cuttingStage', 'edit'],
  saveNewPlanVersion: ['cuttingStage', 'edit'],
  setActivePlanVersionForOrder: ['cuttingStage', 'edit'],
  addCuttingExtra: ['cuttingStage', 'edit'],
  setMultiYieldDecision: ['cuttingStage', 'edit'],
  planVersionsForModel: ['cuttingStage', 'view'],
  planVersion: ['cuttingStage', 'view'],
  cuttingExtras: ['cuttingStage', 'view'],
  knownExtraParts: ['cuttingStage', 'view'],

  // Bending Stage
  pendingBendingOrders: ['bendingStage', 'view'],
  bendingQueueForOrder: ['bendingStage', 'view'],
  setBendingComplete: ['bendingStage', 'edit'],
  markAllBendingComplete: ['bendingStage', 'edit'],

  // Extra Part Inventory (view-only page - no edit actions exist for it)
  extraPartInventory: ['extraInventory', 'view'],

  // Raw Sheet Stock
  sheetStockLog: ['sheetStock', 'view'],
  sheetStockBundle: ['sheetStock', 'view'],
  receiveSheetStock: ['sheetStock', 'edit'],
  adjustSheetStock: ['sheetStock', 'edit']
  // cuttingConfigModels/cuttingConfigPlans/cuttingConfigPlan/sheetStock and
  // dashboardSummary/whoAmI/logout/changeOwnPassword/listUsers/createUser/
  // updateUserPermissions/resetUserPassword/deleteUser are intentionally
  // absent here - they fall through to "just needs to be signed in" below.
  // The model/plan/stock reads are genuinely cross-page (e.g. the PO form's
  // model dropdown and stock-shortage check don't require Cutting
  // Configuration or Raw Sheet Stock access to use); the user-management
  // actions enforce admin-only themselves (Auth.gs's requireAdmin), and
  // dashboardSummary is meant for every signed-in user regardless of menus.
};

function checkAccess(token, action) {
  if (PUBLIC_ACTIONS[action]) {
    return;
  }
  var userRow = getSessionUser(token);
  if (!userRow) {
    throw new Error('Not signed in.');
  }
  var rule = ACTION_MENUS[action];
  if (rule && userRow.Role !== 'admin') {
    var perms = parseJsonSafe(userRow.Permissions, {});
    var have = perms[rule[0]] || 'none';
    var needed = rule[1];
    var ok = needed === 'view' ? (have === 'view' || have === 'edit') : have === 'edit';
    if (!ok) {
      throw new Error('You do not have access to this section. Ask an admin to grant it.');
    }
  }
}

var GET_ACTIONS = {
  bootstrapStatus: function (p) { return bootstrapStatus(); },
  whoAmI: function (p) { return whoAmI(p); },
  dashboardSummary: function (p) { return getDashboardSummary(); },
  cuttingConfigModels: function (p) { return listCuttingConfigModels(); },
  modelParts: function (p) { return getModelParts(p.modelName); },
  cuttingConfigPlans: function (p) { return listCuttingConfigPlans(p.modelName); },
  cuttingConfigPlan: function (p) { return getCuttingConfigPlan(p.modelName, p.planName); },
  orders: function (p) { return listOrders(); },
  pendingOrders: function (p) { return listPendingOrders(); },
  order: function (p) { return getOrder(p.poNumber); },
  orderDetailBundle: function (p) { return getOrderDetailBundle(p.poNumber); },
  previewNextPoNumber: function (p) { return previewNextPoNumber(); },
  ordersFormBundle: function (p) { return getOrdersFormBundle(); },
  planVersionsForModel: function (p) { return listPlanVersionsForModel(p.modelName); },
  planVersion: function (p) { return getPlanVersion(p.versionId); },
  cuttingExtras: function (p) { return listCuttingExtras(p.poNumber); },
  extraPartInventory: function (p) { return listExtraPartInventory(); },
  knownExtraParts: function (p) { return listKnownExtraParts(); },
  pendingBendingOrders: function (p) { return listPendingBendingOrders(); },
  bendingQueueForOrder: function (p) { return getBendingQueueForOrder(p.poNumber); },
  sheetStock: function (p) { return listSheetStock(); },
  sheetStockLog: function (p) { return listSheetStockLog(p.limit); },
  sheetStockBundle: function (p) { return getSheetStockBundle(p.limit); },
  listUsers: function (p) { return listUsers(p); },
  runSetup: function (p) {
    setupSpreadsheet();
    return { ran: true };
  }
};

var POST_ACTIONS = {
  createInitialAdmin: function (b) { return createInitialAdmin(b); },
  login: function (b) { return login(b); },
  logout: function (b) { return logout(b); },
  changeOwnPassword: function (b) { return changeOwnPassword(b); },
  createUser: function (b) { return createUser(b); },
  updateUserPermissions: function (b) { return updateUserPermissions(b); },
  resetUserPassword: function (b) { return resetUserPassword(b); },
  deleteUser: function (b) { return deleteUser(b); },
  createCuttingConfigModel: function (b) { return createCuttingConfigModel(b); },
  createCuttingConfigPlan: function (b) { return createCuttingConfigPlan(b); },
  deleteCuttingConfigModel: function (b) { return deleteCuttingConfigModel(b); },
  deleteCuttingConfigPlan: function (b) { return deleteCuttingConfigPlan(b); },
  saveModelParts: function (b) { return saveModelParts(b); },
  removeCuttingConfigPart: function (b) { return removeCuttingConfigPart(b); },
  saveCuttingConfigPlan: function (b) { return saveCuttingConfigPlan(b); },
  createOrder: function (b) { return createOrder(b); },
  setSheetComplete: function (b) { return setSheetComplete(b); },
  setSheetQtyOverride: function (b) { return setSheetQtyOverride(b); },
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
    checkAccess(e.parameter.token, e.parameter.action);
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
    checkAccess(body.token, body.action);
    return jsonOutput({ ok: true, data: handler(body) });
  } catch (err) {
    return jsonOutput({ ok: false, error: err.message });
  }
}
