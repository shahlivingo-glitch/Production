var pendingOrders = [];
var currentOrder = null;
var activeVersion = null;
var workingSheets = null;
var modelPartNames = [];
var allModels = [];
var knownExtraParts = [];
var versionHistory = [];
var extras = [];
var expandedVersionId = null;
var planDirty = false;
var extraPromptState = null;
var extraPartFormState = null;

function initCuttingStage() {
  el('back-to-dashboard-btn').addEventListener('click', function () {
    if (!confirmDiscardPlanIfDirty()) return;
    showDashboard();
  });
  el('mark-all-complete-btn').addEventListener('click', markAllComplete);
  el('add-sheet-btn').addEventListener('click', addSheet);
  el('save-version-btn').addEventListener('click', saveNewVersion);
  document.querySelectorAll('.cs-tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () { selectTab(btn.dataset.tab); });
  });
  el('extra-prompt-skip-btn').addEventListener('click', skipExtraPrompt);
  el('extra-prompt-save-btn').addEventListener('click', saveExtraPromptAndProceed);
  el('extra-prompt-add-row-btn').addEventListener('click', function () {
    extraPromptState.rows.push({ partName: '', qty: '' });
    renderExtraPromptRows();
  });
  el('extra-prompt-overlay').addEventListener('click', function (e) {
    if (e.target === el('extra-prompt-overlay')) cancelExtraPrompt();
  });
  window.addEventListener('beforeunload', function (e) {
    if (!planDirty) return;
    e.preventDefault();
    e.returnValue = '';
  });
  showDashboard();
}

function showExtraPartsModal(sheetIndex, onDone) {
  var sourceSheet = (activeVersion && activeVersion.sheets[sheetIndex]) || workingSheets[sheetIndex];
  extraPromptState = { sheetIndex: sheetIndex, rows: [{ partName: '', qty: '' }], onDone: onDone };
  el('extra-prompt-title').textContent = 'Extra parts from ' + sheetLabel(sourceSheet, sheetIndex) + '\'s full cutting run?';
  renderExtraPromptRows();
  el('extra-prompt-overlay').style.display = 'flex';
}

function renderExtraPromptRows() {
  var wrap = el('extra-prompt-rows');
  wrap.innerHTML = '';
  extraPromptState.rows.forEach(function (row, i) {
    var line = document.createElement('div');
    line.className = 'cs-output-row';

    var select = document.createElement('select');
    var ph = document.createElement('option');
    ph.value = '';
    ph.textContent = '-- part --';
    select.appendChild(ph);
    modelPartNames.forEach(function (partName) {
      var opt = document.createElement('option');
      opt.value = partName;
      opt.textContent = partName;
      select.appendChild(opt);
    });
    var extraOpt = document.createElement('option');
    extraOpt.value = EXTRA_PART_SENTINEL;
    extraOpt.textContent = '+ Extra Part';
    select.appendChild(extraOpt);

    select.value = row.isExtra ? EXTRA_PART_SENTINEL : row.partName;
    select.addEventListener('change', function (e) {
      applyExtraSelectValue(row, e.target.value);
      renderExtraPromptRows();
    });
    line.appendChild(select);

    if (row.isExtra) {
      var nameInput = buildExtraNameInput(row, function (size) { sizeInput.value = size; });
      line.appendChild(nameInput);

      var sizeInput = document.createElement('input');
      sizeInput.type = 'text';
      sizeInput.placeholder = 'Size (e.g. 50x100mm)';
      sizeInput.value = row.size || '';
      sizeInput.addEventListener('input', function (e) { row.size = e.target.value; });
      line.appendChild(sizeInput);

      line.appendChild(buildExtraModelField(row, currentOrder.modelName));
    }

    var qtyInput = document.createElement('input');
    qtyInput.type = 'number';
    qtyInput.placeholder = 'Qty';
    qtyInput.value = row.qty;
    qtyInput.addEventListener('input', function (e) { row.qty = e.target.value; });
    line.appendChild(qtyInput);

    var removeBtn = document.createElement('button');
    removeBtn.className = 'icon-btn';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', function () {
      extraPromptState.rows.splice(i, 1);
      if (extraPromptState.rows.length === 0) extraPromptState.rows.push({ partName: '', qty: '' });
      renderExtraPromptRows();
    });
    line.appendChild(removeBtn);

    wrap.appendChild(line);
  });
}

function closeExtraPromptModal() {
  el('extra-prompt-overlay').style.display = 'none';
  extraPromptState = null;
}

function cancelExtraPrompt() {
  closeExtraPromptModal();
  renderPlanTab();
}

function skipExtraPrompt() {
  var onDone = extraPromptState.onDone;
  closeExtraPromptModal();
  onDone();
}

