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
var leftoverByPart = {}; // { partName: qty } already sitting in the Leftover Ledger for the current order's model - informational only, see buildPlanOutputRow
var actualCutDrafts = {}; // { sheetIndex: typed value } - unsaved "Actual sheet" edits, staged locally until that sheet's own Save button is clicked (see buildPlanSheetCard/saveSheetQtyOverride). Cleared whenever sheet indices could no longer line up with what's staged: opening an order, saving a new plan version, or adding/removing a sheet.
var modelPartsMap = {}; // raw Models.PartsPerUnit for the current order's model (name -> qty, or {qty,size}) - used to default/edit a part's size on its output row, see buildPlanOutputRow/handlePartSizeChange

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
  el('extra-prompt-cut-continue-btn').addEventListener('click', confirmActualSheetsCut);
  el('extra-prompt-cut-cancel-btn').addEventListener('click', cancelExtraPrompt);
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
    if (!planDirty && !hasUnsavedActualCutDrafts()) return;
    e.preventDefault();
    e.returnValue = '';
  });
  if (!canEdit('cuttingStage')) {
    el('mark-all-complete-btn').style.display = 'none';
    el('save-version-btn').style.display = 'none';
    el('add-sheet-btn').style.display = 'none';
  }
  showDashboard();
}

// Mark-done flow is two steps in this one modal: first "how many sheets did
// you actually cut" (pre-filled with the planned/expected qty, editable),
// then - only once that's confirmed - the existing extra-parts question.
// The actual-cut number is what setSheetComplete uses to drive stock
// booking, the Leftover Ledger, and the "need X, actual Y x qty/sheet" plan
// summary, instead of the planned figure.
function showExtraPartsModal(sheetIndex, onDone) {
  var sourceSheet = (activeVersion && activeVersion.sheets[sheetIndex]) || workingSheets[sheetIndex];
  var plan = computeSheetPlanClient(workingSheets, getCurrentOrderSheetMultiplier(), currentOrder.multiYieldDecisions || {}, currentOrder.sheetQtyOverrides || {});
  var plannedQty = (plan[sheetIndex] && plan[sheetIndex].physicalSheets) || 0;

  extraPromptState = { sheetIndex: sheetIndex, rows: [{ partName: '', qty: '' }], onDone: onDone, actualCut: null };

  el('extra-prompt-title').textContent = 'Mark ' + sheetLabel(sourceSheet, sheetIndex) + ' as Done';
  el('extra-prompt-cut-label').textContent = sheetLabel(sourceSheet, sheetIndex) + ' — Cut';
  el('extra-prompt-actual-cut').value = plannedQty;
  el('extra-prompt-cut-section').style.display = 'block';
  el('extra-prompt-parts-section').style.display = 'none';
  el('extra-prompt-overlay').style.display = 'flex';
}

function confirmActualSheetsCut() {
  var input = el('extra-prompt-actual-cut');
  var val = Number(input.value);
  if (input.value === '' || isNaN(val) || val < 0) {
    alert('Enter a valid number of sheets cut (0 or more).');
    return;
  }
  extraPromptState.actualCut = Math.round(val);

  var sourceSheet = (activeVersion && activeVersion.sheets[extraPromptState.sheetIndex]) || workingSheets[extraPromptState.sheetIndex];
  el('extra-prompt-title').textContent = 'Extra parts from ' + sheetLabel(sourceSheet, extraPromptState.sheetIndex) + '\'s full cutting run?';
  el('extra-prompt-cut-section').style.display = 'none';
  el('extra-prompt-parts-section').style.display = 'block';
  renderExtraPromptRows();
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
  var actualCut = extraPromptState.actualCut;
  closeExtraPromptModal();
  onDone(actualCut);
}

function saveExtraPromptAndProceed() {
  if (!canEdit('cuttingStage')) {
    alert('View only - ask an admin for edit access to log extras.');
    cancelExtraPrompt();
    return;
  }
  var sheetIndex = extraPromptState.sheetIndex;
  var onDone = extraPromptState.onDone;
  var actualCut = extraPromptState.actualCut;
  var rowsToSave = extraPromptState.rows.filter(function (r) { return r.partName && Number(r.qty) > 0; });

  if (rowsToSave.length === 0) {
    closeExtraPromptModal();
    onDone(actualCut);
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
    onDone(actualCut);
  }).catch(function (err) {
    closeExtraPromptModal();
    showFatalError(err);
    onDone(actualCut);
  });
}

