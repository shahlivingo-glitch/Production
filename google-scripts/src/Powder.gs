function findPersonalStockRow(operatorId, colour) {
  return findRow('PowderPersonalStock', function (r) {
    return r.OperatorID === operatorId && r.Colour === colour;
  });
}

function adjustPersonalStock(operatorId, colour, deltaKg) {
  var row = findPersonalStockRow(operatorId, colour);
  if (row) {
    updateRow('PowderPersonalStock', function (r) {
      return r.OperatorID === operatorId && r.Colour === colour;
    }, { CurrentKg: (Number(row.CurrentKg) || 0) + deltaKg });
  } else {
    appendRow('PowderPersonalStock', {
      OperatorID: operatorId,
      Colour: colour,
      CurrentKg: deltaKg,
      LastVerifiedKg: '',
      LastVerifiedBy: '',
      LastVerifiedAt: ''
    });
  }
}

function adjustMainStock(colour, deltaKg) {
  var row = findRowById('PowderMainStock', 'Colour', colour);
  if (row) {
    updateRowById('PowderMainStock', 'Colour', colour, { CurrentKg: (Number(row.CurrentKg) || 0) + deltaKg });
  } else {
    appendRow('PowderMainStock', { Colour: colour, CurrentKg: deltaKg, LastVerifiedKg: '', LastVerifiedBy: '', LastVerifiedAt: '' });
  }
}

function listPowderQueue(userId) {
  requirePermission(userId, 'powder');
  var orders = getOrdersById();
  return getAllRows('PowderQueue').filter(function (r) {
    return r.Status === 'pending' || (r.Status === 'in-progress' && r.OperatorID === userId);
  }).map(function (r) {
    return {
      queueId: r.QueueID,
      orderId: r.OrderID,
      modelNoName: r.ModelNoName,
      colour: r.Colour,
      qty: r.Qty,
      status: r.Status,
      customerName: orders[r.OrderID] ? orders[r.OrderID].CustomerName : ''
    };
  });
}

function getPowderStockSummary(userId) {
  requirePermission(userId, 'powder');
  return {
    mainStock: getAllRows('PowderMainStock').map(function (r) {
      return { colour: r.Colour, currentKg: r.CurrentKg };
    }),
    personalStock: getAllRows('PowderPersonalStock').filter(function (r) {
      return r.OperatorID === userId;
    }).map(function (r) {
      return { colour: r.Colour, currentKg: r.CurrentKg };
    })
  };
}

function startPowderBatch(payload) {
  requirePermission(payload.userId, 'powder');
  var row = findRowById('PowderQueue', 'QueueID', payload.queueId);
  if (!row) {
    throw new Error('Batch not found');
  }
  if (row.Status !== 'pending') {
    throw new Error('Batch is not pending');
  }

  var fromMain = Number(payload.fromMainStockKg) || 0;
  var fromPersonal = Number(payload.fromPersonalStockKg) || 0;

  adjustMainStock(row.Colour, -fromMain);
  adjustPersonalStock(payload.userId, row.Colour, -fromPersonal);

  updateRowById('PowderQueue', 'QueueID', payload.queueId, {
    Status: 'in-progress',
    StartedAt: nowIso(),
    OperatorID: payload.userId,
    FromMainStockKg: fromMain,
    FromPersonalStockKg: fromPersonal,
    ActualPowderKg: fromMain + fromPersonal
  });

  return { queueId: payload.queueId };
}

function completePowderBatch(payload) {
  requirePermission(payload.userId, 'powder');
  var row = findRowById('PowderQueue', 'QueueID', payload.queueId);
  if (!row) {
    throw new Error('Batch not found');
  }
  if (row.Status !== 'in-progress') {
    throw new Error('Batch is not in progress');
  }

  var leftoverKg = Number(payload.leftoverKg) || 0;

  updateRowById('PowderQueue', 'QueueID', payload.queueId, {
    Status: 'done',
    CompletedAt: nowIso(),
    LeftoverKg: leftoverKg
  });

  adjustPersonalStock(payload.userId, row.Colour, leftoverKg);

  return { queueId: payload.queueId, leftoverKg: leftoverKg };
}

function listAllPersonalStock(userId) {
  requirePermission(userId, 'settings');
  return getAllRows('PowderPersonalStock').map(function (r) {
    return { operatorId: r.OperatorID, colour: r.Colour, currentKg: r.CurrentKg, lastVerifiedAt: r.LastVerifiedAt };
  });
}

function verifyMainStock(payload) {
  requirePermission(payload.userId, 'settings');
  var colour = payload.colour;
  var verifiedKg = Number(payload.verifiedKg) || 0;

  var row = findRowById('PowderMainStock', 'Colour', colour);
  var updates = {
    CurrentKg: verifiedKg,
    LastVerifiedKg: verifiedKg,
    LastVerifiedBy: payload.userId,
    LastVerifiedAt: nowIso()
  };
  if (row) {
    updateRowById('PowderMainStock', 'Colour', colour, updates);
  } else {
    appendRow('PowderMainStock', Object.assign({ Colour: colour }, updates));
  }
  return { colour: colour, currentKg: verifiedKg };
}

function verifyPersonalStock(payload) {
  requirePermission(payload.userId, 'settings');
  var operatorId = payload.operatorId;
  var colour = payload.colour;
  var verifiedKg = Number(payload.verifiedKg) || 0;

  var row = findPersonalStockRow(operatorId, colour);
  var updates = {
    CurrentKg: verifiedKg,
    LastVerifiedKg: verifiedKg,
    LastVerifiedBy: payload.userId,
    LastVerifiedAt: nowIso()
  };
  if (row) {
    updateRow('PowderPersonalStock', function (r) {
      return r.OperatorID === operatorId && r.Colour === colour;
    }, updates);
  } else {
    appendRow('PowderPersonalStock', Object.assign({ OperatorID: operatorId, Colour: colour }, updates));
  }
  return { operatorId: operatorId, colour: colour, currentKg: verifiedKg };
}