function saveExtraPromptAndProceed() {
  var sheetIndex = extraPromptState.sheetIndex;
  var onDone = extraPromptState.onDone;
  var rowsToSave = extraPromptState.rows.filter(function (r) { return r.partName && Number(r.qty) > 0; });

  if (rowsToSave.length === 0) {
    closeExtraPromptModal();
    onDone();
    return;
  }

  var sourceSheet = (activeVersion && activeVersion.sheets[sheetIndex]) || workingSheets[sheetIndex];
  var label = sheetLabel(sourceSheet, sheetIndex);

  Promise.all(rowsToSave.map(function (r) {
    var details = {
      sourceSheetIndex: sheetIndex,
      sourceSheetLabel: label,
      partName: r.partName,
      qty: Number(r.qty)
    };
    if (r.isExtra) {
      details.isExtra = true;
      details.size = r.size || '';
      details.isUniversal = !!r.isUniversal;
      if (!r.isUniversal) details.modelName = r.modelName || currentOrder.modelName;
    }
    return apiPost('addCuttingExtra', {
      poNumber: currentOrder.poNumber,
      type: 'extra-part',
      details: details
    });
  })).then(function (results) {
    var failed = results.filter(function (r) { return !r.ok; })[0];
    closeExtraPromptModal();
    if (failed) showFatalError(failed.error);
    loadExtras();
    onDone();
  }).catch(function (err) {
    closeExtraPromptModal();
    showFatalError(err);
    onDone();
  });
}

function confirmDiscardPlanIfDirty() {
  if (!planDirty) return true;
  return confirm('You have unsaved cutting plan changes for this PO. Discard them?');
}

function markDirty() {
  planDirty = true;
  setPlanSaveStatus('Unsaved changes', 'dirty');
}

function setPlanSaveStatus(text, cls) {
  var span = el('plan-save-status');
  span.textContent = text;
  span.className = 'save-status' + (cls ? ' ' + cls : '');
}

function showDashboard() {
  el('detail-view').style.display = 'none';
  el('dashboard-view').style.display = 'block';
  loadPendingOrders();
}

function loadPendingOrders() {
  apiGet('pendingOrders', {}).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    pendingOrders = result.data;
    renderDashboard();
  }).catch(showFatalError);
}

function renderDashboard() {
  el('pending-count-heading').textContent = 'Pending POs (' + pendingOrders.length + ')';
  var list = el('pending-po-list');
  list.innerHTML = '';

  if (pendingOrders.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No pending POs — all caught up.';
    list.appendChild(empty);
    return;
  }

  pendingOrders.slice().reverse().forEach(function (po) {
    var card = document.createElement('div');
    card.className = 'cs-po-card';
    card.addEventListener('click', function () { openOrder(po.poNumber); });

    var main = document.createElement('div');
    main.className = 'cs-po-card-main';
    main.innerHTML =
      '<div class="cs-po-number">' + po.poNumber + ' — ' + po.modelName + '</div>' +
      '<div class="muted">Qty ' + po.qty + ' · ' + new Date(po.createdAt).toLocaleDateString() + (po.partyName ? ' · ' + po.partyName : '') + '</div>';

    var sheets = document.createElement('div');
    sheets.className = 'cs-po-card-sheets';
    sheets.innerHTML = '<strong>' + po.totalSheetsRequired + '</strong>sheets required';

    card.appendChild(main);
    card.appendChild(sheets);
    list.appendChild(card);
  });
}

function openOrder(poNumber) {
  Promise.all([
    apiGet('order', { poNumber: poNumber }),
    apiPost('activePlanVersionForOrder', { poNumber: poNumber }),
    apiGet('cuttingExtras', { poNumber: poNumber }),
    apiGet('cuttingConfigModels', {}),
    apiGet('knownExtraParts', {})
  ]).then(function (results) {
    if (!results[0].ok) return showFatalError(results[0].error);
    if (!results[1].ok) return showFatalError(results[1].error);
    if (!results[2].ok) return showFatalError(results[2].error);
    if (!results[3].ok) return showFatalError(results[3].error);
    if (!results[4].ok) return showFatalError(results[4].error);

    currentOrder = results[0].data;
    activeVersion = results[1].data;
    extras = results[2].data;
    allModels = results[3].data;
    knownExtraParts = results[4].data;
    refreshKnownExtraPartsDatalist();
    workingSheets = cloneSheets(activeVersion.sheets);
    planDirty = false;

    return apiGet('modelParts', { modelName: currentOrder.modelName }).then(function (partsResult) {
      if (!partsResult.ok) return showFatalError(partsResult.error);
      modelPartNames = Object.keys(partsResult.data.partsPerUnit || {});
      return loadVersionHistory();
    });
  }).then(function () {
    if (!currentOrder) return;
    el('dashboard-view').style.display = 'none';
    el('detail-view').style.display = 'block';
    el('detail-po-title').textContent = currentOrder.poNumber;
    renderStatusPill();
    renderPoSummary();
    selectTab('plan');
    renderPlanTab();
    renderExtrasTab();
  }).catch(showFatalError);
}

function renderStatusPill() {
  var pill = el('detail-status-pill');
  pill.innerHTML = '<span class="status-pill status-' + currentOrder.cuttingStatus + '">' + currentOrder.cuttingStatus + '</span>';
}