function hasUnsavedActualCutDrafts() {
  return Object.keys(actualCutDrafts).length > 0;
}

function confirmDiscardPlanIfDirty() {
  if (!planDirty && !hasUnsavedActualCutDrafts()) return true;
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
  el('pending-loading').style.display = 'flex';
  el('pending-error').style.display = 'none';
  el('pending-po-list').innerHTML = '';

  apiGet('pendingOrders', {}).then(function (result) {
    el('pending-loading').style.display = 'none';
    if (!result.ok) {
      el('pending-error').textContent = 'Could not load Pending POs: ' + result.error;
      el('pending-error').style.display = 'block';
      return;
    }
    pendingOrders = result.data;
    renderDashboard();
  }).catch(function (err) {
    el('pending-loading').style.display = 'none';
    el('pending-error').textContent = 'Could not load Pending POs: ' + (err && err.message ? err.message : err);
    el('pending-error').style.display = 'block';
  });
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
      '<div class="muted">Qty ' + po.qty + ' · ' + new Date(po.createdAt).toLocaleDateString() + (po.partyName ? ' · ' + po.partyName : '') + '</div>' +
      (po.hasPendingMultiYield ? '<div class="my-pending-chip">⚠ multi-yield decision pending</div>' : '');

    var sheets = document.createElement('div');
    sheets.className = 'cs-po-card-sheets';
    sheets.innerHTML = '<strong>' + po.totalSheetsRequired + '</strong>sheets required';

    card.appendChild(main);
    card.appendChild(sheets);
    list.appendChild(card);
  });
}

function openOrder(poNumber) {
  // Switch to the detail view immediately on click - previously nothing
  // appeared until every one of the calls below had resolved, which on a
  // slow connection just looked like the app had hung. Now the view +
  // spinner show right away and only the content underneath waits.
  el('dashboard-view').style.display = 'none';
  el('detail-view').style.display = 'block';
  el('detail-po-title').textContent = poNumber;
  el('detail-status-pill').innerHTML = '';
  el('detail-loading').style.display = 'flex';
  el('detail-error').style.display = 'none';
  el('detail-content').style.display = 'none';

  // Was 3 sequential round trips (5 parallel calls, then modelParts, then
  // planVersionsForModel - each waiting on the previous wave's result); on
  // Apps Script's ~3-5s-per-call overhead that was 9-15s to open one PO.
  // orderDetailBundle does the same work server-side in one execution.
  apiGet('orderDetailBundle', { poNumber: poNumber }).then(function (result) {
    if (!result.ok) {
      el('detail-loading').style.display = 'none';
      el('detail-error').textContent = 'Could not load ' + poNumber + ': ' + result.error;
      el('detail-error').style.display = 'block';
      return;
    }
    var bundle = result.data;
    currentOrder = bundle.order;
    activeVersion = bundle.activeVersion;
    extras = bundle.extras;
    allModels = bundle.allModels;
    knownExtraParts = bundle.knownExtraParts;
    modelPartsMap = (bundle.modelParts && bundle.modelParts.partsPerUnit) || {};
    modelPartNames = Object.keys(modelPartsMap);
    versionHistory = bundle.versionHistory;
    leftoverByPart = bundle.leftoverByPart || {};
    actualCutDrafts = {};
    refreshKnownExtraPartsDatalist();
    workingSheets = cloneSheets(activeVersion.sheets);
    planDirty = false;

    el('detail-loading').style.display = 'none';
    el('detail-content').style.display = 'block';
    el('detail-po-title').textContent = currentOrder.poNumber;
    renderStatusPill();
    renderPoSummary();
    renderHistoryTab();
    selectTab('plan');
    renderPlanTab();
    renderExtrasTab();
  }).catch(function (err) {
    el('detail-loading').style.display = 'none';
    el('detail-error').textContent = 'Could not load ' + poNumber + ': ' + (err && err.message ? err.message : err);
    el('detail-error').style.display = 'block';
  });
}

function renderStatusPill() {
  var pill = el('detail-status-pill');
  pill.innerHTML = '<span class="status-pill status-' + currentOrder.cuttingStatus + '">' + currentOrder.cuttingStatus + '</span>';
}

