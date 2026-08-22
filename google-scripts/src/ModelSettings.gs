function modelRowToObject(m) {
  return {
    modelNoName: m.ModelNoName,
    sheetSequence: parseJsonSafe(m.SheetSequence, []),
    partsPerSheet: parseJsonSafe(m.PartsPerSheet, {}),
    bom: parseJsonSafe(m.BOM, {}),
    cuttingTimeTargets: parseJsonSafe(m.CuttingTimeTargets, {}),
    bendingSequence: parseJsonSafe(m.BendingSequence, []),
    bendingTimeTargets: parseJsonSafe(m.BendingTimeTargets, {}),
    assemblyTimeTarget: m.AssemblyTimeTarget,
    fittingTimeTarget: m.FittingTimeTarget,
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
    BendingSequence: JSON.stringify(payload.bendingSequence || []),
    BendingTimeTargets: JSON.stringify(payload.bendingTimeTargets || {}),
    AssemblyTimeTarget: Number(payload.assemblyTimeTarget) || 0,
    FittingTimeTarget: Number(payload.fittingTimeTarget) || 0,
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
