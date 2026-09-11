var models = [];
var plans = [];
var selectedModelSheets = null;
var allOrders = [];
var sheetStockMap = {};
var multiYieldChoices = {};
var selectedPlanType = 'per-unit';
var selectedPlanBaseQty = 0;
var bulkMultiplier = 1;

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
    setSelectedPlanType('per-unit', 0);
    renderSheetsRequired();
    return;
  }

  el('po-plan-row').style.display = 'flex';
  var planSelect = el('po-plan');
  planSelect.innerHTML = '<option value="">Loading…</option>';
  selectedModelSheets = undefined;
  renderSheetsRequired();

  apiGet('cuttingConfigPlans', { modelName: modelName }).then(function (result) {
    if (el('po-model').value !== modelName) return;
    if (!result.ok) {
      selectedModelSheets = null;
      renderSheetsRequired();
      return showFatalError(result.error);
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
    selectedModelSheets = null;
    renderSheetsRequired();
    showFatalError(err);
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
  multiYieldChoices = {};
  renderSheetsRequired();
  apiGet('cuttingConfigPlan', { modelName: modelName, planName: planName }).then(function (result) {
    if (el('po-model').value !== modelName || el('po-plan').value !== planName) return;
    if (!result.ok) {
      selectedModelSheets = null;
      renderSheetsRequired();
      return showFatalError(result.error);
    }
    selectedModelSheets = result.data.sheets || [];
    renderSheetsRequired();
  }).catch(function (err) {
    if (el('po-model').value !== modelName || el('po-plan').value !== planName) return;
    selectedModelSheets = null;
    renderSheetsRequired();
    showFatalError(err);
  });
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

  var plan = computeSheetPlanClient(selectedModelSheets, effectiveN, multiYieldChoices);

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
    line.style.fontSize = '13px';
    line.style.padding = '4px 0';
    line.innerHTML = '<span>' + sheetLabel(selectedModelSheets[index], index) + '</span>' +
      '<span><strong>' + sheetPlan.physicalSheets + '</strong> sheet' + (sheetPlan.physicalSheets === 1 ? '' : 's') + '</span>';
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
    multiYieldDecisions: multiYieldChoices
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
  renderQtyControl();
  renderSheetsRequired();
}

document.addEventListener('DOMContentLoaded', function () {
  el('po-model').addEventListener('change', onModelChange);
  el('po-plan').addEventListener('change', onPlanChange);
  el('po-qty').addEventListener('input', renderSheetsRequired);
  el('po-bulk-multiplier').addEventListener('input', function (e) { setBulkMultiplier(e.target.value); });
  el('po-bulk-minus-btn').addEventListener('click', function () { setBulkMultiplier(bulkMultiplier - 1); });
  el('po-bulk-plus-btn').addEventListener('click', function () { setBulkMultiplier(bulkMultiplier + 1); });
  el('create-po-btn').addEventListener('click', createPO);
  initOrdersForm();
});
