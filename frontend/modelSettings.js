var modelForm = null;
var bendingWrapEl = null;
var bendingSequenceWrapEl = null;

function getAllPartNamesFromSheets() {
  var names = {};
  modelForm.sheetRows.forEach(function (row) {
    row.parts.split(',').forEach(function (token) {
      var name = token.split(':')[0].trim();
      if (name) names[name] = true;
    });
  });
  return Object.keys(names).sort();
}

function refreshPartDependentSections() {
  if (bendingWrapEl) {
    renderBendingRows(bendingWrapEl);
  }
  if (bendingSequenceWrapEl) {
    renderBendingSequenceRows(bendingSequenceWrapEl);
  }
}

function emptyModelForm() {
  return {
    modelNoName: '',
    locked: false,
    sheetRows: [{ code: '', parts: '', minutes: '' }],
    bomRows: [{ item: '', qty: '' }],
    bendingSequence: [],
    bendingRows: [{ partName: '', minutes: '' }],
    assemblyTimeTarget: '',
    fittingTimeTarget: ''
  };
}

function partsMapToDisplayText(rawParts) {
  if (!rawParts) return '';
  if (Array.isArray(rawParts)) {
    var counts = {};
    rawParts.forEach(function (name) { counts[name] = (counts[name] || 0) + 1; });
    rawParts = counts;
  }
  return Object.keys(rawParts).map(function (name) {
    return name + ':' + rawParts[name];
  }).join(', ');
}

function modelToForm(m) {
  var cuttingTargets = m.cuttingTimeTargets || {};
  var sheetRows = m.sheetSequence.map(function (code) {
    return {
      code: code,
      parts: partsMapToDisplayText(m.partsPerSheet[code]),
      minutes: cuttingTargets[code] !== undefined ? cuttingTargets[code] : ''
    };
  });
  if (sheetRows.length === 0) sheetRows.push({ code: '', parts: '', minutes: '' });

  var bomRows = Object.keys(m.bom).map(function (item) {
    return { item: item, qty: m.bom[item] };
  });
  if (bomRows.length === 0) bomRows.push({ item: '', qty: '' });

  var bendingTargets = m.bendingTimeTargets || {};
  var bendingRows = Object.keys(bendingTargets).map(function (partName) {
    return { partName: partName, minutes: bendingTargets[partName] };
  });
  if (bendingRows.length === 0) bendingRows.push({ partName: '', minutes: '' });

  return {
    modelNoName: m.modelNoName,
    locked: true,
    sheetRows: sheetRows,
    bomRows: bomRows,
    bendingSequence: (m.bendingSequence || []).slice(),
    bendingRows: bendingRows,
    assemblyTimeTarget: m.assemblyTimeTarget,
    fittingTimeTarget: m.fittingTimeTarget
  };
}

function renderModelSettingsView() {
  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Model Settings'));

  var loading = document.createElement('div');
  loading.className = 'guide-banner';
  loading.textContent = 'Loading models…';
  root.appendChild(loading);

  apiGet('models', { userId: currentSession.userId }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    renderModelSettingsList(result.data);
  }).catch(showFatalError);
}

function renderModelSettingsList(models) {
  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Model Settings'));

  var addBtn = document.createElement('button');
  addBtn.className = 'btn btn-primary btn-block add-row-btn';
  addBtn.textContent = '+ Add New Model';
  addBtn.addEventListener('click', function () {
    modelForm = emptyModelForm();
    renderModelSettingsForm();
  });
  root.appendChild(addBtn);

  if (models.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No models configured yet. Add one to start taking orders for it.';
    root.appendChild(empty);
    return;
  }

  models.forEach(function (m) {
    var card = document.createElement('div');
    card.className = 'card list-row';
    card.innerHTML =
      '<div class="list-row-title">' + m.modelNoName + '</div>' +
      '<div class="muted">Assembly ' + m.assemblyTimeTarget + 'm · Fitting ' + m.fittingTimeTarget + 'm — cutting/bending times set per sheet/part</div>';
    card.addEventListener('click', function () {
      modelForm = modelToForm(m);
      renderModelSettingsForm();
    });
    root.appendChild(card);
  });
}

