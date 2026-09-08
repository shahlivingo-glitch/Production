function listCuttingConfigModels() {
  return getAllRows('CuttingConfig').map(function (r) {
    return String(r.ModelName);
  });
}

function getCuttingConfigModel(modelName) {
  var row = findRowById('CuttingConfig', 'ModelName', modelName);
  if (!row) {
    throw new Error('Model not found: ' + modelName);
  }
  return {
    modelName: String(row.ModelName),
    partsPerUnit: parseJsonSafe(row.PartsPerUnit, {}),
    sheets: parseJsonSafe(row.Sheets, [])
  };
}

function createCuttingConfigModel(payload) {
  var name = (payload.modelName || '').trim();
  if (!name) {
    throw new Error('Model name is required');
  }
  var existing = findRowById('CuttingConfig', 'ModelName', name);
  if (existing) {
    throw new Error('A model named "' + name + '" already exists');
  }
  appendRow('CuttingConfig', {
    ModelName: name,
    PartsPerUnit: JSON.stringify({}),
    Sheets: JSON.stringify([]),
    UpdatedAt: nowIso()
  });
  return { modelName: name };
}

function deleteCuttingConfigModel(payload) {
  var name = payload.modelName;
  var deletedCount = deleteRowsWhere('CuttingConfig', function (r) {
    return String(r.ModelName) === String(name);
  });
  if (!deletedCount) {
    throw new Error('Model not found: ' + name);
  }
  return { modelName: name };
}

function saveCuttingConfigModel(payload) {
  var name = payload.modelName;
  var existing = findRowById('CuttingConfig', 'ModelName', name);
  if (!existing) {
    throw new Error('Model not found: ' + name);
  }
  updateRowById('CuttingConfig', 'ModelName', name, {
    PartsPerUnit: JSON.stringify(payload.partsPerUnit || {}),
    Sheets: JSON.stringify(payload.sheets || []),
    UpdatedAt: nowIso()
  });
  return { modelName: name };
}
