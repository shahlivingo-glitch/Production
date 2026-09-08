var models = [];
var selectedModel = null;
var configState = null;

function initCuttingConfig() {
  loadModels();
}

function loadModels() {
  apiGet('cuttingConfigModels', {}).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    models = result.data;
    renderModelList();
  }).catch(showFatalError);
}

function renderModelList() {
  var wrap = el('model-list');
  wrap.innerHTML = '';

  if (models.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No models yet.';
    wrap.appendChild(empty);
    return;
  }

  models.forEach(function (name) {
    var row = document.createElement('div');
    row.className = 'model-row' + (name === selectedModel ? ' selected' : '');

    var label = document.createElement('div');
    label.className = 'model-row-name';
    label.textContent = name;
    label.addEventListener('click', function () { selectModel(name); });

    var deleteBtn = document.createElement('button');
    deleteBtn.className = 'icon-btn';
    deleteBtn.textContent = '×';
    deleteBtn.title = 'Delete model';
    deleteBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      deleteModel(name);
    });

    row.appendChild(label);
    row.appendChild(deleteBtn);
    row.addEventListener('click', function () { selectModel(name); });
    wrap.appendChild(row);
  });
}

function addModel() {
  var input = el('new-model-name');
  var name = input.value.trim();
  if (!name) {
    alert('Enter a model name.');
    return;
  }
  apiPost('createCuttingConfigModel', { modelName: name }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    input.value = '';
    loadModels();
    selectModel(name);
  }).catch(showFatalError);
}

function deleteModel(name) {
  if (!confirm('Delete model "' + name + '"? This cannot be undone.')) return;
  apiPost('deleteCuttingConfigModel', { modelName: name }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    if (selectedModel === name) {
      selectedModel = null;
      configState = null;
      renderPartsColumn();
      renderSheetsColumn();
    }
    loadModels();
  }).catch(showFatalError);
}

function selectModel(name) {
  apiGet('cuttingConfigModel', { modelName: name }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    selectedModel = name;
    var data = result.data;
    configState = {
      modelName: data.modelName,
      parts: Object.keys(data.partsPerUnit).map(function (partName) {
        return { name: partName, total: Number(data.partsPerUnit[partName]) || 0 };
      }),
      sheets: (data.sheets || []).map(function (s) {
        return {
          width: s.width !== undefined ? s.width : '',
          height: s.height !== undefined ? s.height : '',
          thickness: s.thickness !== undefined ? s.thickness : '',
          outputs: (s.outputs || []).map(function (o) {
            return { partName: o.partName || '', qty: o.qty !== undefined ? o.qty : '' };
          })
        };
      })
    };
    renderModelList();
    renderPartsColumn();
    renderSheetsColumn();
  }).catch(showFatalError);
}

function getAssignedQty(partName) {
  if (!configState) return 0;
  var total = 0;
  configState.sheets.forEach(function (sheet) {
    sheet.outputs.forEach(function (o) {
      if (o.partName === partName) {
        total += Number(o.qty) || 0;
      }
    });
  });
  return total;
}

function getRemainingQty(partName) {
  var part = configState.parts.filter(function (p) { return p.name === partName; })[0];
  if (!part) return 0;
  return part.total - getAssignedQty(partName);
}

function getAvailablePartNames() {
  return configState.parts
    .filter(function (p) { return getRemainingQty(p.name) > 0; })
    .map(function (p) { return p.name; });
}

function setSaveStatus(text, cls) {
  ['parts-save-status', 'sheets-save-status'].forEach(function (id) {
    var span = el(id);
    span.textContent = text;
    span.className = 'save-status' + (cls ? ' ' + cls : '');
  });
}

function saveModel() {
  setSaveStatus('Saving…', 'saving');
  var partsPerUnit = {};
  configState.parts.forEach(function (p) { partsPerUnit[p.name] = p.total; });
  var sheets = configState.sheets.map(function (s) {
    return {
      width: Number(s.width) || 0,
      height: Number(s.height) || 0,
      thickness: Number(s.thickness) || 0,
      outputs: s.outputs.map(function (o) {
        return { partName: o.partName, qty: Number(o.qty) || 0 };
      })
    };
  });
  apiPost('saveCuttingConfigModel', {
    modelName: configState.modelName,
    partsPerUnit: partsPerUnit,
    sheets: sheets
  }).then(function (result) {
    if (!result.ok) {
      setSaveStatus('Save failed: ' + result.error, 'error');
      return;
    }
    setSaveStatus('Saved', '');
  }).catch(function (err) {
    setSaveStatus('Save failed', 'error');
  });
}