function renderModelSettingsForm() {
  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader(modelForm.locked ? 'Edit ' + modelForm.modelNoName : 'New Model'));

  var nameField = buildTextField('Model No / Name', modelForm.modelNoName, function (v) {
    modelForm.modelNoName = v;
  });
  if (modelForm.locked) {
    nameField.querySelector('input').disabled = true;
  }
  root.appendChild(nameField);

  var seqTitle = document.createElement('div');
  seqTitle.className = 'section-title';
  seqTitle.textContent = 'Cutting Sheet Sequence';
  root.appendChild(seqTitle);

  var seqHint = document.createElement('div');
  seqHint.className = 'muted';
  seqHint.style.marginBottom = '10px';
  seqHint.textContent = 'Order matters — this is the fixed cut order. Parts as Name:Qty (e.g. Side:2, Palla Support:3), comma-separated, per unit. Minutes = time to cut ONE physical sheet of this pattern.';
  root.appendChild(seqHint);

  var seqWrap = document.createElement('div');
  root.appendChild(seqWrap);
  renderSheetRows(seqWrap);

  var addSheetBtn = document.createElement('button');
  addSheetBtn.className = 'btn btn-secondary add-row-btn';
  addSheetBtn.textContent = '+ Add Sheet';
  addSheetBtn.addEventListener('click', function () {
    modelForm.sheetRows.push({ code: '', parts: '', minutes: '' });
    renderSheetRows(seqWrap);
  });
  root.appendChild(addSheetBtn);

  var bomTitle = document.createElement('div');
  bomTitle.className = 'section-title';
  bomTitle.textContent = 'Bill of Materials (per unit)';
  root.appendChild(bomTitle);

  var bomWrap = document.createElement('div');
  root.appendChild(bomWrap);
  renderBomRows(bomWrap);

  var addBomBtn = document.createElement('button');
  addBomBtn.className = 'btn btn-secondary add-row-btn';
  addBomBtn.textContent = '+ Add BOM Item';
  addBomBtn.addEventListener('click', function () {
    modelForm.bomRows.push({ item: '', qty: '' });
    renderBomRows(bomWrap);
  });
  root.appendChild(addBomBtn);

  var bendingSeqTitle = document.createElement('div');
  bendingSeqTitle.className = 'section-title';
  bendingSeqTitle.textContent = 'Bending Sequence';
  root.appendChild(bendingSeqTitle);

  var bendingSeqHint = document.createElement('div');
  bendingSeqHint.className = 'muted';
  bendingSeqHint.style.marginBottom = '10px';
  bendingSeqHint.textContent = 'Order matters — sets the default order parts are queued for bending, per unit. The checker can still reorder the live queue manually.';
  root.appendChild(bendingSeqHint);

  bendingSequenceWrapEl = document.createElement('div');
  root.appendChild(bendingSequenceWrapEl);
  renderBendingSequenceRows(bendingSequenceWrapEl);

  var bendingTitle = document.createElement('div');
  bendingTitle.className = 'section-title';
  bendingTitle.textContent = 'Bending Time per Part';
  root.appendChild(bendingTitle);

  var bendingHint = document.createElement('div');
  bendingHint.className = 'muted';
  bendingHint.style.marginBottom = '10px';
  bendingHint.textContent = 'Minutes to bend ONE piece of that part. The dropdown lists parts you\'ve entered above.';
  root.appendChild(bendingHint);

  bendingWrapEl = document.createElement('div');
  root.appendChild(bendingWrapEl);
  renderBendingRows(bendingWrapEl);

  var addBendingBtn = document.createElement('button');
  addBendingBtn.className = 'btn btn-secondary add-row-btn';
  addBendingBtn.textContent = '+ Add Part Time';
  addBendingBtn.addEventListener('click', function () {
    modelForm.bendingRows.push({ partName: '', minutes: '' });
    renderBendingRows(bendingWrapEl);
  });
  root.appendChild(addBendingBtn);

  var targetsTitle = document.createElement('div');
  targetsTitle.className = 'section-title';
  targetsTitle.textContent = 'Time Targets (minutes, per unit)';
  root.appendChild(targetsTitle);

  root.appendChild(buildNumberField('Assembly', modelForm.assemblyTimeTarget, function (v) { modelForm.assemblyTimeTarget = v; }));
  root.appendChild(buildNumberField('Fitting', modelForm.fittingTimeTarget, function (v) { modelForm.fittingTimeTarget = v; }));

  var saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary btn-block';
  saveBtn.textContent = 'Save Model';
  saveBtn.addEventListener('click', submitModelForm);
  root.appendChild(saveBtn);
}

