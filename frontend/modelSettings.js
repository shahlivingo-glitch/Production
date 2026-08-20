var modelForm = null;

function emptyModelForm() {
  return {
    modelNoName: '',
    locked: false,
    sheetRows: [{ code: '', parts: '' }],
    bomRows: [{ item: '', qty: '' }],
    cuttingTimeTarget: '',
    bendingTimeTarget: '',
    assemblyTimeTarget: '',
    fittingTimeTarget: ''
  };
}

function modelToForm(m) {
  var sheetRows = m.sheetSequence.map(function (code) {
    return { code: code, parts: (m.partsPerSheet[code] || []).join(', ') };
  });
  if (sheetRows.length === 0) sheetRows.push({ code: '', parts: '' });

  var bomRows = Object.keys(m.bom).map(function (item) {
    return { item: item, qty: m.bom[item] };
  });
  if (bomRows.length === 0) bomRows.push({ item: '', qty: '' });

  return {
    modelNoName: m.modelNoName,
    locked: true,
    sheetRows: sheetRows,
    bomRows: bomRows,
    cuttingTimeTarget: m.cuttingTimeTarget,
    bendingTimeTarget: m.bendingTimeTarget,
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
      '<div class="muted">Cutting ' + m.cuttingTimeTarget + 'm · Bending ' + m.bendingTimeTarget + 'm · Assembly ' + m.assemblyTimeTarget + 'm · Fitting ' + m.fittingTimeTarget + 'm</div>';
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
  seqHint.textContent = 'Order matters — this is the fixed cut order. List the parts each sheet produces, comma-separated.';
  root.appendChild(seqHint);

  var seqWrap = document.createElement('div');
  root.appendChild(seqWrap);
  renderSheetRows(seqWrap);

  var addSheetBtn = document.createElement('button');
  addSheetBtn.className = 'btn btn-secondary add-row-btn';
  addSheetBtn.textContent = '+ Add Sheet';
  addSheetBtn.addEventListener('click', function () {
    modelForm.sheetRows.push({ code: '', parts: '' });
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

  var targetsTitle = document.createElement('div');
  targetsTitle.className = 'section-title';
  targetsTitle.textContent = 'Time Targets (minutes)';
  root.appendChild(targetsTitle);

  root.appendChild(buildNumberField('Cutting', modelForm.cuttingTimeTarget, function (v) { modelForm.cuttingTimeTarget = v; }));
  root.appendChild(buildNumberField('Bending', modelForm.bendingTimeTarget, function (v) { modelForm.bendingTimeTarget = v; }));
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
    codeInput.style.maxWidth = '110px';
    codeInput.addEventListener('input', function (e) { row.code = e.target.value; });

    var partsInput = document.createElement('input');
    partsInput.placeholder = 'Parts on this sheet, comma-separated';
    partsInput.value = row.parts;
    partsInput.addEventListener('input', function (e) { row.parts = e.target.value; });

    line.appendChild(codeInput);
    line.appendChild(partsInput);

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

function submitModelForm() {
  if (!modelForm.modelNoName || !modelForm.modelNoName.trim()) {
    alert('Model name is required.');
    return;
  }

  var sheetSequence = [];
  var partsPerSheet = {};
  modelForm.sheetRows.forEach(function (row) {
    var code = row.code.trim();
    if (!code) return;
    sheetSequence.push(code);
    partsPerSheet[code] = row.parts.split(',').map(function (p) { return p.trim(); }).filter(function (p) { return p; });
  });

  var bom = {};
  modelForm.bomRows.forEach(function (row) {
    var item = row.item.trim();
    if (!item) return;
    bom[item] = Number(row.qty) || 0;
  });

  apiPost('saveModel', {
    userId: currentSession.userId,
    modelNoName: modelForm.modelNoName.trim(),
    sheetSequence: sheetSequence,
    partsPerSheet: partsPerSheet,
    bom: bom,
    cuttingTimeTarget: modelForm.cuttingTimeTarget,
    bendingTimeTarget: modelForm.bendingTimeTarget,
    assemblyTimeTarget: modelForm.assemblyTimeTarget,
    fittingTimeTarget: modelForm.fittingTimeTarget
  }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    renderModelSettingsView();
  }).catch(showFatalError);
}