function cloneSheets(sheets) {
  return (sheets || []).map(function (s) {
    return {
      width: s.width !== undefined ? s.width : '',
      height: s.height !== undefined ? s.height : '',
      thickness: s.thickness !== undefined ? s.thickness : '',
      outputs: (s.outputs || []).map(function (o) {
        var out = { partName: o.partName || '', qty: o.qty !== undefined ? o.qty : '' };
        if (o.isExtra) {
          out.isExtra = true;
          out.size = o.size || '';
        }
        return out;
      })
    };
  });
}

function loadVersionHistory() {
  return apiGet('planVersionsForModel', { modelName: currentOrder.modelName }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    versionHistory = result.data;
    renderHistoryTab();
  });
}

function renderPoSummary() {
  var box = el('po-summary');
  box.innerHTML = '';
  var fields = [
    ['Model', currentOrder.modelName],
    ['Qty', currentOrder.qty],
    ['Date', new Date(currentOrder.createdAt).toLocaleString()],
    ['Party', currentOrder.partyName || '—'],
    ['DXF Ref', currentOrder.dxfRefNo || '—'],
    ['Delivery Deadline', currentOrder.deliveryDeadline || '—']
  ];
  fields.forEach(function (f) {
    var block = document.createElement('div');
    block.className = 'field-block';
    block.innerHTML = '<label>' + f[0] + '</label><div>' + f[1] + '</div>';
    box.appendChild(block);
  });
}

function markAllComplete() {
  if (!confirm('Mark every sheet in ' + currentOrder.poNumber + ' as complete?')) return;
  apiPost('markAllSheetsComplete', { poNumber: currentOrder.poNumber }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    currentOrder = result.data;
    renderStatusPill();
    renderPlanTab();
  }).catch(showFatalError);
}

function toggleSheetComplete(sheetIndex, completed) {
  apiPost('setSheetComplete', {
    poNumber: currentOrder.poNumber,
    sheetIndex: sheetIndex,
    completed: completed
  }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    currentOrder = result.data;
    renderStatusPill();
    renderPlanTab();
  }).catch(showFatalError);
}

function selectTab(tab) {
  document.querySelectorAll('.cs-tab-btn').forEach(function (btn) {
    btn.classList.toggle('selected', btn.dataset.tab === tab);
  });
  ['plan', 'history', 'extras'].forEach(function (t) {
    el('tab-' + t).style.display = t === tab ? 'block' : 'none';
  });
}

function sheetLabel(sheet, index) {
  var dims = [sheet.width, sheet.height, sheet.thickness].filter(function (v) { return v !== undefined && v !== ''; }).join(' × ');
  return 'Sheet ' + (index + 1) + (dims ? ' — ' + dims + ' mm' : '');
}

function renderPlanTab() {
  el('plan-version-label').textContent = activeVersion.versionId
    ? 'Version ' + activeVersion.versionNumber + ' (from ' + activeVersion.sourcePlanName + ')'
    : 'Default plan (from ' + activeVersion.sourcePlanName + ') — not yet saved as a version for this PO';
  el('plan-version-note').value = '';
  setPlanSaveStatus('', '');

  var body = el('plan-sheets-body');
  body.innerHTML = '';

  if (workingSheets.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No sheets in this plan yet.';
    body.appendChild(empty);
  }

  workingSheets.forEach(function (sheet, sheetIndex) {
    body.appendChild(buildPlanSheetCard(sheet, sheetIndex));
  });
}

function isSheetComplete(sheetIndex) {
  return !!(currentOrder.sheetCompletion && currentOrder.sheetCompletion[sheetIndex]);
}