function renderSheetRows(wrap) {
  wrap.innerHTML = '';
  modelForm.sheetRows.forEach(function (row, i) {
    var line = document.createElement('div');
    line.className = 'dynamic-row';

    var codeInput = document.createElement('input');
    codeInput.placeholder = 'Sheet code (e.g. A)';
    codeInput.value = row.code;
    codeInput.style.maxWidth = '90px';
    codeInput.addEventListener('input', function (e) { row.code = e.target.value; });

    var partsInput = document.createElement('input');
    partsInput.placeholder = 'Side:2, Palla Support:3';
    partsInput.value = row.parts;
    partsInput.addEventListener('input', function (e) {
      row.parts = e.target.value;
      refreshPartDependentSections();
    });

    var minutesInput = document.createElement('input');
    minutesInput.type = 'number';
    minutesInput.placeholder = 'Min/sheet';
    minutesInput.value = row.minutes;
    minutesInput.style.maxWidth = '90px';
    minutesInput.addEventListener('input', function (e) { row.minutes = e.target.value; });

    line.appendChild(codeInput);
    line.appendChild(partsInput);
    line.appendChild(minutesInput);

    if (modelForm.sheetRows.length > 1) {
      var removeBtn = document.createElement('button');
      removeBtn.className = 'remove-row-btn';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', function () {
        modelForm.sheetRows.splice(i, 1);
        renderSheetRows(wrap);
      });
      line.appendChild(removeBtn);
    }

    wrap.appendChild(line);
  });
}

function renderBomRows(wrap) {
  wrap.innerHTML = '';
  modelForm.bomRows.forEach(function (row, i) {
    var line = document.createElement('div');
    line.className = 'dynamic-row';

    var itemInput = document.createElement('input');
    itemInput.placeholder = 'Item name / SKU';
    itemInput.value = row.item;
    itemInput.addEventListener('input', function (e) { row.item = e.target.value; });

    var qtyInput = document.createElement('input');
    qtyInput.type = 'number';
    qtyInput.placeholder = 'Qty per unit';
    qtyInput.value = row.qty;
    qtyInput.style.maxWidth = '110px';
    qtyInput.addEventListener('input', function (e) { row.qty = e.target.value; });

    line.appendChild(itemInput);
    line.appendChild(qtyInput);

    if (modelForm.bomRows.length > 1) {
      var removeBtn = document.createElement('button');
      removeBtn.className = 'remove-row-btn';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', function () {
        modelForm.bomRows.splice(i, 1);
        renderBomRows(wrap);
      });
      line.appendChild(removeBtn);
    }

    wrap.appendChild(line);
  });
}

function renderBendingSequenceRows(wrap) {
  wrap.innerHTML = '';

  var allParts = getAllPartNamesFromSheets();
  var ordered = modelForm.bendingSequence.filter(function (p) { return allParts.indexOf(p) !== -1; });
  allParts.forEach(function (p) { if (ordered.indexOf(p) === -1) ordered.push(p); });
  modelForm.bendingSequence = ordered;

  if (ordered.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'Add parts to a sheet above first.';
    wrap.appendChild(empty);
    return;
  }

  ordered.forEach(function (partName, i) {
    var row = document.createElement('div');
    row.className = 'dynamic-row';

    var label = document.createElement('div');
    label.style.flex = '1';
    label.style.fontWeight = '600';
    label.textContent = (i + 1) + '. ' + partName;

    var upBtn = document.createElement('button');
    upBtn.className = 'btn btn-secondary';
    upBtn.style.minHeight = '40px';
    upBtn.style.padding = '6px 12px';
    upBtn.textContent = '↑';
    upBtn.disabled = i === 0;
    upBtn.addEventListener('click', function () {
      modelForm.bendingSequence.splice(i - 1, 0, modelForm.bendingSequence.splice(i, 1)[0]);
      renderBendingSequenceRows(wrap);
    });

    var downBtn = document.createElement('button');
    downBtn.className = 'btn btn-secondary';
    downBtn.style.minHeight = '40px';
    downBtn.style.padding = '6px 12px';
    downBtn.textContent = '↓';
    downBtn.disabled = i === ordered.length - 1;
    downBtn.addEventListener('click', function () {
      modelForm.bendingSequence.splice(i + 1, 0, modelForm.bendingSequence.splice(i, 1)[0]);
      renderBendingSequenceRows(wrap);
    });

    row.appendChild(label);
    row.appendChild(upBtn);
    row.appendChild(downBtn);
    wrap.appendChild(row);
  });
}

