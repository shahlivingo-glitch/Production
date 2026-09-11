function listCuttingConfigModels() {
  return getAllRows('Models').map(function (r) { return String(r.ModelName); });
}

function getModelParts(modelName) {
  var row = findRowById('Models', 'ModelName', modelName);
  if (!row) {
    throw new Error('Model not found: ' + modelName);
  }
  return {
    modelName: String(row.ModelName),
    partsPerUnit: parseJsonSafe(row.PartsPerUnit, {})
  };
}

function saveModelParts(payload) {
  var row = findRowById('Models', 'ModelName', payload.modelName);
  if (!row) {
    throw new Error('Model not found: ' + payload.modelName);
  }
  writeRowUpdates('Models', row._rowIndex, {
    PartsPerUnit: JSON.stringify(payload.partsPerUnit || {}),
    UpdatedAt: nowIso()
  });
  return { modelName: payload.modelName };
}

function removeCuttingConfigPart(payload) {
  var modelName = payload.modelName;
  var partName = payload.partName;

  var modelRow = findRowById('Models', 'ModelName', modelName);
  if (!modelRow) {
    throw new Error('Model not found: ' + modelName);
  }
  var parts = parseJsonSafe(modelRow.PartsPerUnit, {});
  delete parts[partName];
  writeRowUpdates('Models', modelRow._rowIndex, {
    PartsPerUnit: JSON.stringify(parts),
    UpdatedAt: nowIso()
  });

  var planRows = findRows('CuttingPlans', function (r) {
    return String(r.ModelName) === String(modelName);
  });
  planRows.forEach(function (row) {
    var sheets = parseJsonSafe(row.Sheets, []);
    var changed = false;
    sheets.forEach(function (sheet) {
      var before = sheet.outputs.length;
      sheet.outputs = sheet.outputs.filter(function (o) { return o.partName !== partName; });
      if (sheet.outputs.length !== before) {
        changed = true;
      }
    });
    if (changed) {
      writeRowUpdates('CuttingPlans', row._rowIndex, {
        Sheets: JSON.stringify(sheets),
        UpdatedAt: nowIso()
      });
    }
  });

  return { modelName: modelName, partsPerUnit: parts };
}

function createCuttingConfigModel(payload) {
  var name = (payload.modelName || '').trim();
  if (!name) {
    throw new Error('Model name is required');
  }
  if (findRowById('Models', 'ModelName', name)) {
    throw new Error('A model named "' + name + '" already exists');
  }
  appendRow('Models', {
    ModelName: name,
    PartsPerUnit: JSON.stringify({}),
    UpdatedAt: nowIso()
  });
  var planName = 'Plan 1';
  appendRow('CuttingPlans', {
    ModelName: name,
    PlanName: planName,
    Sheets: JSON.stringify([]),
    UpdatedAt: nowIso()
  });
  return { modelName: name, planName: planName };
}

function deleteCuttingConfigModel(payload) {
  var name = payload.modelName;
  var deletedModelCount = deleteRowsWhere('Models', function (r) {
    return String(r.ModelName) === String(name);
  });
  deleteRowsWhere('CuttingPlans', function (r) {
    return String(r.ModelName) === String(name);
  });
  if (!deletedModelCount) {
    throw new Error('Model not found: ' + name);
  }
  return { modelName: name };
}

function listCuttingConfigPlans(modelName) {
  return getAllRows('CuttingPlans')
    .filter(function (r) { return String(r.ModelName) === String(modelName); })
    .map(function (r) {
      return {
        planName: String(r.PlanName),
        planType: r.PlanType === 'bulk' ? 'bulk' : 'per-unit',
        baseQty: Number(r.BaseQty) || 0
      };
    });
}

function findPlanRow(modelName, planName) {
  var rows = getAllRows('CuttingPlans');
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
    sheets: parseJsonSafe(row.Sheets, []),
    planType: row.PlanType === 'bulk' ? 'bulk' : 'per-unit',
    baseQty: Number(row.BaseQty) || 0
  };
}

function createCuttingConfigPlan(payload) {
  var modelName = payload.modelName;
  var planName = (payload.planName || '').trim();
  if (!planName) {
    throw new Error('Plan name is required');
  }
  if (!findRowById('Models', 'ModelName', modelName)) {
    throw new Error('Model not found: ' + modelName);
  }
  if (findPlanRow(modelName, planName)) {
    throw new Error('A plan named "' + planName + '" already exists for this model');
  }
  appendRow('CuttingPlans', {
    ModelName: modelName,
    PlanName: planName,
    Sheets: JSON.stringify([]),
    UpdatedAt: nowIso()
  });
  return { modelName: modelName, planName: planName };
}

function deleteCuttingConfigPlan(payload) {
  var modelName = payload.modelName;
  var planName = payload.planName;
  var planCount = getAllRows('CuttingPlans').filter(function (r) {
    return String(r.ModelName) === String(modelName);
  }).length;
  if (planCount <= 1) {
    throw new Error('Cannot delete the only plan for this model - delete the model instead');
  }
  var deletedCount = deleteRowsWhere('CuttingPlans', function (r) {
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
  var planType = payload.planType === 'bulk' ? 'bulk' : 'per-unit';
  var baseQty = Number(payload.baseQty) || 0;
  if (planType === 'bulk' && baseQty < 1) {
    throw new Error('Base Qty must be at least 1 for a Bulk plan');
  }
  writeRowUpdates('CuttingPlans', row._rowIndex, {
    Sheets: JSON.stringify(payload.sheets || []),
    UpdatedAt: nowIso(),
    PlanType: planType,
    BaseQty: planType === 'bulk' ? baseQty : 0
  });
  return { modelName: payload.modelName, planName: payload.planName };
}