function buildPlanSheetCard(sheet, sheetIndex) {
  var done = isSheetComplete(sheetIndex);

  var card = document.createElement('div');
  card.className = 'cs-sheet-card' + (done ? ' done' : '');

  var header = document.createElement('div');
  header.className = 'sheet-header';

  var titleWrap = document.createElement('label');
  titleWrap.className = 'cs-sheet-done-label';
  var doneCheckbox = document.createElement('input');
  doneCheckbox.type = 'checkbox';
  doneCheckbox.checked = done;
  doneCheckbox.addEventListener('change', function (e) {
    if (e.target.checked) {
      showExtraPartsModal(sheetIndex, function () { toggleSheetComplete(sheetIndex, true); });
    } else {
      toggleSheetComplete(sheetIndex, false);
    }
  });
  var title = document.createElement('span');
  title.className = 'sheet-title';
  title.textContent = 'Sheet ' + (sheetIndex + 1) + (done ? ' — Cut' : '');
  titleWrap.appendChild(doneCheckbox);
  titleWrap.appendChild(title);

  var removeBtn = document.createElement('button');
  removeBtn.className = 'icon-btn';
  removeBtn.textContent = '×';
  removeBtn.title = 'Remove sheet';
  removeBtn.addEventListener('click', function () { removeSheet(sheetIndex); });
  header.appendChild(titleWrap);
  header.appendChild(removeBtn);
  card.appendChild(header);

  var dims = document.createElement('div');
  dims.className = 'sheet-dims';
  dims.appendChild(buildPlanDimField('W', sheet.width, function (v) { workingSheets[sheetIndex].width = v; }));
  dims.appendChild(buildPlanDimField('H', sheet.height, function (v) { workingSheets[sheetIndex].height = v; }));
  dims.appendChild(buildPlanDimField('T', sheet.thickness, function (v) { workingSheets[sheetIndex].thickness = v; }));
  card.appendChild(dims);

  var qty = currentOrder.qty;
  var totalLine = document.createElement('div');
  totalLine.className = 'cs-sheet-total-line';
  totalLine.textContent = 'Sheets needed: 1 per unit × ' + qty + ' = ' + qty + ' total';
  card.appendChild(totalLine);

  sheet.outputs.forEach(function (output, outputIndex) {
    card.appendChild(buildPlanOutputRow(sheetIndex, output, outputIndex));
  });

  var addOutputBtn = document.createElement('button');
  addOutputBtn.className = 'btn-secondary';
  addOutputBtn.textContent = '+ Add Part Output';
  addOutputBtn.addEventListener('click', function () { addOutputRow(sheetIndex); });
  card.appendChild(addOutputBtn);

  return card;
}

function buildPlanDimField(labelText, value, onChange) {
  var wrap = document.createElement('span');
  var label = document.createElement('span');
  label.className = 'sheet-dims-label';
  label.textContent = labelText;
  var input = document.createElement('input');
  input.type = 'number';
  input.value = value;
  input.addEventListener('input', function (e) { onChange(e.target.value); });
  input.addEventListener('change', function () { markDirty(); });
  wrap.appendChild(label);
  wrap.appendChild(input);
  return wrap;
}

var EXTRA_PART_SENTINEL = '__extra__';
var UNIVERSAL_SENTINEL = '__universal__';
var KNOWN_EXTRA_PARTS_DATALIST_ID = 'known-extra-parts-datalist';

function applyExtraSelectValue(row, value) {
  if (value === EXTRA_PART_SENTINEL) {
    row.isExtra = true;
    row.partName = '';
    row.size = '';
    return true;
  }
  row.isExtra = false;
  row.partName = value;
  delete row.size;
  return false;
}

function refreshKnownExtraPartsDatalist() {
  var datalist = el(KNOWN_EXTRA_PARTS_DATALIST_ID);
  if (!datalist) return;
  datalist.innerHTML = '';
  knownExtraParts.forEach(function (k) {
    var opt = document.createElement('option');
    opt.value = k.partName;
    datalist.appendChild(opt);
  });
}

function findKnownExtraPartByName(name) {
  var lower = String(name || '').trim().toLowerCase();
  if (!lower) return null;
  for (var i = 0; i < knownExtraParts.length; i++) {
    if (knownExtraParts[i].partName.toLowerCase() === lower) return knownExtraParts[i];
  }
  return null;
}

function buildExtraNameInput(row, onSizeAutofill) {
  var nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Extra part name';
  nameInput.setAttribute('list', KNOWN_EXTRA_PARTS_DATALIST_ID);
  nameInput.value = row.partName || '';
  nameInput.addEventListener('input', function (e) {
    row.partName = e.target.value;
    var match = findKnownExtraPartByName(e.target.value);
    if (match && !row.size) {
      row.size = match.size;
      onSizeAutofill(match.size);
    }
  });
  return nameInput;
}

function buildExtraModelField(row, defaultModel) {
  if (row.modelName === undefined) {
    row.modelName = defaultModel;
    row.isUniversal = false;
  }
  var select = document.createElement('select');
  var label = document.createElement('option');
  label.value = '';
  label.disabled = true;
  label.textContent = '-- for which model? --';
  select.appendChild(label);
  allModels.forEach(function (name) {
    var opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });
  var universalOpt = document.createElement('option');
  universalOpt.value = UNIVERSAL_SENTINEL;
  universalOpt.textContent = 'Universal (any model)';
  select.appendChild(universalOpt);

  select.value = row.isUniversal ? UNIVERSAL_SENTINEL : row.modelName;
  select.addEventListener('change', function (e) {
    if (e.target.value === UNIVERSAL_SENTINEL) {
      row.isUniversal = true;
    } else {
      row.isUniversal = false;
      row.modelName = e.target.value;
    }
  });
  return select;
}