function renderBendingRows(wrap) {
  wrap.innerHTML = '';
  modelForm.bendingRows.forEach(function (row, i) {
    var line = document.createElement('div');
    line.className = 'dynamic-row';

    var nameSelect = document.createElement('select');
    var availableParts = getAllPartNamesFromSheets();
    if (row.partName && availableParts.indexOf(row.partName) === -1) {
      availableParts = [row.partName].concat(availableParts);
    }

    var placeholderOpt = document.createElement('option');
    placeholderOpt.value = '';
    placeholderOpt.textContent = availableParts.length ? '-- choose part --' : 'Add parts to a sheet first';
    nameSelect.appendChild(placeholderOpt);

    availableParts.forEach(function (partName) {
      var opt = document.createElement('option');
      opt.value = partName;
      opt.textContent = partName;
      nameSelect.appendChild(opt);
    });
    nameSelect.value = row.partName;
    nameSelect.addEventListener('change', function (e) { row.partName = e.target.value; });

    var minutesInput = document.createElement('input');
    minutesInput.type = 'number';
    minutesInput.placeholder = 'Min/piece';
    minutesInput.value = row.minutes;
    minutesInput.style.maxWidth = '110px';
    minutesInput.addEventListener('input', function (e) { row.minutes = e.target.value; });

    line.appendChild(nameSelect);
    line.appendChild(minutesInput);

    if (modelForm.bendingRows.length > 1) {
      var removeBtn = document.createElement('button');
      removeBtn.className = 'remove-row-btn';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', function () {
        modelForm.bendingRows.splice(i, 1);
        renderBendingRows(wrap);
      });
      line.appendChild(removeBtn);
    }

    wrap.appendChild(line);
  });
}

function submitModelForm() {
  if (!modelForm.modelNoName || !modelForm.modelNoName.trim()) {
    alert('Model name is required.');
    return;
  }

  var sheetSequence = [];
  var partsPerSheet = {};
  var cuttingTimeTargets = {};
  modelForm.sheetRows.forEach(function (row) {
    var code = row.code.trim();
    if (!code) return;
    sheetSequence.push(code);
    var parts = {};
    row.parts.split(',').forEach(function (token) {
      var pieces = token.split(':');
      var name = pieces[0].trim();
      if (!name) return;
      var qty = pieces[1] ? Number(pieces[1].trim()) || 1 : 1;
      parts[name] = qty;
    });
    partsPerSheet[code] = parts;
    cuttingTimeTargets[code] = Number(row.minutes) || 0;
  });

  var bom = {};
  modelForm.bomRows.forEach(function (row) {
    var item = row.item.trim();
    if (!item) return;
    bom[item] = Number(row.qty) || 0;
  });

  var bendingTimeTargets = {};
  modelForm.bendingRows.forEach(function (row) {
    var partName = row.partName.trim();
    if (!partName) return;
    bendingTimeTargets[partName] = Number(row.minutes) || 0;
  });

  apiPost('saveModel', {
    userId: currentSession.userId,
    modelNoName: modelForm.modelNoName.trim(),
    sheetSequence: sheetSequence,
    partsPerSheet: partsPerSheet,
    bom: bom,
    cuttingTimeTargets: cuttingTimeTargets,
    bendingSequence: modelForm.bendingSequence,
    bendingTimeTargets: bendingTimeTargets,
    assemblyTimeTarget: modelForm.assemblyTimeTarget,
    fittingTimeTarget: modelForm.fittingTimeTarget
  }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    renderModelSettingsView();
  }).catch(showFatalError);
}