function renderPartsColumn() {
  var body = el('parts-body');
  body.innerHTML = '';

  if (!configState) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Select a model.';
    body.appendChild(empty);
    return;
  }

  var hint = document.createElement('div');
  hint.className = 'section-hint';
  hint.textContent = 'Shows remaining qty still needing a sheet assignment. Fully assigned parts drop off this list.';
  body.appendChild(hint);

  var visibleParts = configState.parts.filter(function (p) { return getRemainingQty(p.name) > 0; });

  if (visibleParts.length === 0) {
    var noneLeft = document.createElement('div');
    noneLeft.className = 'empty-state';
    noneLeft.textContent = configState.parts.length ? 'All parts fully assigned to sheets.' : 'No parts added yet.';
    body.appendChild(noneLeft);
  }

  visibleParts.forEach(function (part) {
    var index = configState.parts.indexOf(part);
    var row = document.createElement('div');
    row.className = 'part-row';

    var name = document.createElement('div');
    name.className = 'part-row-name';
    name.textContent = part.name;

    var qtyInput = document.createElement('input');
    qtyInput.type = 'number';
    qtyInput.value = getRemainingQty(part.name);
    qtyInput.addEventListener('change', function (e) {
      var typed = Number(e.target.value) || 0;
      configState.parts[index].total = getAssignedQty(part.name) + typed;
      renderPartsColumn();
      renderSheetsColumn();
      saveModel();
    });

    var removeBtn = document.createElement('button');
    removeBtn.className = 'icon-btn';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove part';
    removeBtn.addEventListener('click', function () { removePart(index); });

    row.appendChild(name);
    row.appendChild(qtyInput);
    row.appendChild(removeBtn);
    body.appendChild(row);
  });

  var addRow = document.createElement('div');
  addRow.className = 'add-row';
  addRow.style.marginTop = '12px';

  var nameInput = document.createElement('input');
  nameInput.placeholder = 'Part name';
  nameInput.id = 'new-part-name';

  var qtyInput2 = document.createElement('input');
  qtyInput2.type = 'number';
  qtyInput2.placeholder = 'Qty';
  qtyInput2.id = 'new-part-qty';
  qtyInput2.style.width = '70px';

  var addBtn = document.createElement('button');
  addBtn.className = 'btn-primary';
  addBtn.textContent = '+ Add';
  addBtn.addEventListener('click', addPart);

  addRow.appendChild(nameInput);
  addRow.appendChild(qtyInput2);
  addRow.appendChild(addBtn);
  body.appendChild(addRow);
}

function addPart() {
  var nameInput = el('new-part-name');
  var qtyInput = el('new-part-qty');
  var name = nameInput.value.trim();
  var qty = Number(qtyInput.value) || 0;

  if (!name) {
    alert('Enter a part name.');
    return;
  }
  if (qty <= 0) {
    alert('Enter a qty greater than 0.');
    return;
  }
  if (configState.parts.some(function (p) { return p.name === name; })) {
    alert('Part "' + name + '" already exists for this model.');
    return;
  }

  configState.parts.push({ name: name, total: qty });
  renderPartsColumn();
  renderSheetsColumn();
  saveModel();
}

function removePart(index) {
  var part = configState.parts[index];
  var assigned = getAssignedQty(part.name);

  if (assigned > 0) {
    var usedIn = 0;
    configState.sheets.forEach(function (sheet) {
      sheet.outputs.forEach(function (o) { if (o.partName === part.name) usedIn++; });
    });
    if (!confirm('"' + part.name + '" is used in ' + usedIn + ' sheet output row(s). Removing it will also delete those rows. Continue?')) {
      return;
    }
  }

  configState.sheets.forEach(function (sheet) {
    sheet.outputs = sheet.outputs.filter(function (o) { return o.partName !== part.name; });
  });
  configState.parts.splice(index, 1);

  renderPartsColumn();
  renderSheetsColumn();
  saveModel();
}

function renderSheetsColumn() {
  var body = el('sheets-body');
  body.innerHTML = '';

  if (!configState) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Select a model.';
    body.appendChild(empty);
    return;
  }

  configState.sheets.forEach(function (sheet, sheetIndex) {
    body.appendChild(buildSheetCard(sheet, sheetIndex));
  });

  var addSheetBtn = document.createElement('button');
  addSheetBtn.className = 'btn-secondary btn-block';
  addSheetBtn.textContent = '+ Add Sheet';
  addSheetBtn.addEventListener('click', addSheet);
  body.appendChild(addSheetBtn);
}

