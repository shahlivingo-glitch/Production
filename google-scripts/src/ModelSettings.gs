function modelRowToObject(m) {
  return {
    modelNoName: m.ModelNoName,
    sheetSequence: parseJsonSafe(m.SheetSequence, []),
    partsPerSheet: parseJsonSafe(m.PartsPerSheet, {}),
    bom: parseJsonSafe(m.BOM, {}),
    cuttingTimeTargets: parseJsonSafe(m.CuttingTimeTargets, {}),
    cuttingSetupTime: m.CuttingSetupTime,
    bendingSequence: parseJsonSafe(m.BendingSequence, []),
    bendingTimeTargets: parseJsonSafe(m.BendingTimeTargets, {}),
    bendingSetupTime: m.BendingSetupTime,
    assemblyTimeTarget: m.AssemblyTimeTarget,
    assemblySetupTime: m.AssemblySetupTime,
    fittingTimeTarget: m.FittingTimeTarget,
    fittingSetupTime: m.FittingSetupTime,
    updatedAt: m.UpdatedAt,
    updatedBy: m.UpdatedBy
  };
}

function listModels(userId) {
  requirePermission(userId, 'settings');
  return getAllRows('ModelSettings').map(modelRowToObject);
}

function getModel(userId, modelNoName) {
  requirePermission(userId, 'settings');
  var m = findRowById('ModelSettings', 'ModelNoName', modelNoName);
  if (!m) {
    throw new Error('Unknown model: ' + modelNoName);
  }
  return modelRowToObject(m);
}

function saveModel(payload) {
  requirePermission(payload.userId, 'settings');

  if (!payload.modelNoName) {
    throw new Error('Model name is required');
  }

  var row = {
    ModelNoName: payload.modelNoName,
    SheetSequence: JSON.stringify(payload.sheetSequence || []),
    PartsPerSheet: JSON.stringify(payload.partsPerSheet || {}),
    BOM: JSON.stringify(payload.bom || {}),
    CuttingTimeTargets: JSON.stringify(payload.cuttingTimeTargets || {}),
    CuttingSetupTime: Number(payload.cuttingSetupTime) || 0,
    BendingSequence: JSON.stringify(payload.bendingSequence || []),
    BendingTimeTargets: JSON.stringify(payload.bendingTimeTargets || {}),
    BendingSetupTime: Number(payload.bendingSetupTime) || 0,
    AssemblyTimeTarget: Number(payload.assemblyTimeTarget) || 0,
    AssemblySetupTime: Number(payload.assemblySetupTime) || 0,
    FittingTimeTarget: Number(payload.fittingTimeTarget) || 0,
    FittingSetupTime: Number(payload.fittingSetupTime) || 0,
    UpdatedAt: nowIso(),
    UpdatedBy: payload.userId
  };

  var existing = findRowById('ModelSettings', 'ModelNoName', payload.modelNoName);
  if (existing) {
    updateRowById('ModelSettings', 'ModelNoName', payload.modelNoName, row);
  } else {
    appendRow('ModelSettings', row);
  }

  return { modelNoName: payload.modelNoName };
}
