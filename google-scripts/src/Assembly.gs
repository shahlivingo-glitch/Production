// Assembly: the last stage, where bent parts become finished almirahs.
//
// Unlike Cutting and Bending this stage has no per-part detail at all. By
// the time a PO reaches here every part is bent, and what the assembler
// tracks is whole cabinets - so the entire stage is one number per PO.
//
// A PO only appears once BendingStatus is 'complete'. That is the app's own
// definition of "all parts bent", so the gate stays in step with Bending
// rather than inventing a second opinion about it.

function assemblyStatusFor(row) {
  var ordered = Number(row.Qty) || 0;
  var done = Number(row.AssembledQty) || 0;
  return (ordered > 0 && done >= ordered) ? 'complete' : 'pending';
}

// POs ready to assemble: bending finished, assembly not. Shortfalls are
// reported alongside rather than used to hide the PO - a part that was
// never cut cannot have been bent, so if Bending says complete while parts
// are still short, that is worth showing the assembler, not acting on
// silently behind their back.
function listPendingAssemblyOrders() {
  var result = [];
  getAllRows('Orders').forEach(function (r) {
    if ((r.BendingStatus || 'pending') !== 'complete') return;
    if (assemblyStatusFor(r) === 'complete') return;

    var ordered = Number(r.Qty) || 0;
    var done = Number(r.AssembledQty) || 0;
    result.push({
      poNumber: String(r.PoNumber),
      modelName: String(r.ModelName),
      qty: ordered,
      assembledQty: done,
      remaining: Math.max(0, ordered - done),
      partyName: r.PartyName || '',
      deliveryDeadline: r.DeliveryDeadline || '',
      createdAt: r.CreatedAt
    });
  });
  return result;
}

function getAssemblyForOrder(poNumber) {
  var row = findRowById('Orders', 'PoNumber', poNumber);
  if (!row) {
    throw new Error('PO not found: ' + poNumber);
  }
  var ordered = Number(row.Qty) || 0;
  var done = Number(row.AssembledQty) || 0;

  // Surfaced, not enforced: parts the plan never produced. Bending can read
  // complete while these are outstanding, and the assembler is the person
  // who will discover it physically - better they see it on the screen.
  var shortfalls = [];
  try {
    var queue = getBendingQueueForOrder(poNumber);
    shortfalls = queue.stillToCut || [];
  } catch (err) {
    // bending data unavailable - assembly can still be recorded
  }

  return {
    poNumber: String(row.PoNumber),
    modelName: String(row.ModelName),
    qty: ordered,
    assembledQty: done,
    remaining: Math.max(0, ordered - done),
    partyName: row.PartyName || '',
    dxfRefNo: row.DxfRefNo || '',
    colourPlan: row.ColourPlan || '',
    deliveryDeadline: row.DeliveryDeadline || '',
    createdAt: row.CreatedAt,
    bendingStatus: row.BendingStatus || 'pending',
    assemblyStatus: assemblyStatusFor(row),
    assemblyMeta: parseJsonSafe(row.AssemblyMeta, []),
    stillToCut: shortfalls
  };
}

// Records almirahs assembled. Additive, because assembly happens over days
// and the natural thing to type is "I did 8 more today", not a running
// total the assembler has to work out themselves.
//
// Caps at the order quantity rather than refusing an overshoot: typing 10
// when 8 remain means "that's the lot", and failing it would be pedantry on
// the shop floor. Reaching the total completes the PO.
function addAssemblyProgress(payload) {
  var row = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!row) {
    throw new Error('PO not found: ' + payload.poNumber);
  }
  if ((row.BendingStatus || 'pending') !== 'complete') {
    throw new Error('Bending is not finished for this PO yet.');
  }
  var qty = Number(payload.qty);
  if (!(qty > 0)) {
    throw new Error('Enter how many almirahs were assembled.');
  }

  var ordered = Number(row.Qty) || 0;
  var done = Number(row.AssembledQty) || 0;
  if (done >= ordered) {
    throw new Error('This PO is already fully assembled.');
  }
  var next = Math.min(ordered, done + qty);

  var meta = parseJsonSafe(row.AssemblyMeta, []);
  meta.push({ qty: next - done, at: nowIso(), by: resolveActorName(payload.token) });

  writeRowUpdates('Orders', row._rowIndex, {
    AssembledQty: next,
    AssemblyMeta: JSON.stringify(meta),
    AssemblyStatus: (next >= ordered) ? 'complete' : 'pending'
  });
  return getAssemblyForOrder(payload.poNumber);
}

// "Assemble done" for the whole remainder in one click - the common case
// where the PO is finished in a single session.
function markAssemblyComplete(payload) {
  var row = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!row) {
    throw new Error('PO not found: ' + payload.poNumber);
  }
  if ((row.BendingStatus || 'pending') !== 'complete') {
    throw new Error('Bending is not finished for this PO yet.');
  }
  var ordered = Number(row.Qty) || 0;
  var done = Number(row.AssembledQty) || 0;
  if (done >= ordered) {
    throw new Error('This PO is already fully assembled.');
  }

  var meta = parseJsonSafe(row.AssemblyMeta, []);
  meta.push({ qty: ordered - done, at: nowIso(), by: resolveActorName(payload.token) });

  writeRowUpdates('Orders', row._rowIndex, {
    AssembledQty: ordered,
    AssemblyMeta: JSON.stringify(meta),
    AssemblyStatus: 'complete'
  });
  return getAssemblyForOrder(payload.poNumber);
}

// Undo, admin-only: assembly completion is what takes a PO off the floor,
// so a mistyped quantity needs a way back without editing the Sheet.
function resetAssemblyProgress(payload) {
  var row = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!row) {
    throw new Error('PO not found: ' + payload.poNumber);
  }
  requireAdmin(payload.token);
  writeRowUpdates('Orders', row._rowIndex, {
    AssembledQty: 0,
    AssemblyMeta: JSON.stringify([]),
    AssemblyStatus: 'pending'
  });
  return getAssemblyForOrder(payload.poNumber);
}
