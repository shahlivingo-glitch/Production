// Raw-sheet stock: on-hand count per unique sheet size (W x H x T).
// Identified by size only (locked with the user). Qty is a running total and
// MAY go negative - a PO short on stock still gets created, it just shows a
// warning. Stock is deducted at actual cut time (when a sheet-type is marked
// done in Cutting Stage), never at PO creation.

function sheetSizeKey(width, height, thickness) {
  var w = Number(width) || 0;
  var h = Number(height) || 0;
  var t = Number(thickness) || 0;
  return w + 'x' + h + 'x' + t;
}

function sheetStockRowToObject(r) {
  return {
    size: String(r.Size),
    width: Number(r.Width) || 0,
    height: Number(r.Height) || 0,
    thickness: Number(r.Thickness) || 0,
    qty: Number(r.Qty) || 0,
    updatedAt: r.UpdatedAt
  };
}

function listSheetStock() {
  return getAllRows('SheetStock')
    .map(sheetStockRowToObject)
    .sort(function (a, b) { return a.size < b.size ? -1 : (a.size > b.size ? 1 : 0); });
}

function getSheetStockMap() {
  var map = {};
  getAllRows('SheetStock').forEach(function (r) {
    map[String(r.Size)] = Number(r.Qty) || 0;
  });
  return map;
}

// Core mutation: shift a size's on-hand qty by delta and append an audit row.
// delta < 0 consumes, delta > 0 receives. Creates the SheetStock row if the
// size is new. width/height/thickness are only needed when the row might not
// exist yet (receive / adjust); cut-time deductions pass them from the sheet.
function applySheetStockDelta(width, height, thickness, delta, reason, poNumber, note) {
  var key = sheetSizeKey(width, height, thickness);
  var matchFn = function (r) { return String(r.Size) === key; };
  var existing = findRow('SheetStock', matchFn);
  var newQty;
  if (existing) {
    newQty = (Number(existing.Qty) || 0) + delta;
    updateRow('SheetStock', matchFn, { Qty: newQty, UpdatedAt: nowIso() });
  } else {
    newQty = delta;
    appendRow('SheetStock', {
      Size: key,
      Width: Number(width) || 0,
      Height: Number(height) || 0,
      Thickness: Number(thickness) || 0,
      Qty: newQty,
      UpdatedAt: nowIso()
    });
  }
  appendRow('SheetStockLog', {
    LogId: generateId('SL'),
    Size: key,
    Delta: delta,
    Reason: reason,
    PoNumber: poNumber || '',
    Timestamp: nowIso(),
    Note: note || ''
  });
  return newQty;
}

function receiveSheetStock(payload) {
  var qty = Number(payload.qty) || 0;
  if (qty <= 0) {
    throw new Error('Receive qty must be greater than 0');
  }
  if (!(Number(payload.width) > 0) || !(Number(payload.height) > 0)) {
    throw new Error('Sheet width and height are required');
  }
  var newQty = applySheetStockDelta(
    payload.width, payload.height, payload.thickness,
    qty, 'received', '', payload.note || ''
  );
  return { size: sheetSizeKey(payload.width, payload.height, payload.thickness), qty: newQty };
}

function adjustSheetStock(payload) {
  var delta = Number(payload.qty) || 0;
  if (delta === 0) {
    throw new Error('Adjustment qty cannot be 0');
  }
  if (!(Number(payload.width) > 0) || !(Number(payload.height) > 0)) {
    throw new Error('Sheet width and height are required');
  }
  var newQty = applySheetStockDelta(
    payload.width, payload.height, payload.thickness,
    delta, 'adjustment', '', payload.note || ''
  );
  return { size: sheetSizeKey(payload.width, payload.height, payload.thickness), qty: newQty };
}

function listSheetStockLog(limit) {
  var rows = getAllRows('SheetStockLog').map(function (r) {
    return {
      logId: String(r.LogId),
      size: String(r.Size),
      delta: Number(r.Delta) || 0,
      reason: r.Reason,
      poNumber: r.PoNumber || '',
      timestamp: r.Timestamp,
      note: r.Note || ''
    };
  }).sort(function (a, b) { return a.timestamp < b.timestamp ? 1 : -1; });
  var n = Number(limit) || 50;
  return rows.slice(0, n);
}