function buildSheetCard(sheet, sheetIndex) {
  var card = document.createElement('div');
  card.className = 'sheet-card';

  var header = document.createElement('div');
  header.className = 'sheet-header';
  var title = document.createElement('div');
  title.className = 'sheet-title';
  title.textContent = 'Sheet ' + (sheetIndex + 1);
  var removeSheetBtn = document.createElement('button');
  removeSheetBtn.className = 'icon-btn';
  removeSheetBtn.textContent = '×';
  removeSheetBtn.title = 'Remove sheet';
  removeSheetBtn.addEventListener('click', function () { removeSheet(sheetIndex); });
  header.appendChild(title);
  header.appendChild(removeSheetBtn);
  card.appendChild(header);

  var dims = document.createElement('div');
  dims.className = 'sheet-dims';
  dims.appendChild(buildDimField('W', sheet.width, function (v) {
    configState.sheets[sheetIndex].width = v;
  }));
  dims.appendChild(buildDimField('H', sheet.height, function (v) {
    configState.sheets[sheetIndex].height = v;
  }));
  dims.appendChild(buildDimField('T', sheet.thickness, function (v) {
    configState.sheets[sheetIndex].thickness = v;
  }));
  card.appendChild(dims);

  sheet.outputs.forEach(function (output, outputIndex) {
    card.appendChild(buildOutputRow(sheet, sheetIndex, output, outputIndex));
  });

  var addOutputBtn = document.createElement('button');
  addOutputBtn.className = 'btn-secondary';
  addOutputBtn.textContent = '+ Add Part Output';
  addOutputBtn.addEventListener('click', function () { addOutputRow(sheetIndex); });
  card.appendChild(addOutputBtn);

  return card;
}

function buildDimField(labelText, value, onChange) {
  var wrap = document.createElement('span');
  var label = document.createElement('span');
  label.className = 'sheet-dims-label';
  label.textContent = labelText;
  var input = document.createElement('input');
  input.type = 'number';
  input.value = value;
  input.addEventListener('input', function (e) { onChange(e.target.value); });
  input.addEventListener('change', function () { saveModel(); });
  wrap.appendChild(label);
  wrap.appendChild(input);
  return wrap;
}

function buildOutputRow(sheet, sheetIndex, output, outputIndex) {
  var row = document.createElement('div');
  row.className = 'output-row';

  var select = document.createElement('select');
  var available = getAvailablePartNames();
  if (output.partName && available.indexOf(output.partName) === -1) {
    available = [output.partName].concat(available);
  }

  var placeholderOpt = document.createElement('option');
  placeholderOpt.value = '';
  placeholderOpt.textContent = available.length
    ? '-- choose part --'
    : (configState.parts.length ? '-- all parts fully assigned --' : '-- add parts in column 2 first --');
  select.appendChild(placeholderOpt);

  available.forEach(function (partName) {
    var opt = document.createElement('option');
    opt.value = partName;
    opt.textContent = partName;
    select.appendChild(opt);
  });
  select.value = output.partName || '';
  select.addEventListener('change', function (e) {
    configState.sheets[sheetIndex].outputs[outputIndex].partName = e.target.value;
    renderPartsColumn();
    renderSheetsColumn();
    saveModel();
  });

  var qtyInput = document.createElement('input');
  qtyInput.type = 'number';
  qtyInput.placeholder = 'Qty';
  qtyInput.value = output.qty;
  qtyInput.addEventListener('input', function (e) {
    configState.sheets[sheetIndex].outputs[outputIndex].qty = e.target.value;
  });
  qtyInput.addEventListener('change', function () {
    renderPartsColumn();
    renderSheetsColumn();
    saveModel();
  });

  var removeBtn = document.createElement('button');
  removeBtn.className = 'icon-btn';
  removeBtn.textContent = '×';
  removeBtn.title = 'Remove output row';
  removeBtn.addEventListener('click', function () { removeOutputRow(sheetIndex, outputIndex); });

  row.appendChild(select);
  row.appendChild(qtyInput);
  row.appendChild(removeBtn);
  return row;
}

function addSheet() {
  configState.sheets.push({ width: '', height: '', thickness: '', outputs: [] });
  renderSheetsColumn();
  saveModel();
}

function removeSheet(sheetIndex) {
  configState.sheets.splice(sheetIndex, 1);
  renderPartsColumn();
  renderSheetsColumn();
  saveModel();
}

function addOutputRow(sheetIndex) {
  configState.sheets[sheetIndex].outputs.push({ partName: '', qty: '' });
  renderSheetsColumn();
  saveModel();
}

function removeOutputRow(sheetIndex, outputIndex) {
  configState.sheets[sheetIndex].outputs.splice(outputIndex, 1);
  renderPartsColumn();
  renderSheetsColumn();
  saveModel();
}

document.addEventListener('DOMContentLoaded', function () {
  el('add-model-btn').addEventListener('click', addModel);
  el('new-model-name').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') addModel();
  });
  renderPartsColumn();
  renderSheetsColumn();
});