function cloneSheets(sheets) {
  return (sheets || []).map(function (s) {
    var sheet = {
      width: s.width !== undefined ? s.width : '',
      height: s.height !== undefined ? s.height : '',
      thickness: s.thickness !== undefined ? s.thickness : '',
      outputs: (s.outputs || []).map(function (o) {
        var out = { partName: o.partName || '', qty: o.qty !== undefined ? o.qty : '' };
        if (o.isExtra) {
          out.isExtra = true;
          out.size = o.size || '';
        } else if (o.size) {
          // A one-time size set on a regular part (handlePartSizeChange's
          // "just this PO" path) - must survive round-tripping through this
          // working copy too, not just saveNewVersion's own serialization,
          // or it silently vanishes the next time this PO is reopened.
          out.size = o.size;
        }
        if (o.multiYield) {
          out.multiYield = true;
          out.yieldPerSheet = o.yieldPerSheet !== undefined ? o.yieldPerSheet : '';
        }
        return out;
      })
    };
    // Cutting Configuration's "Sheet Qty" - a fixed sheets-needed total set
    // on the plan itself. Not editable here, but must be preserved through
    // this working copy so saveNewVersion doesn't silently drop it.
    if (s.qty !== undefined && s.qty !== null && s.qty !== '' && Number(s.qty) > 0) {
      sheet.qty = s.qty;
    }
    return sheet;
  });
}

function loadVersionHistory() {
  return apiGet('planVersionsForModel', { modelName: currentOrder.modelName }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    versionHistory = result.data;
    renderHistoryTab();
  });
}

// The "N" that drives sheet math, mirroring Orders.gs getOrderSheetMultiplier:
// a bulk PO's plan is denominated per baseQty-batch, so N is the multiplier
// snapshotted at creation, not the raw unit qty.
function getCurrentOrderSheetMultiplier() {
  return currentOrder.planType === 'bulk' ? currentOrder.bulkMultiplier : currentOrder.qty;
}

function renderPoSummary() {
  var box = el('po-summary');
  box.innerHTML = '';
  var fields = [
    ['Model', currentOrder.modelName],
    ['Qty', currentOrder.planType === 'bulk'
      ? currentOrder.qty + ' <span class="muted">(Bulk ×' + currentOrder.bulkBaseQty + ', ' + currentOrder.bulkMultiplier + '×)</span>'
      : currentOrder.qty],
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
  if (!canEdit('cuttingStage')) {
    alert('View only - ask an admin for edit access to mark sheets complete.');
    return;
  }
  if (!confirm('Mark every sheet in ' + currentOrder.poNumber + ' as complete?')) return;
  apiPost('markAllSheetsComplete', { poNumber: currentOrder.poNumber }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    currentOrder = result.data;
    renderStatusPill();
    renderPlanTab();
  }).catch(showFatalError);
}

function toggleSheetComplete(sheetIndex, completed, actualSheetsCut) {
  if (!canEdit('cuttingStage')) {
    showFatalError('View only - ask an admin for edit access to mark sheets complete.');
    renderPlanTab();
    return;
  }
  var payload = { poNumber: currentOrder.poNumber, sheetIndex: sheetIndex, completed: completed };
  if (completed && actualSheetsCut !== undefined && actualSheetsCut !== null) {
    payload.actualSheetsCut = actualSheetsCut;
  }
  // workingSheets[sheetIndex] already reflects every live edit made to this
  // sheet's W/H/T and part-output rows (each input updates it directly as
  // the operator types - see buildPlanSheetCard/buildPlanOutputRow), even
  // if "Save as New Plan Version" was never clicked. Send it along so
  // setSheetComplete persists exactly what's on screen instead of the last
  // actually-saved plan - otherwise those edits both get lost on reload AND
  // never actually influenced the stock/ledger booking this triggers.
  if (completed && workingSheets && workingSheets[sheetIndex]) {
    payload.sheetData = workingSheets[sheetIndex];
  }
  apiPost('setSheetComplete', payload).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    currentOrder = result.data;
    renderStatusPill();
    renderPlanTab();
  }).catch(showFatalError);
}

