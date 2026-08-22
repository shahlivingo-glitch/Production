var SETUP_TIME_COLUMN_BY_STAGE = {
  cutting: 'CuttingSetupTime',
  bending: 'BendingSetupTime',
  assembly: 'AssemblySetupTime',
  fitting: 'FittingSetupTime'
};

function getSetupTime(stage) {
  var rows = getAllRows('AppSettings');
  var row = rows[0];
  if (!row) {
    return 0;
  }
  var column = SETUP_TIME_COLUMN_BY_STAGE[stage];
  return column ? Number(row[column]) || 0 : 0;
}

function getAppSettings(userId) {
  requirePermission(userId, 'settings');
  var rows = getAllRows('AppSettings');
  var row = rows[0];
  return {
    cuttingSetupTime: row ? Number(row.CuttingSetupTime) || 0 : 0,
    bendingSetupTime: row ? Number(row.BendingSetupTime) || 0 : 0,
    assemblySetupTime: row ? Number(row.AssemblySetupTime) || 0 : 0,
    fittingSetupTime: row ? Number(row.FittingSetupTime) || 0 : 0
  };
}

function saveAppSettings(payload) {
  requirePermission(payload.userId, 'settings');

  var updates = {
    CuttingSetupTime: Number(payload.cuttingSetupTime) || 0,
    BendingSetupTime: Number(payload.bendingSetupTime) || 0,
    AssemblySetupTime: Number(payload.assemblySetupTime) || 0,
    FittingSetupTime: Number(payload.fittingSetupTime) || 0,
    UpdatedAt: nowIso(),
    UpdatedBy: payload.userId
  };

  var rows = getAllRows('AppSettings');
  if (rows.length > 0) {
    writeRowUpdates('AppSettings', rows[0]._rowIndex, updates);
  } else {
    appendRow('AppSettings', updates);
  }

  return getAppSettings(payload.userId);
}