function buildPlanOutputRow(sheetIndex, output, outputIndex) {
  var row = document.createElement('div');
  row.className = 'cs-output-row';

  var select = document.createElement('select');
  var placeholderOpt = document.createElement('option');
  placeholderOpt.value = '';
  placeholderOpt.textContent = '-- choose part --';
  select.appendChild(placeholderOpt);
  modelPartNames.forEach(function (partName) {
    var opt = document.createElement('option');
    opt.value = partName;
    opt.textContent = partName;
    select.appendChild(opt);
  });
  var extraOpt = document.createElement('option');
  extraOpt.value = EXTRA_PART_SENTINEL;
  extraOpt.textContent = '+ Extra Part';
  select.appendChild(extraOpt);

  select.value = output.isExtra ? EXTRA_PART_SENTINEL : (output.partName || '');
  select.addEventListener('change', function (e) {
    var out = workingSheets[sheetIndex].outputs[outputIndex];
    applyExtraSelectValue(out, e.target.value);
    markDirty();
    renderPlanTab();
  });
  row.appendChild(select);

  if (output.isExtra) {
    var out2 = workingSheets[sheetIndex].outputs[outputIndex];
    var nameInput = buildExtraNameInput(out2, function (size) { sizeInput.value = size; markDirty(); });
    nameInput.addEventListener('change', function () { markDirty(); });
    row.appendChild(nameInput);

    var sizeInput = document.createElement('input');
    sizeInput.type = 'text';
    sizeInput.placeholder = 'Size (e.g. 50x100mm)';
    sizeInput.value = output.size || '';
    sizeInput.addEventListener('input', function (e) {
      workingSheets[sheetIndex].outputs[outputIndex].size = e.target.value;
    });
    sizeInput.addEventListener('change', function () { markDirty(); });
    row.appendChild(sizeInput);
  }

  var qtyInput = document.createElement('input');
  qtyInput.type = 'number';
  qtyInput.placeholder = 'Qty/sheet';
  qtyInput.value = output.qty;
  qtyInput.addEventListener('input', function (e) {
    workingSheets[sheetIndex].outputs[outputIndex].qty = e.target.value;
    updateOutputTotal(totalSpan, e.target.value);
  });
  qtyInput.addEventListener('change', function () { markDirty(); });

  var totalSpan = document.createElement('span');
  totalSpan.className = 'cs-output-total';
  updateOutputTotal(totalSpan, output.qty);

  var removeBtn = document.createElement('button');
  removeBtn.className = 'icon-btn';
  removeBtn.textContent = '×';
  removeBtn.title = 'Remove output row';
  removeBtn.addEventListener('click', function () { removeOutputRow(sheetIndex, outputIndex); });

  row.appendChild(qtyInput);
  row.appendChild(totalSpan);
  row.appendChild(removeBtn);
  return row;
}

function updateOutputTotal(span, qtyPerSheet) {
  var perSheet = Number(qtyPerSheet) || 0;
  var total = perSheet * currentOrder.qty;
  span.textContent = '× ' + currentOrder.qty + ' = ' + total;
}

function addSheet() {
  workingSheets.push({ width: '', height: '', thickness: '', outputs: [] });
  markDirty();
  renderPlanTab();
}

function removeSheet(sheetIndex) {
  workingSheets.splice(sheetIndex, 1);
  markDirty();
  renderPlanTab();
}

function addOutputRow(sheetIndex) {
  workingSheets[sheetIndex].outputs.push({ partName: '', qty: '' });
  markDirty();
  renderPlanTab();
}

function removeOutputRow(sheetIndex, outputIndex) {
  workingSheets[sheetIndex].outputs.splice(outputIndex, 1);
  markDirty();
  renderPlanTab();
}

function saveNewVersion() {
  var sheets = workingSheets.map(function (s) {
    return {
      width: Number(s.width) || 0,
      height: Number(s.height) || 0,
      thickness: Number(s.thickness) || 0,
      outputs: s.outputs.map(function (o) {
        var out = { partName: o.partName, qty: Number(o.qty) || 0 };
        if (o.isExtra) {
          out.isExtra = true;
          out.size = o.size || '';
        }
        return out;
      })
    };
  });

  setPlanSaveStatus('Saving…', 'saving');
  apiPost('saveNewPlanVersion', {
    poNumber: currentOrder.poNumber,
    sheets: sheets,
    note: el('plan-version-note').value
  }).then(function (result) {
    if (!result.ok) {
      setPlanSaveStatus('Save failed: ' + result.error, 'error');
      return;
    }
    activeVersion = result.data;
    workingSheets = cloneSheets(activeVersion.sheets);
    planDirty = false;
    return apiGet('order', { poNumber: currentOrder.poNumber }).then(function (orderResult) {
      if (orderResult.ok) currentOrder = orderResult.data;
      renderStatusPill();
      renderPlanTab();
      extraPartFormState = null;
      renderExtraPartForm();
      setPlanSaveStatus('Saved as version ' + activeVersion.versionNumber, '');
      loadVersionHistory();
    });
  }).catch(function () {
    setPlanSaveStatus('Save failed', 'error');
  });
}

