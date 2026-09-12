var models = [];
var plans = [];
var selectedModelSheets = null;
var allOrders = [];
var sheetStockMap = {};
var multiYieldChoices = {};
var selectedPlanType = 'per-unit';
var selectedPlanBaseQty = 0;
var bulkMultiplier = 1;
var plansLoadError = null; // { modelName, message } - set when cuttingConfigPlans fails, so the dropdown isn't stuck on "Loading..." with no way out
var sheetsLoadError = null; // { modelName, planName, message } - same idea for the sheets-required section
var sheetQtyOverrides = {}; // { sheetIndex: number } - manual overrides of the calculated "Sheets Required" qty, entered on this form; reset whenever the model/plan/qty changes since the calculated baseline they were overriding no longer applies

function initOrdersForm() {
  loadModels();
  loadOrders();
  loadSheetStockForForm();
  startNewDraft();
}

function loadSheetStockForForm() {
  apiGet('sheetStock', {}).then(function (result) {
    if (!result.ok) return;
    sheetStockMap = {};
    result.data.forEach(function (r) { sheetStockMap[r.size] = r.qty; });
    renderSheetsRequired();
  }).catch(function () {});
}

function loadOrders() {
  el('po-loading').style.display = 'flex';
  el('po-error').style.display = 'none';
  el('po-table-wrap').style.display = 'none';
  el('po-table-empty').style.display = 'none';

  apiGet('orders', {}).then(function (result) {
    el('po-loading').style.display = 'none';
    if (!result.ok) {
      el('po-error').textContent = 'Could not load Production Orders: ' + result.error;
      el('po-error').style.display = 'block';
      return;
    }
    allOrders = result.data;
    renderPoTable();
  }).catch(function (err) {
    el('po-loading').style.display = 'none';
    el('po-error').textContent = 'Could not load Production Orders: ' + (err && err.message ? err.message : err);
    el('po-error').style.display = 'block';
  });
}

function loadModels() {
  apiGet('cuttingConfigModels', {}).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    models = result.data;
    renderModelDropdown();
  }).catch(showFatalError);
}

function renderModelDropdown() {
  var select = el('po-model');
  var currentValue = select.value;
  select.innerHTML = '';

  var placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '-- choose model --';
  select.appendChild(placeholder);

  models.forEach(function (name) {
    var opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });

  select.value = currentValue;
}

function startNewDraft() {
  el('po-number').value = 'Loading…';
  el('po-datetime').value = new Date().toLocaleString();
  el('po-model').value = '';
  el('po-qty').value = '';
  el('po-dxf').value = '';
  el('po-colour').value = '';
  el('po-deadline').value = '';
  el('po-party').value = '';
  el('po-plan-row').style.display = 'none';
  plans = [];
  selectedModelSheets = null;
  multiYieldChoices = {};
  sheetQtyOverrides = {};
  plansLoadError = null;
  sheetsLoadError = null;
  setSelectedPlanType('per-unit', 0);
  renderSheetsRequired();

  apiGet('previewNextPoNumber', {}).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    el('po-number').value = result.data.poNumber;
  }).catch(showFatalError);
}

function onModelChange() {
  var modelName = el('po-model').value;
  if (!modelName) {
    el('po-plan-row').style.display = 'none';
    plans = [];
    selectedModelSheets = null;
    sheetQtyOverrides = {};
    plansLoadError = null;
    sheetsLoadError = null;
    setSelectedPlanType('per-unit', 0);
    renderSheetsRequired();
    return;
  }

  el('po-plan-row').style.display = 'flex';
  loadPlansForModel(modelName);
}

