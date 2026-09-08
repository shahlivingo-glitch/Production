function planVersionRowToObject(r) {
  return {
    versionId: String(r.VersionId),
    modelName: String(r.ModelName),
    versionNumber: Number(r.VersionNumber) || 0,
    sourcePlanName: String(r.SourcePlanName),
    sheets: parseJsonSafe(r.Sheets, []),
    createdAt: r.CreatedAt,
    note: r.Note || ''
  };
}

function listPlanVersionsForModel(modelName) {
  return getAllRows('PlanVersions')
    .filter(function (r) { return String(r.ModelName) === String(modelName); })
    .map(function (r) {
      return {
        versionId: String(r.VersionId),
        modelName: String(r.ModelName),
        versionNumber: Number(r.VersionNumber) || 0,
        sourcePlanName: String(r.SourcePlanName),
        sheetCount: parseJsonSafe(r.Sheets, []).length,
        createdAt: r.CreatedAt,
        note: r.Note || ''
      };
    })
    .sort(function (a, b) { return a.versionNumber - b.versionNumber; });
}

function getPlanVersion(versionId) {
  var row = findRowById('PlanVersions', 'VersionId', versionId);
  if (!row) {
    throw new Error('Plan version not found: ' + versionId);
  }
  return planVersionRowToObject(row);
}

function createPlanVersionRow(modelName, sourcePlanName, sheets, note) {
  var existingCount = getAllRows('PlanVersions').filter(function (r) {
    return String(r.ModelName) === String(modelName);
  }).length;
  var versionId = generateId('PV');
  appendRow('PlanVersions', {
    VersionId: versionId,
    ModelName: modelName,
    VersionNumber: existingCount + 1,
    SourcePlanName: sourcePlanName,
    Sheets: JSON.stringify(sheets),
    CreatedAt: nowIso(),
    Note: note || ''
  });
  return versionId;
}

function getActivePlanVersionForOrder(payload) {
  var order = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!order) {
    throw new Error('PO not found: ' + payload.poNumber);
  }

  if (order.PlanVersionId) {
    return getPlanVersion(order.PlanVersionId);
  }

  var plan = findPlanRow(order.ModelName, order.PlanName);
  var sheets = plan ? parseJsonSafe(plan.Sheets, []) : [];
  var versionId = createPlanVersionRow(order.ModelName, order.PlanName, sheets, 'Initial snapshot for ' + payload.poNumber);
  writeRowUpdates('Orders', order._rowIndex, { PlanVersionId: versionId });
  return getPlanVersion(versionId);
}

function saveNewPlanVersion(payload) {
  var order = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!order) {
    throw new Error('PO not found: ' + payload.poNumber);
  }
  var versionId = createPlanVersionRow(
    order.ModelName,
    order.PlanName,
    payload.sheets || [],
    payload.note || ('Modified for ' + payload.poNumber)
  );
  writeRowUpdates('Orders', order._rowIndex, { PlanVersionId: versionId });
  return getPlanVersion(versionId);
}

function setActivePlanVersionForOrder(payload) {
  var order = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!order) {
    throw new Error('PO not found: ' + payload.poNumber);
  }
  var version = findRowById('PlanVersions', 'VersionId', payload.versionId);
  if (!version) {
    throw new Error('Plan version not found: ' + payload.versionId);
  }
  if (String(version.ModelName) !== String(order.ModelName)) {
    throw new Error('That plan version belongs to a different model');
  }
  writeRowUpdates('Orders', order._rowIndex, { PlanVersionId: payload.versionId });
  return getPlanVersion(payload.versionId);
}