function renderHistoryTab() {
  var list = el('version-history-list');
  list.innerHTML = '';

  if (versionHistory.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No plan versions yet.';
    list.appendChild(empty);
    return;
  }

  versionHistory.slice().reverse().forEach(function (v) {
    var isActive = v.versionId === currentOrder.planVersionId;
    var row = document.createElement('div');
    row.className = 'cs-version-row' + (isActive ? ' active' : '');

    var header = document.createElement('div');
    header.className = 'cs-version-row-header';

    var label = document.createElement('div');
    label.innerHTML =
      '<strong>Version ' + v.versionNumber + '</strong> — from ' + v.sourcePlanName +
      ' · ' + v.sheetCount + ' sheets · ' + new Date(v.createdAt).toLocaleString() +
      (v.note ? '<div class="muted">' + v.note + '</div>' : '');

    var actions = document.createElement('div');
    actions.className = 'cs-version-actions';

    var viewBtn = document.createElement('button');
    viewBtn.className = 'btn-secondary';
    viewBtn.textContent = expandedVersionId === v.versionId ? 'Hide' : 'View';
    viewBtn.addEventListener('click', function () {
      expandedVersionId = expandedVersionId === v.versionId ? null : v.versionId;
      renderHistoryTab();
    });
    actions.appendChild(viewBtn);

    if (isActive) {
      var activeTag = document.createElement('span');
      activeTag.className = 'status-pill status-complete';
      activeTag.textContent = 'Active for this PO';
      actions.appendChild(activeTag);
    } else {
      var useBtn = document.createElement('button');
      useBtn.className = 'btn-primary';
      useBtn.textContent = 'Use for this PO';
      useBtn.addEventListener('click', function () { useVersionForOrder(v.versionId); });
      actions.appendChild(useBtn);
    }

    header.appendChild(label);
    header.appendChild(actions);
    row.appendChild(header);

    if (expandedVersionId === v.versionId) {
      row.appendChild(buildVersionPreview(v.versionId));
    }

    list.appendChild(row);
  });
}

function buildVersionPreview(versionId) {
  var box = document.createElement('div');
  box.className = 'cs-version-preview';
  box.textContent = 'Loading…';

  apiGet('planVersion', { versionId: versionId }).then(function (result) {
    if (!result.ok) {
      box.textContent = 'Could not load: ' + result.error;
      return;
    }
    box.innerHTML = '';
    result.data.sheets.forEach(function (sheet, index) {
      var line = document.createElement('div');
      line.style.marginBottom = '6px';
      var outputsText = sheet.outputs.map(function (o) {
        return o.partName + (o.isExtra ? ' [extra' + (o.size ? ', ' + o.size : '') + ']' : '') + ' x' + o.qty;
      }).join(', ');
      line.innerHTML = '<strong>' + sheetLabel(sheet, index) + '</strong> — ' + (outputsText || 'no outputs');
      box.appendChild(line);
    });
  }).catch(function (err) {
    box.textContent = 'Could not load: ' + (err.message || err);
  });

  return box;
}

function useVersionForOrder(versionId) {
  if (!confirmDiscardPlanIfDirty()) return;
  apiPost('setActivePlanVersionForOrder', { poNumber: currentOrder.poNumber, versionId: versionId }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    activeVersion = result.data;
    workingSheets = cloneSheets(activeVersion.sheets);
    planDirty = false;
    return apiGet('order', { poNumber: currentOrder.poNumber }).then(function (orderResult) {
      if (orderResult.ok) currentOrder = orderResult.data;
      renderStatusPill();
      renderPlanTab();
      extraPartFormState = null;
      renderExtraPartForm();
      renderHistoryTab();
      selectTab('plan');
    });
  }).catch(showFatalError);
}

function renderExtrasTab() {
  renderExtraSheetForm();
  extraPartFormState = null;
  renderExtraPartForm();
  renderExtrasList();
}