// Split out of onModelChange so a failed load can be retried in place (via
// the button in renderSheetsRequired's error banner) without the "Cutting
// Plan" dropdown getting stuck showing "Loading..." forever.
function loadPlansForModel(modelName) {
  var planSelect = el('po-plan');
  planSelect.innerHTML = '<option value="">Loading…</option>';
  selectedModelSheets = undefined;
  sheetQtyOverrides = {};
  plansLoadError = null;
  sheetsLoadError = null;
  renderSheetsRequired();

  apiGet('cuttingConfigPlans', { modelName: modelName }).then(function (result) {
    if (el('po-model').value !== modelName) return;
    if (!result.ok) {
      plansLoadError = { modelName: modelName, message: result.error };
      planSelect.innerHTML = '<option value="">-- failed to load --</option>';
      renderSheetsRequired();
      return;
    }
    plans = result.data;
    renderPlanDropdown();
    if (plans.length === 0) {
      selectedModelSheets = null;
      setSelectedPlanType('per-unit', 0);
      renderSheetsRequired();
      return;
    }
    planSelect.value = plans[0].planName;
    setSelectedPlanType(plans[0].planType, plans[0].baseQty);
    loadSheetsForPlan(modelName, plans[0].planName);
  }).catch(function (err) {
    if (el('po-model').value !== modelName) return;
    plansLoadError = { modelName: modelName, message: err && err.message ? err.message : err };
    planSelect.innerHTML = '<option value="">-- failed to load --</option>';
    renderSheetsRequired();
  });
}

function renderPlanDropdown() {
  var select = el('po-plan');
  select.innerHTML = '';
  plans.forEach(function (plan) {
    var opt = document.createElement('option');
    opt.value = plan.planName;
    opt.textContent = plan.planType === 'bulk' ? plan.planName + ' (Bulk ×' + plan.baseQty + ')' : plan.planName;
    select.appendChild(opt);
  });
}

function findPlanInfo(planName) {
  return plans.filter(function (p) { return p.planName === planName; })[0] || null;
}

function setSelectedPlanType(planType, baseQty) {
  selectedPlanType = planType === 'bulk' ? 'bulk' : 'per-unit';
  selectedPlanBaseQty = Number(baseQty) || 0;
  bulkMultiplier = 1;
  renderQtyControl();
}

function renderQtyControl() {
  var isBulk = selectedPlanType === 'bulk';
  el('po-qty-wrap').style.display = isBulk ? 'none' : 'block';
  el('po-bulk-wrap').style.display = isBulk ? 'flex' : 'none';
  if (isBulk) {
    el('po-bulk-multiplier').value = bulkMultiplier;
    el('po-bulk-units').textContent = '= ' + (bulkMultiplier * selectedPlanBaseQty) + ' units';
  }
}

function onPlanChange() {
  var modelName = el('po-model').value;
  var planName = el('po-plan').value;
  if (!modelName || !planName) return;
  var info = findPlanInfo(planName);
  setSelectedPlanType(info ? info.planType : 'per-unit', info ? info.baseQty : 0);
  loadSheetsForPlan(modelName, planName);
}

function loadSheetsForPlan(modelName, planName) {
  selectedModelSheets = undefined;
  sheetsLoadError = null;
  multiYieldChoices = {};
  sheetQtyOverrides = {};
  renderSheetsRequired();
  apiGet('cuttingConfigPlan', { modelName: modelName, planName: planName }).then(function (result) {
    if (el('po-model').value !== modelName || el('po-plan').value !== planName) return;
    if (!result.ok) {
      selectedModelSheets = null;
      sheetsLoadError = { modelName: modelName, planName: planName, message: result.error };
      renderSheetsRequired();
      return;
    }
    selectedModelSheets = result.data.sheets || [];
    renderSheetsRequired();
  }).catch(function (err) {
    if (el('po-model').value !== modelName || el('po-plan').value !== planName) return;
    selectedModelSheets = null;
    sheetsLoadError = { modelName: modelName, planName: planName, message: err && err.message ? err.message : err };
    renderSheetsRequired();
  });
}