// Adjusts a not-yet-done sheet's planned/actual cut count directly from its
// card - independent of marking it done. Blank clears back to the
// calculated default. Refused server-side once the sheet is already marked
// done (setSheetQtyOverride) - editing here is for getting the number right
// ahead of cutting, not for retroactively changing what stock/ledger already
// booked at mark-done time.
function saveSheetQtyOverride(sheetIndex, rawValue) {
  if (!canEdit('cuttingStage')) {
    showFatalError('View only - ask an admin for edit access to change this.');
    renderPlanTab();
    return;
  }
  apiPost('setSheetQtyOverride', {
    poNumber: currentOrder.poNumber,
    sheetIndex: sheetIndex,
    value: rawValue
  }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    delete actualCutDrafts[sheetIndex];
    currentOrder = result.data;
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

  var plan = computeSheetPlanClient(workingSheets, getCurrentOrderSheetMultiplier(), currentOrder.multiYieldDecisions || {}, currentOrder.sheetQtyOverrides || {});
  workingSheets.forEach(function (sheet, sheetIndex) {
    body.appendChild(buildPlanSheetCard(sheet, sheetIndex, plan[sheetIndex]));
  });
}

function resolveMultiYieldDecision(key, choice) {
  if (!canEdit('cuttingStage')) {
    alert('View only - ask an admin for edit access to resolve this.');
    return;
  }
  apiPost('setMultiYieldDecision', {
    poNumber: currentOrder.poNumber,
    key: key,
    choice: choice
  }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    currentOrder = result.data;
    renderPlanTab();
  }).catch(showFatalError);
}

function isSheetComplete(sheetIndex) {
  return !!(currentOrder.sheetCompletion && currentOrder.sheetCompletion[sheetIndex]);
}