function renderExtraSheetForm() {
  var wrap = el('extra-sheet-form');
  wrap.innerHTML = '';

  var state = { width: '', height: '', thickness: '', outputs: [{ partName: '', qty: '' }] };

  var dims = document.createElement('div');
  dims.className = 'sheet-dims';
  ['Width', 'Height', 'Thickness'].forEach(function (label, i) {
    var field = document.createElement('span');
    var lbl = document.createElement('span');
    lbl.className = 'sheet-dims-label';
    lbl.textContent = label[0];
    var input = document.createElement('input');
    input.type = 'number';
    input.placeholder = label;
    input.addEventListener('input', function (e) {
      if (i === 0) state.width = e.target.value;
      if (i === 1) state.height = e.target.value;
      if (i === 2) state.thickness = e.target.value;
    });
    field.appendChild(lbl);
    field.appendChild(input);
    dims.appendChild(field);
  });
  wrap.appendChild(dims);

  var rowsWrap = document.createElement('div');
  wrap.appendChild(rowsWrap);

  function renderRows() {
    rowsWrap.innerHTML = '';
    state.outputs.forEach(function (output, i) {
      var row = document.createElement('div');
      row.className = 'cs-output-row';

      var select = document.createElement('select');
      var ph = document.createElement('option');
      ph.value = '';
      ph.textContent = '-- part --';
      select.appendChild(ph);
      modelPartNames.forEach(function (partName) {
        var opt = document.createElement('option');
        opt.value = partName;
        opt.textContent = partName;
        select.appendChild(opt);
      });
      select.value = output.partName;
      select.addEventListener('change', function (e) { output.partName = e.target.value; });

      var qtyInput = document.createElement('input');
      qtyInput.type = 'number';
      qtyInput.placeholder = 'Qty';
      qtyInput.value = output.qty;
      qtyInput.addEventListener('input', function (e) { output.qty = e.target.value; });

      var removeBtn = document.createElement('button');
      removeBtn.className = 'icon-btn';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', function () {
        state.outputs.splice(i, 1);
        renderRows();
      });

      row.appendChild(select);
      row.appendChild(qtyInput);
      row.appendChild(removeBtn);
      rowsWrap.appendChild(row);
    });
  }
  renderRows();

  var addRowBtn = document.createElement('button');
  addRowBtn.className = 'btn-secondary';
  addRowBtn.textContent = '+ Add Part';
  addRowBtn.addEventListener('click', function () {
    state.outputs.push({ partName: '', qty: '' });
    renderRows();
  });
  wrap.appendChild(addRowBtn);

  var submitBtn = document.createElement('button');
  submitBtn.className = 'btn-primary btn-block';
  submitBtn.style.marginTop = '10px';
  submitBtn.textContent = 'Log Extra Sheet Cut';
  submitBtn.addEventListener('click', function () {
    var partsProduced = {};
    state.outputs.forEach(function (o) {
      if (o.partName && Number(o.qty) > 0) partsProduced[o.partName] = Number(o.qty);
    });
    if (Object.keys(partsProduced).length === 0) {
      alert('Add at least one part with a qty.');
      return;
    }
    apiPost('addCuttingExtra', {
      poNumber: currentOrder.poNumber,
      type: 'extra-sheet',
      details: {
        width: Number(state.width) || 0,
        height: Number(state.height) || 0,
        thickness: Number(state.thickness) || 0,
        partsProduced: partsProduced
      }
    }).then(function (result) {
      if (!result.ok) return showFatalError(result.error);
      renderExtraSheetForm();
      loadExtras();
    }).catch(showFatalError);
  });
  wrap.appendChild(submitBtn);
}