// Used for both the plans-load and sheets-load failure cases so a genuine
// failure (as opposed to a transient one already ridden out by apiGet's own
// retry) leaves the user with a clear message and a one-click way to try
// again, instead of a dead "Loading..." state.
function buildLoadErrorBanner(message, onRetry) {
  var warn = document.createElement('div');
  warn.className = 'alert-banner';
  var text = document.createElement('div');
  text.textContent = message;
  warn.appendChild(text);
  var retryBtn = document.createElement('button');
  retryBtn.type = 'button';
  retryBtn.className = 'btn-secondary';
  retryBtn.style.marginTop = 'var(--space-2)';
  retryBtn.textContent = 'Retry';
  retryBtn.addEventListener('click', onRetry);
  warn.appendChild(retryBtn);
  return warn;
}

function sheetLabel(sheet, index) {
  var dims = [sheet.width, sheet.height, sheet.thickness].filter(function (v) { return v !== undefined && v !== ''; }).join(' × ');
  return 'Sheet ' + (index + 1) + (dims ? ' — ' + dims + ' mm' : '');
}

function renderSheetsRequired() {
  var section = el('sheets-required-section');
  section.innerHTML = '';

  var modelName = el('po-model').value;
  if (!modelName) {
    var placeholder = document.createElement('div');
    placeholder.className = 'section-hint';
    placeholder.textContent = 'Select a model to see sheets required.';
    section.appendChild(placeholder);
    return;
  }

  if (plansLoadError && plansLoadError.modelName === modelName) {
    section.appendChild(buildLoadErrorBanner(
      'Could not load cutting plans for "' + modelName + '": ' + plansLoadError.message,
      function () { loadPlansForModel(modelName); }
    ));
    return;
  }

  if (plans.length === 0 && selectedModelSheets === null) {
    var noPlan = document.createElement('div');
    noPlan.className = 'alert-banner';
    noPlan.textContent = '"' + modelName + '" has no cutting plan configured — sheets required cannot be calculated.';
    section.appendChild(noPlan);
    return;
  }

  if (selectedModelSheets === undefined) {
    var loading = document.createElement('div');
    loading.className = 'section-hint';
    loading.textContent = 'Loading sheet data…';
    section.appendChild(loading);
    return;
  }

  if (selectedModelSheets === null) {
    if (sheetsLoadError && sheetsLoadError.modelName === modelName) {
      var planName = sheetsLoadError.planName;
      section.appendChild(buildLoadErrorBanner(
        'Could not load sheet data for "' + planName + '": ' + sheetsLoadError.message,
        function () { loadSheetsForPlan(modelName, planName); }
      ));
    }
    return;
  }

  if (selectedModelSheets.length === 0) {
    var warn = document.createElement('div');
    warn.className = 'alert-banner';
    warn.textContent = 'This plan has no sheets defined in Cutting Configuration — sheets required cannot be calculated.';
    section.appendChild(warn);
    return;
  }

  // effectiveN is whatever multiplies the plan's rows: the raw unit qty for
  // a per-unit plan, or the batch multiplier for a bulk plan (its sheets are
  // already totals for baseQty units, so the multiplier IS the "N").
  var effectiveN = selectedPlanType === 'bulk' ? bulkMultiplier : (Number(el('po-qty').value) || 0);
  if (!(effectiveN >= 1)) {
    var hint = document.createElement('div');
    hint.className = 'section-hint';
    hint.textContent = selectedPlanType === 'bulk'
      ? 'Choose a multiplier to calculate sheets required.'
      : 'Enter a qty to calculate sheets required.';
    section.appendChild(hint);
    return;
  }

  var plan = computeSheetPlanClient(selectedModelSheets, effectiveN, multiYieldChoices, sheetQtyOverrides);

  var box = document.createElement('div');
  box.className = 'sheets-required-box';

  var title = document.createElement('div');
  title.className = 'section-title';
  title.textContent = 'Sheets Required';
  box.appendChild(title);

  var grandTotal = 0;
  plan.forEach(function (sheetPlan, index) {
    grandTotal += sheetPlan.physicalSheets;

    var line = document.createElement('div');
    line.style.display = 'flex';
    line.style.justifyContent = 'space-between';
    line.style.alignItems = 'center';
    line.style.fontSize = '13px';
    line.style.padding = '4px 0';
    line.style.gap = 'var(--space-2)';

    var labelSpan = document.createElement('span');
    labelSpan.textContent = sheetLabel(selectedModelSheets[index], index);
    line.appendChild(labelSpan);

    var qtyWrap = document.createElement('span');
    qtyWrap.style.display = 'flex';
    qtyWrap.style.alignItems = 'center';
    qtyWrap.style.gap = '6px';

    // Auto-calculated by default, but editable - overriding it re-derives
    // everything below (per-part surplus, Total sheets to cut, and the Raw
    // Sheet Stock need/shortfall) from the typed value instead.
    var qtyInput = document.createElement('input');
    qtyInput.type = 'number';
    qtyInput.min = '0';
    qtyInput.className = 'po-sheet-qty-input';
    qtyInput.title = 'Override the calculated sheet count for this sheet type';
    qtyInput.value = sheetPlan.physicalSheets;
    qtyInput.addEventListener('change', function (e) {
      var v = Math.max(0, Math.round(Number(e.target.value) || 0));
      sheetQtyOverrides[sheetPlan.sheetIndex] = v;
      renderSheetsRequired();
    });
    qtyWrap.appendChild(qtyInput);

    var qtyUnitLabel = document.createElement('span');
    qtyUnitLabel.textContent = 'sheet' + (sheetPlan.physicalSheets === 1 ? '' : 's');
    qtyWrap.appendChild(qtyUnitLabel);

    line.appendChild(qtyWrap);
    box.appendChild(line);

    box.appendChild(buildSheetYieldDetail(sheetPlan));
  });

  var totalLine = document.createElement('div');
  totalLine.style.display = 'flex';
  totalLine.style.justifyContent = 'space-between';
  totalLine.style.fontWeight = '700';
  totalLine.style.borderTop = '2px solid var(--color-border-strong)';
  totalLine.style.marginTop = '6px';
  totalLine.style.paddingTop = '6px';
  totalLine.innerHTML = '<span>Total sheets to cut</span><span>' + grandTotal + '</span>';
  box.appendChild(totalLine);

  section.appendChild(box);
  section.appendChild(buildStockCheck(plan));
}

