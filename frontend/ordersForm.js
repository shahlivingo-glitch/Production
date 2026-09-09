var models = [];
var plans = [];
var selectedModelSheets = null;
var allOrders = [];

function initOrdersForm() {
  loadModels();
  loadOrders();
  startNewDraft();
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
      renderSheetsRequired();
      return;
    }
    planSelect.value = plans[0];
    loadSheetsForPlan(modelName, plans[0]);
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
  plans.forEach(function (planName) {
    var opt = document.createElement('option');
    opt.value = planName;
    opt.textContent = planName;
    select.appendChild(opt);
  });
}

function onPlanChange() {
  var modelName = el('po-model').value;
  var planName = el('po-plan').value;
  if (!modelName || !planName) return;
  loadSheetsForPlan(modelName, planName);
}

function loadSheetsForPlan(modelName, planName) {
  selectedModelSheets = undefined;
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

  var qty = Number(el('po-qty').value) || 0;
  if (qty <= 0) {
    var hint = document.createElement('div');
    hint.className = 'section-hint';
    hint.textContent = 'Enter a qty to calculate sheets required.';
    section.appendChild(hint);
    return;
  }

  var box = document.createElement('div');
  box.className = 'sheets-required-box';

  var title = document.createElement('div');
  title.className = 'section-title';
  title.textContent = 'Sheets Required';
  box.appendChild(title);

  var table = document.createElement('table');
  table.className = 'sheets-required-table';

  var thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Sheet</th><th>Per Unit</th><th>× Qty</th><th>Total</th></tr>';
  table.appendChild(thead);

  var tbody = document.createElement('tbody');
  var grandTotal = 0;
  selectedModelSheets.forEach(function (sheet, index) {
    var lineTotal = 1 * qty;
    grandTotal += lineTotal;
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + sheetLabel(sheet, index) + '</td><td>1</td><td>' + qty + '</td><td>' + lineTotal + '</td>';
    tbody.appendChild(tr);
  });

  var totalRow = document.createElement('tr');
  totalRow.className = 'total-row';
  totalRow.innerHTML = '<td>Grand Total</td><td></td><td></td><td>' + grandTotal + '</td>';
  tbody.appendChild(totalRow);

  table.appendChild(tbody);
  box.appendChild(table);
  section.appendChild(box);
}

function createPO() {
  var modelName = el('po-model').value;
  var planName = el('po-plan').value;
  var qty = Number(el('po-qty').value) || 0;

  if (!modelName) {
    alert('Choose a model.');
    return;
  }
  if (!planName) {
    alert('Choose a cutting plan.');
    return;
  }
  if (qty <= 0) {
    alert('Enter a qty greater than 0.');
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

  apiPost('createOrder', {
    modelName: modelName,
    planName: planName,
    qty: qty,
    dxfRefNo: el('po-dxf').value,
    colourPlan: el('po-colour').value,
    deliveryDeadline: el('po-deadline').value,
    partyName: el('po-party').value
  }).then(function (result) {
    createBtn.disabled = false;
    if (!result.ok) return showFatalError(result.error);
    alert(result.data.poNumber + ' created — ' + result.data.totalSheetsRequired + ' sheets required.');
    loadOrders();
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
    tr.innerHTML =
      '<td>' + po.poNumber + '</td>' +
      '<td>' + new Date(po.createdAt).toLocaleString() + '</td>' +
      '<td>' + po.modelName + '</td>' +
      '<td>' + po.planName + '</td>' +
      '<td>' + po.qty + '</td>' +
      '<td>' + po.totalSheetsRequired + '</td>' +
      '<td>' + (po.partyName || '—') + '</td>' +
      '<td><span class="status-pill status-' + po.cuttingStatus + '">' + po.cuttingStatus + '</span></td>';
    tbody.appendChild(tr);
  });
}

document.addEventListener('DOMContentLoaded', function () {
  el('po-model').addEventListener('change', onModelChange);
  el('po-plan').addEventListener('change', onPlanChange);
  el('po-qty').addEventListener('input', renderSheetsRequired);
  el('create-po-btn').addEventListener('click', createPO);
  initOrdersForm();
});
