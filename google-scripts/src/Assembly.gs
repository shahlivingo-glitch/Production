// Assembly: the last stage, where bent parts become finished almirahs.
//
// Unlike Cutting and Bending this stage has no per-part detail at all. What
// the assembler tracks is whole cabinets, so the entire stage is one number
// per PO.
//
// A PO appears here as soon as there are bent parts for at least one whole
// almirah - NOT only once the entire order is bent. A 50-almirah PO bent in
// batches of 20 should put those 20 into assembly while the other 30 are
// still on the bending floor; waiting for all 50 would stall the line for
// no reason. What gates it instead is `unitsBent` (Bending.gs): the whole
// almirahs the bent parts add up to, weakest part deciding, since nine bent
// backs and forty bent shelves are still only nine cabinets.

function assemblyStatusFor(row) {
  var ordered = Number(row.Qty) || 0;
  var done = Number(row.AssembledQty) || 0;
  return (ordered > 0 && done >= ordered) ? 'complete' : 'pending';
}

// Whole almirahs this PO has bent parts for. Falls back to the stored
// bending status if the queue cannot be built (model deleted, plan gone) -
// a PO whose bending is finished can always be assembled in full.
function assemblyUnitsAvailable(row) {
  try {
    return Number(getBendingQueueForOrder(String(row.PoNumber)).unitsBent) || 0;
  } catch (err) {
    return ((row.BendingStatus || 'pending') === 'complete') ? (Number(row.Qty) || 0) : 0;
  }
}

// POs with something to assemble: bent parts for more almirahs than have
// been assembled so far. A PO still mid-bending belongs here as soon as its
// first batch is bent.
function listPendingAssemblyOrders() {
  var result = [];
  getAllRows('Orders').forEach(function (r) {
    if (assemblyStatusFor(r) === 'complete') return;

    var ordered = Number(r.Qty) || 0;
    var done = Number(r.AssembledQty) || 0;
    var bent = Math.min(ordered, assemblyUnitsAvailable(r));
    if (bent <= done) return;

    result.push({
      poNumber: String(r.PoNumber),
      modelName: String(r.ModelName),
      qty: ordered,
      assembledQty: done,
      remaining: Math.max(0, ordered - done),
      unitsBent: bent,
      readyNow: Math.max(0, bent - done),
      bendingStatus: r.BendingStatus || 'pending',
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

  // One queue read serves both the bent-almirah count and the shortfall
  // list below - building it twice would double the cost of opening the
  // page for nothing.
  var queue = null;
  try {
    queue = getBendingQueueForOrder(poNumber);
  } catch (err) {
    // bending data unavailable - assembly can still be recorded
  }
  var bent = queue
    ? Math.min(ordered, Number(queue.unitsBent) || 0)
    : (((row.BendingStatus || 'pending') === 'complete') ? ordered : 0);

  return {
    poNumber: String(row.PoNumber),
    modelName: String(row.ModelName),
    qty: ordered,
    assembledQty: done,
    remaining: Math.max(0, ordered - done),
    // Whole almirahs there are bent parts for, and how many of those are
    // not yet assembled. readyNow is what the assembler can actually build
    // today; remaining is the whole order.
    unitsBent: bent,
    readyNow: Math.max(0, bent - done),
    stillBending: Math.max(0, ordered - bent),
    partyName: row.PartyName || '',
    dxfRefNo: row.DxfRefNo || '',
    colourPlan: row.ColourPlan || '',
    deliveryDeadline: row.DeliveryDeadline || '',
    createdAt: row.CreatedAt,
    bendingStatus: row.BendingStatus || 'pending',
    assemblyStatus: assemblyStatusFor(row),
    assemblyMeta: parseJsonSafe(row.AssemblyMeta, []),
    // Surfaced, not enforced: parts the plan never produced. The assembler
    // is the person who will discover it physically - better they see it.
    stillToCut: queue ? (queue.stillToCut || []) : []
  };
}

// Records almirahs assembled. Additive, because assembly happens over days
// and the natural thing to type is "I did 8 more today", not a running
// total the assembler has to work out themselves.
//
// Capped at what there are bent parts for, not at the order quantity: you
// cannot assemble a cabinet whose sides are still flat. Typing more than
// that records what is actually available rather than failing - pedantry on
// the shop floor helps nobody - and the response says what was recorded.
function addAssemblyProgress(payload) {
  var row = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!row) {
    throw new Error('PO not found: ' + payload.poNumber);
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
  var bent = Math.min(ordered, assemblyUnitsAvailable(row));
  var ready = bent - done;
  if (ready <= 0) {
    throw new Error('No almirahs are fully bent yet - bending has only covered ' +
      bent + ' of ' + ordered + '.');
  }

  var next = done + Math.min(qty, ready);
  var meta = parseJsonSafe(row.AssemblyMeta, []);
  meta.push({ qty: next - done, at: nowIso(), by: resolveActorName(payload.token) });

  writeRowUpdates('Orders', row._rowIndex, {
    AssembledQty: next,
    AssemblyMeta: JSON.stringify(meta),
    AssemblyStatus: (next >= ordered) ? 'complete' : 'pending'
  });
  return getAssemblyForOrder(payload.poNumber);
}

// "Assemble Done" for everything currently bent - the common case where a
// batch is finished in one session. It fills what is ready, not the whole
// order, so a part-bent PO stays open for its remaining batches.
function markAssemblyComplete(payload) {
  var row = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!row) {
    throw new Error('PO not found: ' + payload.poNumber);
  }
  var ordered = Number(row.Qty) || 0;
  var done = Number(row.AssembledQty) || 0;
  if (done >= ordered) {
    throw new Error('This PO is already fully assembled.');
  }
  var bent = Math.min(ordered, assemblyUnitsAvailable(row));
  if (bent <= done) {
    throw new Error('No almirahs are fully bent yet - bending has only covered ' +
      bent + ' of ' + ordered + '.');
  }

  var meta = parseJsonSafe(row.AssemblyMeta, []);
  meta.push({ qty: bent - done, at: nowIso(), by: resolveActorName(payload.token) });

  writeRowUpdates('Orders', row._rowIndex, {
    AssembledQty: bent,
    AssemblyMeta: JSON.stringify(meta),
    AssemblyStatus: (bent >= ordered) ? 'complete' : 'pending'
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