// One block per sheet-type: only shown when the sheet has a multi-yield row
// or a binding remainder. Explains the shared-sheet math + surplus + decision.
function buildSheetYieldDetail(sheetPlan) {
  var wrap = document.createElement('div');
  var anyMulti = sheetPlan.rows.some(function (r) { return r.multiYield; });
  if (!anyMulti && !sheetPlan.decisionKey) {
    wrap.hidden = true;
    return wrap;
  }
  wrap.className = 'my-guidance';

  sheetPlan.rows.forEach(function (r) {
    var l = document.createElement('div');
    var txt = r.partName + ' — need ' + r.totalNeeded + ', ' +
      sheetPlan.physicalSheets + ' × ' + r.yieldPerSheet + '/sheet = ' + r.produced;
    if (r.surplus > 0) txt += ' (' + r.surplus + ' surplus → Leftover Ledger)';
    else if (r.shortOnScrap > 0) txt += ' — ' + r.shortOnScrap + ' cut on scrap';
    else txt += ' (exact)';
    if (r.isBinding) txt += '  ← drives the count';
    l.textContent = txt;
    wrap.appendChild(l);
  });

  if (sheetPlan.decisionKey) {
    var key = sheetPlan.decisionKey;
    var rem = sheetPlan.bindingRemainder;
    var decision = document.createElement('div');
    decision.className = 'my-decision';
    var p = document.createElement('p');
    p.textContent = multiYieldChoices[key]
      ? (multiYieldChoices[key] === 'extra-sheet'
          ? 'Chosen: cut 1 extra full sheet.'
          : 'Chosen: cut the ' + rem + ' short pcs on a scrap sheet (log via Extra Sheet Cut).')
      : rem + ' short of a full sheet on the driving part — decide (optional, can be set later in Cutting Stage):';
    decision.appendChild(p);
    var btns = document.createElement('div');
    btns.className = 'my-decision-btns';
    btns.appendChild(makeChoiceBtn(key, 'extra-sheet', 'Cut 1 extra full sheet'));
    btns.appendChild(makeChoiceBtn(key, 'scrap', 'Cut ' + rem + ' pcs on scrap'));
    if (multiYieldChoices[key]) {
      var clear = document.createElement('button');
      clear.className = 'btn-secondary';
      clear.textContent = 'Clear';
      clear.addEventListener('click', function () { delete multiYieldChoices[key]; renderSheetsRequired(); });
      btns.appendChild(clear);
    }
    decision.appendChild(btns);
    wrap.appendChild(decision);
  }

  return wrap;
}

