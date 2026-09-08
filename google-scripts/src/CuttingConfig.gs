function listCuttingConfigModels() {
  var seen = {};
  var names = [];
  getAllRows('CuttingConfig').forEach(function (r) {
    var name = String(r.ModelName);
    if (!seen[name]) {
      seen[name] = true;
      names.push(name);
    }
  });
  return names;
}

function listCuttingConfigPlans(modelName) {
  return getAllRows('CuttingConfig')
    .filter(function (r) { return String(r.ModelName) === String(modelName); })
    .map(function (r) { return String(r.PlanName); });
}

function findPlanRow(modelName, planName) {
  var rows = getAllRows('CuttingConfig');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].ModelName) === String(modelName) && String(rows[i].PlanName) === String(planName)) {
      return rows[i];
    }
  }
  return null;
}

function getCuttingConfigPlan(modelName, planName) {
  var row = findPlanRow(modelName, planName);
  if (!row) {
    throw new Error('Plan not found: ' + modelName + ' / ' + planName);
  }
  return {
    modelName: String(row.ModelName),
    planName: String(row.PlanName),
    partsPerUnit: parseJsonSafe(row.PartsPerUnit, {}),
    sheets: parseJsonSafe(row.Sheets, [])
  };
}

function createCuttingConfigModel(payload) {
  var name = (payload.modelName || '').trim();
  if (!name) {
    throw new Error('Model name is required');
  }
  var already = getAllRows('CuttingConfig').some(function (r) { return String(r.ModelName) === name; });
  if (already) {
    throw new Error('A model named "' + name + '" already exists');
  }
  var planName = 'Plan 1';
  appendRow('CuttingConfig', {
    ModelName: name,
    PlanName: planName,
    PartsPerUnit: JSON.stringify({}),
    Sheets: JSON.stringify([]),
    UpdatedAt: nowIso()
  });
  return { modelName: name, planName: planName };
}

function createCuttingConfigPlan(payload) {
  var modelName = payload.modelName;
  var planName = (payload.planName || '').trim();
  if (!planName) {
    throw new Error('Plan name is required');
  }
  var modelExists = getAllRows('CuttingConfig').some(function (r) { return String(r.ModelName) === String(modelName); });
  if (!modelExists) {
    throw new Error('Model not found: ' + modelName);
  }
  if (findPlanRow(modelName, planName)) {
    throw new Error('A plan named "' + planName + '" already exists for this model');
  }
  appendRow('CuttingConfig', {
    ModelName: modelName,
    PlanName: planName,
    PartsPerUnit: JSON.stringify({}),
    Sheets: JSON.stringify([]),
    UpdatedAt: nowIso()
  });
  return { modelName: modelName, planName: planName };
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

function deleteCuttingConfigPlan(payload) {
  var modelName = payload.modelName;
  var planName = payload.planName;
  var planCount = getAllRows('CuttingConfig').filter(function (r) {
    return String(r.ModelName) === String(modelName);
  }).length;
  if (planCount <= 1) {
    throw new Error('Cannot delete the only plan for this model - delete the model instead');
  }
  var deletedCount = deleteRowsWhere('CuttingConfig', function (r) {
    return String(r.ModelName) === String(modelName) && String(r.PlanName) === String(planName);
  });
  if (!deletedCount) {
    throw new Error('Plan not found: ' + planName);
  }
  return { modelName: modelName, planName: planName };
}

function saveCuttingConfigPlan(payload) {
  var row = findPlanRow(payload.modelName, payload.planName);
  if (!row) {
    throw new Error('Plan not found: ' + payload.modelName + ' / ' + payload.planName);
  }
  writeRowUpdates('CuttingConfig', row._rowIndex, {
    PartsPerUnit: JSON.stringify(payload.partsPerUnit || {}),
    Sheets: JSON.stringify(payload.sheets || []),
    UpdatedAt: nowIso()
  });
  return { modelName: payload.modelName, planName: payload.planName };
}