function renderExtraPartForm() {
  var wrap = el('extra-part-form');
  wrap.innerHTML = '';

  if (!extraPartFormState) {
    extraPartFormState = { sheetIndex: '', partName: '', qty: '', isExtra: false, size: '' };
  }
  var state = extraPartFormState;

  var sheetField = document.createElement('div');
  sheetField.className = 'field-row';
  var sheetLabelEl = document.createElement('label');
  sheetLabelEl.textContent = 'From Sheet';
  var sheetSelect = document.createElement('select');
  var ph = document.createElement('option');
  ph.value = '';
  ph.textContent = '-- choose sheet --';
  sheetSelect.appendChild(ph);
  activeVersion.sheets.forEach(function (sheet, i) {
    var opt = document.createElement('option');
    opt.value = i;
    opt.textContent = sheetLabel(sheet, i);
    sheetSelect.appendChild(opt);
  });
  sheetSelect.value = state.sheetIndex;
  sheetSelect.addEventListener('change', function (e) { state.sheetIndex = e.target.value; });
  sheetField.appendChild(sheetLabelEl);
  sheetField.appendChild(sheetSelect);
  wrap.appendChild(sheetField);

  var partField = document.createElement('div');
  partField.className = 'field-row';
  var partLabelEl = document.createElement('label');
  partLabelEl.textContent = 'Part';
  var partSelect = document.createElement('select');
  var ph2 = document.createElement('option');
  ph2.value = '';
  ph2.textContent = '-- choose part --';
  partSelect.appendChild(ph2);
  modelPartNames.forEach(function (partName) {
    var opt = document.createElement('option');
    opt.value = partName;
    opt.textContent = partName;
    partSelect.appendChild(opt);
  });
  var extraOpt = document.createElement('option');
  extraOpt.value = EXTRA_PART_SENTINEL;
  extraOpt.textContent = '+ Extra Part';
  partSelect.appendChild(extraOpt);
  partSelect.value = state.isExtra ? EXTRA_PART_SENTINEL : state.partName;
  partSelect.addEventListener('change', function (e) {
    applyExtraSelectValue(state, e.target.value);
    renderExtraPartForm();
  });
  partField.appendChild(partLabelEl);
  partField.appendChild(partSelect);
  wrap.appendChild(partField);

  if (state.isExtra) {
    var nameField = document.createElement('div');
    nameField.className = 'field-row';
    var nameLabelEl = document.createElement('label');
    nameLabelEl.textContent = 'Extra Part Name';
    var nameInput = buildExtraNameInput(state, function (size) { sizeInput.value = size; });
    nameField.appendChild(nameLabelEl);
    nameField.appendChild(nameInput);
    wrap.appendChild(nameField);

    var sizeField = document.createElement('div');
    sizeField.className = 'field-row';
    var sizeLabelEl = document.createElement('label');
    sizeLabelEl.textContent = 'Size';
    var sizeInput = document.createElement('input');
    sizeInput.type = 'text';
    sizeInput.placeholder = 'e.g. 50x100mm';
    sizeInput.value = state.size;
    sizeInput.addEventListener('input', function (e) { state.size = e.target.value; });
    sizeField.appendChild(sizeLabelEl);
    sizeField.appendChild(sizeInput);
    wrap.appendChild(sizeField);

    var modelField = document.createElement('div');
    modelField.className = 'field-row';
    var modelLabelEl = document.createElement('label');
    modelLabelEl.textContent = 'For Which Model?';
    modelField.appendChild(modelLabelEl);
    modelField.appendChild(buildExtraModelField(state, currentOrder.modelName));
    wrap.appendChild(modelField);
  }

  var qtyField = document.createElement('div');
  qtyField.className = 'field-row';
  var qtyLabelEl = document.createElement('label');
  qtyLabelEl.textContent = 'Extra Qty';
  var qtyInput = document.createElement('input');
  qtyInput.type = 'number';
  qtyInput.value = state.qty;
  qtyInput.addEventListener('input', function (e) { state.qty = e.target.value; });
  qtyField.appendChild(qtyLabelEl);
  qtyField.appendChild(qtyInput);
  wrap.appendChild(qtyField);

  var submitBtn = document.createElement('button');
  submitBtn.className = 'btn-primary btn-block';
  submitBtn.textContent = 'Log Extra Part';
  submitBtn.addEventListener('click', function () {
    if (state.sheetIndex === '') {
      alert('Choose which sheet this came from.');
      return;
    }
    if (!state.partName) {
      alert(state.isExtra ? 'Enter the extra part\'s name.' : 'Choose a part.');
      return;
    }
    if (!(Number(state.qty) > 0)) {
      alert('Enter a qty greater than 0.');
      return;
    }
    var idx = Number(state.sheetIndex);
    var details = {
      sourceSheetIndex: idx,
      sourceSheetLabel: sheetLabel(activeVersion.sheets[idx], idx),
      partName: state.partName,
      qty: Number(state.qty)
    };
    if (state.isExtra) {
      details.isExtra = true;
      details.size = state.size || '';
      details.isUniversal = !!state.isUniversal;
      if (!state.isUniversal) details.modelName = state.modelName || currentOrder.modelName;
    }
    apiPost('addCuttingExtra', {
      poNumber: currentOrder.poNumber,
      type: 'extra-part',
      details: details
    }).then(function (result) {
      if (!result.ok) return showFatalError(result.error);
      extraPartFormState = null;
      renderExtraPartForm();
      loadExtras();
    }).catch(showFatalError);
  });
  wrap.appendChild(submitBtn);
}

function loadExtras() {
  apiGet('cuttingExtras', { poNumber: currentOrder.poNumber }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    extras = result.data;
    renderExtrasList();
  }).catch(showFatalError);

  apiGet('knownExtraParts', {}).then(function (result) {
    if (result.ok) {
      knownExtraParts = result.data;
      refreshKnownExtraPartsDatalist();
    }
  }).catch(function () {});
}

function renderExtrasList() {
  var list = el('extras-list');
  list.innerHTML = '';

  if (extras.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No extras logged for this PO yet.';
    list.appendChild(empty);
    return;
  }

  extras.slice().reverse().forEach(function (extra) {
    var row = document.createElement('div');
    row.className = 'cs-extra-row';
    var typeLabel = extra.type === 'extra-sheet' ? 'Extra Sheet Cut' : 'Extra Part';
    var detailText;
    if (extra.type === 'extra-sheet') {
      var dims = [extra.details.width, extra.details.height, extra.details.thickness].filter(Boolean).join(' × ');
      var parts = Object.keys(extra.details.partsProduced || {}).map(function (p) {
        return p + ' x' + extra.details.partsProduced[p];
      }).join(', ');
      detailText = (dims ? dims + ' mm — ' : '') + parts;
    } else {
      var modelTag = '';
      if (extra.details.isExtra) {
        modelTag = extra.details.isUniversal ? ', Universal' : (extra.details.modelName ? ', for ' + extra.details.modelName : '');
      }
      detailText = extra.details.partName +
        (extra.details.isExtra ? ' [extra' + (extra.details.size ? ', ' + extra.details.size : '') + modelTag + ']' : '') +
        ' x' + extra.details.qty + ' from ' + (extra.details.sourceSheetLabel || ('Sheet ' + (extra.details.sourceSheetIndex + 1)));
    }
    row.innerHTML =
      '<span class="cs-extra-time">' + new Date(extra.timestamp).toLocaleString() + '</span>' +
      '<div class="cs-extra-type">' + typeLabel + '</div>' +
      '<div>' + detailText + '</div>';
    list.appendChild(row);
  });
}

document.addEventListener('DOMContentLoaded', initCuttingStage);