function makeChoiceBtn(key, choice, label) {
  var btn = document.createElement('button');
  btn.className = multiYieldChoices[key] === choice ? 'btn-primary' : 'btn-secondary';
  btn.textContent = label;
  btn.addEventListener('click', function () {
    multiYieldChoices[key] = choice;
    renderSheetsRequired();
  });
  return btn;
}

function buildStockCheck(plan) {
  var box = document.createElement('div');
  box.className = 'sheets-required-box';

  var title = document.createElement('div');
  title.className = 'section-title';
  title.textContent = 'Raw Sheet Stock';
  box.appendChild(title);

  var need = {};
  plan.forEach(function (s) { need[s.sizeKey] = (need[s.sizeKey] || 0) + s.physicalSheets; });

  var anyShort = false;
  Object.keys(need).forEach(function (sizeKey) {
    var onHand = Number(sheetStockMap[sizeKey]) || 0;
    var short = need[sizeKey] - onHand;
    var line = document.createElement('div');
    line.style.display = 'flex';
    line.style.justifyContent = 'space-between';
    line.style.fontSize = '13px';
    line.style.padding = '4px 0';
    var right = 'need ' + need[sizeKey] + ', ' + onHand + ' in stock';
    if (short > 0) {
      anyShort = true;
      right += ' — <span class="stock-warn">' + short + ' short</span>';
    }
    line.innerHTML = '<span>' + sizeKey.replace(/x/g, ' × ') + '</span><span>' + right + '</span>';
    box.appendChild(line);
  });

  if (anyShort) {
    var warn = document.createElement('div');
    warn.className = 'alert-banner';
    warn.style.marginTop = '8px';
    warn.style.marginBottom = '0';
    warn.textContent = 'Some sizes are short on stock. The PO can still be created — stock will show a deficit until more is received.';
    box.appendChild(warn);
  }

  return box;
}