function buildPlanSheetCard(sheet, sheetIndex, sheetPlan) {
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
  doneCheckbox.disabled = !canEdit('cuttingStage');
  doneCheckbox.addEventListener('change', function (e) {
    if (e.target.checked) {
      showExtraPartsModal(sheetIndex, function (actualCut) { toggleSheetComplete(sheetIndex, true, actualCut); });
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

  var multiplier = getCurrentOrderSheetMultiplier();
  var isBulk = currentOrder.planType === 'bulk';
  var anyMulti = sheetPlan && sheetPlan.rows.some(function (r) { return r.multiYield; });
  var plannedText = (sheetPlan && anyMulti)
    ? 'Physical sheets to cut for this PO: ' + sheetPlan.physicalSheets
    : (isBulk
        ? 'Sheets needed: 1 per batch × ' + multiplier + '× = ' + multiplier + ' total (Bulk ×' + currentOrder.bulkBaseQty + ')'
        : 'Sheets needed: 1 per unit × ' + multiplier + ' = ' + multiplier + ' total');

  var totalLine = document.createElement('div');
  totalLine.className = 'cs-sheet-total-line';

  var plannedSpan = document.createElement('span');
  plannedSpan.textContent = plannedText;
  totalLine.appendChild(plannedSpan);

  // The actual (or, before it's set, planned) sheet count for THIS
  // sheet-type - what every output row's "x N = total" below is computed
  // against. A mutable ref (not a plain number) so the actual-sheet input's
  // live typing can refresh every already-built output row's total without
  // a full re-render (see outputTotalRefs below).
  var effectiveSheetsRef = { value: sheetPlan ? sheetPlan.physicalSheets : multiplier };

  // Editable right here, ahead of actually cutting - separate from (but
  // feeding into) the "Sheets actually cut" prompt shown when marking this
  // sheet done, which pre-fills from whatever's set here. Once the sheet is
  // done, stock/ledger are already computed from the locked-in number, so
  // it's shown read-only instead of editable to avoid implying a later edit
  // here would retroactively fix them.
  //
  // Typing here only stages a local draft (actualCutDrafts) - nothing is
  // sent until its own small Save button is clicked. Deliberately NOT tied
  // to "Save as New Plan Version": that button resets this PO's entire
  // cutting/bending progress (a structural-recipe-change action), which a
  // quantity tweak has nothing to do with.
  if (sheetPlan) {
    if (done) {
      var lockedSpan = document.createElement('span');
      lockedSpan.className = 'cs-actual-cut-locked';
      lockedSpan.textContent = (sheetPlan.overridden ? 'Actual sheet: ' : 'Cut: ') + sheetPlan.physicalSheets;
      totalLine.appendChild(lockedSpan);
    } else {
      var committedValue = sheetPlan.physicalSheets;
      var draftValue = actualCutDrafts.hasOwnProperty(sheetIndex) ? actualCutDrafts[sheetIndex] : committedValue;
      effectiveSheetsRef.value = Number(draftValue) || 0;

      var actualWrap = document.createElement('span');
      actualWrap.className = 'cs-actual-cut-wrap';
      var actualLabel = document.createElement('span');
      actualLabel.textContent = 'Actual sheet:';
      actualWrap.appendChild(actualLabel);
      var actualInput = document.createElement('input');
      actualInput.type = 'number';
      actualInput.min = '0';
      actualInput.className = 'cs-actual-cut-input';
      actualInput.disabled = !canEdit('cuttingStage');
      actualInput.title = 'Adjust the planned sheet count ahead of cutting - optional, and can still be confirmed or changed again when marking this sheet done';
      actualInput.value = draftValue;

      var saveActualBtn = document.createElement('button');
      saveActualBtn.type = 'button';
      saveActualBtn.className = 'btn-secondary cs-actual-cut-save-btn';
      saveActualBtn.textContent = 'Save';
      saveActualBtn.disabled = !actualCutDrafts.hasOwnProperty(sheetIndex);

      actualInput.addEventListener('input', function (e) {
        // Only keep an entry while it genuinely differs from what's
        // committed - keeps actualCutDrafts' key set an exact "which sheets
        // have a real unsaved edit" set, reusable for the discard-changes
        // warnings below without recomputing anything.
        if (String(e.target.value) === String(committedValue)) {
          delete actualCutDrafts[sheetIndex];
        } else {
          actualCutDrafts[sheetIndex] = e.target.value;
        }
        saveActualBtn.disabled = !actualCutDrafts.hasOwnProperty(sheetIndex);
        effectiveSheetsRef.value = Number(e.target.value) || 0;
        outputTotalRefs.forEach(function (ref) {
          updateOutputTotal(ref.totalSpan, ref.qtyInput.value, effectiveSheetsRef.value);
        });
      });

      saveActualBtn.addEventListener('click', function () {
        saveSheetQtyOverride(sheetIndex, actualInput.value);
      });

      actualWrap.appendChild(actualInput);
      actualWrap.appendChild(saveActualBtn);
      totalLine.appendChild(actualWrap);
    }
  }
  card.appendChild(totalLine);

  var outputTotalRefs = [];
  sheet.outputs.forEach(function (output, outputIndex) {
    var built = buildPlanOutputRow(sheetIndex, output, outputIndex, effectiveSheetsRef);
    card.appendChild(built.element);
    outputTotalRefs.push({ qtyInput: built.qtyInput, totalSpan: built.totalSpan });
  });

  if (sheetPlan && (anyMulti || sheetPlan.decisionKey)) {
    card.appendChild(buildMultiYieldGuidance(sheetPlan));
  }

  var addOutputBtn = document.createElement('button');
  addOutputBtn.className = 'btn-secondary';
  addOutputBtn.textContent = '+ Add Part Output';
  addOutputBtn.addEventListener('click', function () { addOutputRow(sheetIndex); });
  card.appendChild(addOutputBtn);

  return card;
}

function buildMultiYieldGuidance(sheetPlan) {
  var wrap = document.createElement('div');
  wrap.className = 'my-guidance';

  sheetPlan.rows.forEach(function (r) {
    var l = document.createElement('div');
    // "actual" once this sheet's real cut count has replaced the calculated
    // one (from PO creation, or from marking it done) - sheetPlan.overridden
    // comes straight from computeSheetPlanClient's own override handling.
    var txt = r.partName + ' — need ' + r.totalNeeded + ', ' + (sheetPlan.overridden ? 'actual ' : '') +
      sheetPlan.physicalSheets + ' × ' + r.yieldPerSheet + '/sheet = ' + r.produced;
    if (r.surplus > 0) txt += ' (' + r.surplus + ' surplus → Leftover Ledger on mark-done)';
    else if (r.shortOnScrap > 0) txt += ' — ' + r.shortOnScrap + ' to cut on scrap';
    else txt += ' (exact)';
    if (r.isBinding) txt += '  ← drives the count';
    l.textContent = txt;
    wrap.appendChild(l);
  });

  if (sheetPlan.decisionKey) {
    var key = sheetPlan.decisionKey;
    var rem = sheetPlan.bindingRemainder;
    if (sheetPlan.choice === 'extra-sheet') {
      var d1 = document.createElement('div');
      d1.textContent = '→ Decided: cut ' + sheetPlan.physicalSheets + ' sheets (1 extra full).';
      wrap.appendChild(d1);
    } else if (sheetPlan.choice === 'scrap') {
      var d2 = document.createElement('div');
      d2.textContent = '→ Decided: cut ' + sheetPlan.baseSheets + ' sheets, then log the ' + rem +
        ' short pcs via "Log Extra Sheet Cut" on the Extras tab.';
      wrap.appendChild(d2);
    } else {
      var decision = document.createElement('div');
      decision.className = 'my-decision';
      var p = document.createElement('p');
      p.textContent = 'Decision needed: driving part is ' + rem + ' short of a full sheet.';
      decision.appendChild(p);
      var btns = document.createElement('div');
      btns.className = 'my-decision-btns';
      var b1 = document.createElement('button');
      b1.className = 'btn-primary';
      b1.textContent = 'Cut 1 extra full sheet';
      b1.addEventListener('click', function () { resolveMultiYieldDecision(key, 'extra-sheet'); });
      var b2 = document.createElement('button');
      b2.className = 'btn-secondary';
      b2.textContent = 'Cut ' + rem + ' pcs on scrap';
      b2.addEventListener('click', function () { resolveMultiYieldDecision(key, 'scrap'); });
      btns.appendChild(b1);
      btns.appendChild(b2);
      decision.appendChild(btns);
      wrap.appendChild(decision);
    }
  }
  return wrap;
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

function buildPlanOutputRow(sheetIndex, output, outputIndex, effectiveSheetsRef) {
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
  } else if (output.partName) {
    // Every regular part gets a size box too, not just extras - defaults to
    // whatever's already set on this specific output, else the model's own
    // part definition (Cutting Configuration's Size field, if it has one).
    // Changing it asks where that edit should live - see
    // handlePartSizeChange.
    var partSizeInput = document.createElement('input');
    partSizeInput.type = 'text';
    partSizeInput.className = 'cs-part-size-input';
    partSizeInput.placeholder = 'Size';
    partSizeInput.title = "Edit this part's size";
    partSizeInput.value = (output.size !== undefined && output.size !== null && output.size !== '')
      ? output.size
      : getModelPartSize(output.partName);
    partSizeInput.addEventListener('change', function (e) {
      handlePartSizeChange(sheetIndex, outputIndex, output.partName, e.target.value);
    });
    row.appendChild(partSizeInput);
  }

  var qtyInput = document.createElement('input');
  qtyInput.type = 'number';
  qtyInput.placeholder = 'Qty/sheet';
  qtyInput.value = output.qty;
  qtyInput.addEventListener('input', function (e) {
    workingSheets[sheetIndex].outputs[outputIndex].qty = e.target.value;
    updateOutputTotal(totalSpan, e.target.value, effectiveSheetsRef.value);
  });
  qtyInput.addEventListener('change', function () { markDirty(); });

  var totalSpan = document.createElement('span');
  totalSpan.className = 'cs-output-total';
  updateOutputTotal(totalSpan, output.qty, effectiveSheetsRef.value);

  var removeBtn = document.createElement('button');
  removeBtn.className = 'icon-btn';
  removeBtn.textContent = '×';
  removeBtn.title = 'Remove output row';
  removeBtn.addEventListener('click', function () { removeOutputRow(sheetIndex, outputIndex); });

  row.appendChild(qtyInput);
  row.appendChild(totalSpan);
  row.appendChild(removeBtn);

  // The Multi-yield (one sheet cuts many) toggle + pcs-per-sheet input used
  // to be editable here too, mirroring Cutting Configuration's own output
  // row. Removed from Cutting Stage - that's a config-time decision now,
  // made once in Cutting Configuration, not something to flip ad hoc during
  // production. Existing multi-yield outputs (output.multiYield/
  // yieldPerSheet, set via Cutting Config) are untouched and keep working
  // exactly as before - this only removes the ability to toggle it here.

  var container = document.createElement('div');
  container.appendChild(row);

  // Purely informational - doesn't change this row's math at all, just
  // flags that some of this part is already sitting cut from a previous
  // over-cut, in case that changes what the operator chooses to cut now.
  if (!output.isExtra && output.partName && leftoverByPart[output.partName] > 0) {
    var leftoverNote = document.createElement('div');
    leftoverNote.className = 'leftover-note';
    leftoverNote.textContent = leftoverByPart[output.partName] + ' pcs already available in leftover stock.';
    container.appendChild(leftoverNote);
  }

  return { element: container, qtyInput: qtyInput, totalSpan: totalSpan };
}

// Reads modelPartsMap (raw Models.PartsPerUnit) - values are either a bare
// qty number (legacy/no size set) or {qty,size} once Cutting Configuration's
// own Size field has been used for that part.
function getModelPartSize(partName) {
  var raw = modelPartsMap[partName];
  return (raw && typeof raw === 'object') ? String(raw.size || '') : '';
}

function getModelPartQty(partName) {
  var raw = modelPartsMap[partName];
  return Number((raw && typeof raw === 'object') ? raw.qty : raw) || 0;
}

// A part's size can be edited from either Cutting Configuration (permanent,
// affects every future order) or right here on a specific PO's output row.
// Ask which one this edit is - there's no way to tell intent from the value
// alone, and the two have very different reach.
function handlePartSizeChange(sheetIndex, outputIndex, partName, newSize) {
  newSize = (newSize || '').trim();
  var savePermanently = confirm(
    'Save "' + newSize + '" as ' + partName + '\'s size in the part definition?\n' +
    'This applies to every future order for this model.\n\n' +
    'Choose Cancel to use it just for this one PO instead.'
  );

  if (savePermanently) {
    if (!canEdit('cuttingConfig')) {
      alert('You need edit access to Cutting Configuration to save this permanently - using it just for this PO instead.');
      workingSheets[sheetIndex].outputs[outputIndex].size = newSize;
      markDirty();
      renderPlanTab();
      return;
    }
    var updated = {};
    Object.keys(modelPartsMap).forEach(function (name) { updated[name] = modelPartsMap[name]; });
    updated[partName] = { qty: getModelPartQty(partName), size: newSize };
    apiPost('saveModelParts', { modelName: currentOrder.modelName, partsPerUnit: updated }).then(function (result) {
      if (!result.ok) return showFatalError(result.error);
      modelPartsMap = updated;
      renderPlanTab();
    }).catch(showFatalError);
  } else {
    workingSheets[sheetIndex].outputs[outputIndex].size = newSize;
    markDirty();
    renderPlanTab();
  }
}

// sheets is the sheet-type's effective (actual, or planned before it's set)
// physical count - NOT the PO's raw unit qty/bulk multiplier. Those only
// coincide for a plain 1-sheet-per-unit sheet with no override; a
// multi-yield sheet's physical count is already different from the
// multiplier even before any override, and an override moves it further
// still - so this must always be the one true source (sheetPlan.
// physicalSheets, or its draft), never re-derived from the multiplier here.
function updateOutputTotal(span, qtyPerSheet, sheets) {
  var perSheet = Number(qtyPerSheet) || 0;
  var n = Number(sheets) || 0;
  var total = perSheet * n;
  span.textContent = '× ' + n + ' = ' + total;
}

function addSheet() {
  workingSheets.push({ width: '', height: '', thickness: '', outputs: [] });
  markDirty();
  renderPlanTab();
}

function removeSheet(sheetIndex) {
  workingSheets.splice(sheetIndex, 1);
  actualCutDrafts = {}; // indices below sheetIndex just shifted - any staged draft is now pointing at the wrong sheet
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
  if (!canEdit('cuttingStage')) {
    alert('View only - ask an admin for edit access to save a plan version.');
    return;
  }
  var sheets = workingSheets.map(function (s) {
    var sheetOut = {
      width: Number(s.width) || 0,
      height: Number(s.height) || 0,
      thickness: Number(s.thickness) || 0,
      outputs: s.outputs.map(function (o) {
        var out = { partName: o.partName, qty: Number(o.qty) || 0 };
        if (o.isExtra) {
          out.isExtra = true;
          out.size = o.size || '';
        } else if (o.size) {
          // A one-time size set on this specific output (handlePartSizeChange's
          // "just this PO" path) - not the model's own part size, which
          // lives in Models.PartsPerUnit instead and needs no saving here.
          out.size = o.size;
        }
        if (o.multiYield && Number(o.yieldPerSheet) >= 1) {
          out.multiYield = true;
          out.yieldPerSheet = Number(o.yieldPerSheet);
        }
        return out;
      })
    };
    // Not editable from Cutting Stage, but must not be silently dropped if
    // Cutting Configuration set it - see cloneSheets.
    if (Number(s.qty) > 0) {
      sheetOut.qty = Number(s.qty);
    }
    return sheetOut;
  });

  setPlanSaveStatus('Saving…', 'saving');
  var saveBtn = el('save-version-btn');
  var originalLabel = saveBtn.textContent;
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner"></span> Saving…';

  apiPost('saveNewPlanVersion', {
    poNumber: currentOrder.poNumber,
    sheets: sheets,
    note: el('plan-version-note').value
  }).then(function (result) {
    saveBtn.disabled = false;
    saveBtn.textContent = originalLabel;
    if (!result.ok) {
      setPlanSaveStatus('Save failed: ' + result.error, 'error');
      return;
    }
    // saveNewPlanVersion now bundles the refreshed order in with the version
    // (its write resets SheetCompletion/status) - one round trip instead of
    // a write followed by a separate apiGet('order', ...).
    activeVersion = result.data.version;
    currentOrder = result.data.order;
    workingSheets = cloneSheets(activeVersion.sheets);
    actualCutDrafts = {};
    planDirty = false;
    renderStatusPill();
    renderPlanTab();
    extraPartFormState = null;
    renderExtraPartForm();
    setPlanSaveStatus('Saved as version ' + activeVersion.versionNumber, '');
    loadVersionHistory();
  }).catch(function () {
    saveBtn.disabled = false;
    saveBtn.textContent = originalLabel;
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
  if (!canEdit('cuttingStage')) {
    alert('View only - ask an admin for edit access to switch plan versions.');
    return;
  }
  if (!confirmDiscardPlanIfDirty()) return;
  apiPost('setActivePlanVersionForOrder', { poNumber: currentOrder.poNumber, versionId: versionId }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    // Same bundled {version, order} response as saveNewPlanVersion - see
    // comment there.
    activeVersion = result.data.version;
    currentOrder = result.data.order;
    workingSheets = cloneSheets(activeVersion.sheets);
    actualCutDrafts = {};
    planDirty = false;
    renderStatusPill();
    renderPlanTab();
    extraPartFormState = null;
    renderExtraPartForm();
    renderHistoryTab();
    selectTab('plan');
  }).catch(showFatalError);
}

function renderExtrasTab() {
  renderExtraSheetForm();
  extraPartFormState = null;
  renderExtraPartForm();
  renderExtrasList();
}

// Shared by both extras forms. The logged extra always becomes its own
// Bending task on its own (see getExtraBendingEntries server-side) -
// posting it to the Leftover Ledger too is a separate, optional choice,
// since the part's already accounted for via that task either way. Default
// unchecked for that reason.
function buildAddToInventoryCheckbox(state) {
  var wrap = document.createElement('label');
  wrap.className = 'cs-sheet-done-label';
  wrap.style.margin = 'var(--space-2) 0';
  var cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !!state.addToInventory;
  cb.addEventListener('change', function (e) { state.addToInventory = e.target.checked; });
  var text = document.createElement('span');
  text.textContent = 'Also add to Extra Part Inventory (Leftover Ledger)';
  text.style.fontWeight = '400';
  text.style.fontSize = '13px';
  wrap.appendChild(cb);
  wrap.appendChild(text);
  return wrap;
}

function renderExtraSheetForm() {
  var wrap = el('extra-sheet-form');
  wrap.innerHTML = '';

  var state = { width: '', height: '', thickness: '', outputs: [{ partName: '', qty: '' }], addToInventory: false };

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

  wrap.appendChild(buildAddToInventoryCheckbox(state));

  var submitBtn = document.createElement('button');
  submitBtn.className = 'btn-primary btn-block';
  submitBtn.style.marginTop = '10px';
  submitBtn.textContent = 'Log Extra Sheet Cut';
  submitBtn.disabled = !canEdit('cuttingStage');
  submitBtn.addEventListener('click', function () {
    if (!canEdit('cuttingStage')) { alert('View only - ask an admin for edit access to log extras.'); return; }
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
      addToInventory: !!state.addToInventory,
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
    extraPartFormState = { sheetIndex: '', partName: '', qty: '', isExtra: false, size: '', addToInventory: false };
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

  wrap.appendChild(buildAddToInventoryCheckbox(state));

  var submitBtn = document.createElement('button');
  submitBtn.className = 'btn-primary btn-block';
  submitBtn.textContent = 'Log Extra Part';
  submitBtn.disabled = !canEdit('cuttingStage');
  submitBtn.addEventListener('click', function () {
    if (!canEdit('cuttingStage')) { alert('View only - ask an admin for edit access to log extras.'); return; }
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
      addToInventory: !!state.addToInventory,
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

document.addEventListener('DOMContentLoaded', function () {
  requireAuth().then(function () {
    renderSideNav('cuttingStage');
    initCuttingStage();
  });
});