function createPO() {
  if (!canEdit('orders')) {
    alert('You have view-only access to Production Order Form - ask an admin for edit access to create a PO.');
    return;
  }
  var modelName = el('po-model').value;
  var planName = el('po-plan').value;
  var isBulk = selectedPlanType === 'bulk';
  var qty = isBulk ? bulkMultiplier * selectedPlanBaseQty : (Number(el('po-qty').value) || 0);

  if (!modelName) {
    alert('Choose a model.');
    return;
  }
  if (!planName) {
    alert('Choose a cutting plan.');
    return;
  }
  if (isBulk ? !(bulkMultiplier >= 1) : qty <= 0) {
    alert(isBulk ? 'Choose a multiplier of at least 1x.' : 'Enter a qty greater than 0.');
    return;
  }
  if (selectedModelSheets === undefined) {
    alert('Still loading sheet data for this plan - try again in a moment.');
    return;
  }
  if (selectedModelSheets === null) {
    alert('Could not load sheet data for this plan.');
    return;
  }
  if (selectedModelSheets.length === 0) {
    if (!confirm('This plan has no sheets defined in Cutting Configuration, so Total Sheets will be 0. Create the PO anyway?')) {
      return;
    }
  }

  var createBtn = el('create-po-btn');
  createBtn.disabled = true;

  var payload = {
    modelName: modelName,
    planName: planName,
    dxfRefNo: el('po-dxf').value,
    colourPlan: el('po-colour').value,
    deliveryDeadline: el('po-deadline').value,
    partyName: el('po-party').value,
    multiYieldDecisions: multiYieldChoices,
    sheetQtyOverrides: sheetQtyOverrides
  };
  if (isBulk) {
    payload.bulkMultiplier = bulkMultiplier;
  } else {
    payload.qty = qty;
  }

  apiPost('createOrder', payload).then(function (result) {
    createBtn.disabled = false;
    if (!result.ok) return showFatalError(result.error);
    var msg = result.data.poNumber + ' created.';
    if (result.data.hasPendingMultiYield) {
      msg += '\n\nOne or more multi-yield remainder decisions are still pending — resolve them in Cutting Stage before cutting.';
    }
    alert(msg);
    loadOrders();
    loadSheetStockForForm();
    startNewDraft();
  }).catch(function (err) {
    createBtn.disabled = false;
    showFatalError(err);
  });
}

function renderPoTable() {
  var tbody = el('po-table-body');
  tbody.innerHTML = '';
  var emptyState = el('po-table-empty');

  if (allOrders.length === 0) {
    emptyState.style.display = 'block';
    el('po-table-wrap').style.display = 'none';
    return;
  }
  emptyState.style.display = 'none';
  el('po-table-wrap').style.display = 'block';

  allOrders.slice().reverse().forEach(function (po) {
    var tr = document.createElement('tr');
    var planCell = po.planName + (po.planType === 'bulk' ? ' <span class="muted">(Bulk ×' + po.bulkBaseQty + ', ' + po.bulkMultiplier + '×)</span>' : '');
    tr.innerHTML =
      '<td>' + po.poNumber + '</td>' +
      '<td>' + new Date(po.createdAt).toLocaleString() + '</td>' +
      '<td>' + po.modelName + '</td>' +
      '<td>' + planCell + '</td>' +
      '<td>' + po.qty + '</td>' +
      '<td>' + po.totalSheetsRequired + '</td>' +
      '<td>' + (po.partyName || '—') + '</td>' +
      '<td><span class="status-pill status-' + po.cuttingStatus + '">' + po.cuttingStatus + '</span></td>';
    tbody.appendChild(tr);
  });
}

function setBulkMultiplier(value) {
  bulkMultiplier = Math.max(1, Math.round(Number(value) || 1));
  sheetQtyOverrides = {}; // the calculated baseline every override was relative to just changed
  renderQtyControl();
  renderSheetsRequired();
}

document.addEventListener('DOMContentLoaded', function () {
  el('po-model').addEventListener('change', onModelChange);
  el('po-plan').addEventListener('change', onPlanChange);
  el('po-qty').addEventListener('input', function () {
    sheetQtyOverrides = {}; // ditto - qty changed, so any manual sheet-count overrides no longer apply
    renderSheetsRequired();
  });
  el('po-bulk-multiplier').addEventListener('input', function (e) { setBulkMultiplier(e.target.value); });
  el('po-bulk-minus-btn').addEventListener('click', function () { setBulkMultiplier(bulkMultiplier - 1); });
  el('po-bulk-plus-btn').addEventListener('click', function () { setBulkMultiplier(bulkMultiplier + 1); });
  el('create-po-btn').addEventListener('click', createPO);

  requireAuth().then(function () {
    renderSideNav('orders');
    if (!canEdit('orders')) {
      el('create-po-btn').style.display = 'none';
      var hint = document.createElement('div');
      hint.className = 'section-hint';
      hint.textContent = 'View only — ask an admin for edit access to create a PO.';
      el('create-po-btn').parentNode.appendChild(hint);
    }
    initOrdersForm();
  });
});
