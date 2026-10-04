function getOrderActiveSheets(order) {
  // Mirrors getActivePlanVersionForOrder's fallback (PlanVersions.gs): an
  // order has no PlanVersionId at all until a version is explicitly saved
  // for it - until then it's still following the model's named plan
  // directly. Returning [] in that case (as this used to) makes Cutting's
  // own completion tracking and Bending's queue both see zero sheets for
  // every order that hasn't saved a version yet, which is the common case.
  if (order.PlanVersionId) {
    var version = findRowById('PlanVersions', 'VersionId', order.PlanVersionId);
    return version ? parseJsonSafe(version.Sheets, []) : [];
  }
  var plan = findPlanRow(order.ModelName, order.PlanName);
  return plan ? parseJsonSafe(plan.Sheets, []) : [];
}

function sheetLabelForBending(sheet, sheetIndex) {
  var label = 'Sheet ' + (sheetIndex + 1);
  if (sheet) {
    var dims = [sheet.width, sheet.height, sheet.thickness]
      .filter(function (v) { return v !== undefined && v !== ''; })
      .join(' × ');
    if (dims) {
      label += ' — ' + dims + ' mm';
    }
  }
  return label;
}

// Extra parts logged during cutting (CuttingExtras) become their own
// Bending tasks too, alongside the plan's own entries - a positional array
// can't represent these since they're logged after the plan is fixed and
// can arrive at any time, so completion is tracked by a stable string key
// (the CuttingExtras row's own ExtraId, or "ExtraId:partName" for one of an
// extra-sheet log's several parts) in Orders.ExtraBendingCompletion instead.
// Always unlocked (true) - unlike a plan sheet, there's no separate "wait
// for cutting" gate: the part was already physically cut by the time it was
// logged as an extra.
function getExtraBendingEntries(poNumber, order) {
  var completion = parseJsonSafe(order.ExtraBendingCompletion, {});
  var partialMap = parseJsonSafe(order.BendingPartial, {});
  var entries = [];
  listCuttingExtras(poNumber).forEach(function (r) {
    var d = r.details || {};
    var addedMap = r.addedToInventory || {};
    if (r.type === 'inventory-pull') {
      // Created by pullFromExtraInventory - a part manually pulled OUT of
      // the Leftover Ledger into this PO's bending queue (e.g. so bending
      // can proceed before Cutting has even finished that part's real
      // sheet). The ledger was already decremented at pull time, so this
      // never offers "use from inventory" or "add to inventory" again -
      // AddedToInventory is pre-set to {main:true} at creation for exactly
      // that reason.
      if (!d.partName || !(Number(d.qty) > 0)) return;
      var key = r.extraId;
      var done = !!completion[key];
      entries.push({
        extraKey: key,
        partName: d.partName,
        qty: Number(d.qty) || 0,
        totalQty: Number(d.qty) || 0,
        isExtra: false,
        isFromInventory: true,
        size: d.size || '',
        sheetLabel: 'Pulled from Extra Inventory',
        unlocked: true,
        done: done,
        bentQty: Number(partialMap['extra:' + key]) || 0,
        leftoverAvailable: 0,
        alreadyInInventory: true
      });
      return;
    }
    if (r.type === 'extra-part') {
      if (!d.partName || !(Number(d.qty) > 0)) return;
      var key = r.extraId;
      var done = !!completion[key];
      var inventoryModel = resolveExtraInventoryModel(order.ModelName, d);
      var qtyVal = Number(d.qty) || 0;
      entries.push({
        extraKey: key,
        partName: d.partName,
        qty: qtyVal,
        totalQty: qtyVal, // already a flat logged total - no per-sheet rate to scale
        isExtra: !!d.isExtra,
        size: d.size || '',
        sheetLabel: d.sourceSheetLabel || 'Extra part',
        unlocked: true,
        done: done,
        bentQty: Number(partialMap['extra:' + key]) || 0,
        leftoverAvailable: done ? 0 : getExtraPartInventoryQty(inventoryModel, d.partName, d.size || ''),
        alreadyInInventory: !!addedMap.main
      });
    } else if (r.type === 'extra-sheet') {
      var produced = d.partsProduced || {};
      Object.keys(produced).forEach(function (partName) {
        var qty = Number(produced[partName]) || 0;
        if (!(qty > 0)) return;
        var key = r.extraId + ':' + partName;
        var done = !!completion[key];
        entries.push({
          extraKey: key,
          partName: partName,
          qty: qty,
          totalQty: qty, // already a flat logged total - no per-sheet rate to scale
          isExtra: false,
          size: '',
          sheetLabel: 'Extra Sheet Cut',
          unlocked: true,
          done: done,
          bentQty: Number(partialMap['extra:' + key]) || 0,
          leftoverAvailable: done ? 0 : getExtraPartInventoryQty(order.ModelName, partName, ''),
          alreadyInInventory: !!addedMap[partName]
        });
      });
    }
  });
  return entries;
}

// What this PO still needs Cutting to produce: the model's per-unit
// requirement x order qty, less everything actually cut so far.
//
// "Actually cut" counts only sheets Cutting has MARKED DONE - a sheet still
// sitting in the plan has produced nothing yet - plus extra sheet cuts,
// ad-hoc logged extras and anything pulled in from the Leftover Ledger.
// Plan entries add back whatever was moved to Extra Inventory: those pieces
// were still physically cut, they were just banked as surplus, so counting
// them as "not cut" would report a part as owing when it isn't.
//
// This deliberately answers "which parts is the order still short of", not
// "which sheets are unmarked" - a part the plan never cuts at all (no sheet
// lists it) is the most important case and has no sheet to wait on.
function buildStillToCut(order, entries, extraEntries) {
  var orderQty = Number(order.Qty) || 0;
  var modelParts = {};
  try {
    modelParts = getModelParts(order.ModelName).partsPerUnit || {};
  } catch (err) {
    return []; // model since deleted - nothing to compare a requirement against
  }

  var cut = {};
  function addCut(partName, qty) {
    var key = String(partName || '').trim();
    if (!key) return;
    cut[key] = (cut[key] || 0) + (Number(qty) || 0);
  }
  entries.forEach(function (e) {
    if (!e.unlocked) return;
    addCut(e.partName, (Number(e.totalQty) || 0) + (Number(e.movedQty) || 0));
  });
  extraEntries.forEach(function (e) {
    addCut(e.partName, e.totalQty);
  });

  // Pieces the operator declared bent without them having been cut here.
  // They count against the requirement so the shortfall clears - the whole
  // point of the override is that where they came from is not this app's
  // business (off-system stock, a previous run, a hand-cut piece).
  var forced = parseJsonSafe(order.ForceBentParts, {});
  Object.keys(forced).forEach(function (partName) {
    addCut(partName, (forced[partName] && forced[partName].qty) || 0);
  });

  var out = [];
  Object.keys(modelParts).forEach(function (partName) {
    var def = modelParts[partName];
    var perUnit = (def && typeof def === 'object') ? (Number(def.qty) || 0) : (Number(def) || 0);
    var required = perUnit * orderQty;
    if (!(required > 0)) return;
    var key = String(partName).trim();
    var alreadyCut = cut[key] || 0;
    if (alreadyCut >= required) return;
    out.push({
      partName: key,
      size: (def && typeof def === 'object' && def.size) ? def.size : '',
      required: required,
      cut: alreadyCut,
      stillToCut: required - alreadyCut
    });
  });
  return out.sort(function (a, b) { return b.stillToCut - a.stillToCut; });
}

// How many whole almirahs the bending done so far adds up to: the weakest
// part decides it, because nine bent backs and forty bent shelves are still
// only nine cabinets. Only parts the plan actually cuts are counted - a
// part no sheet produces (PO-0001 never cuts LEG) would otherwise peg this
// at zero forever and tell the bender nothing.
function computeUnitsBent(order, entries, extraEntries) {
  var modelParts = {};
  try {
    modelParts = getModelParts(order.ModelName).partsPerUnit || {};
  } catch (err) {
    return 0;
  }

  var bentByPart = {};
  function addBent(partName, qty) {
    var key = String(partName || '').trim();
    if (!key) return;
    bentByPart[key] = (bentByPart[key] || 0) + (Number(qty) || 0);
  }
  entries.forEach(function (e) {
    // A finished entry counts as all of it; the partial count is cleared
    // once the boolean takes over.
    addBent(e.partName, e.done ? e.totalQty : e.bentQty);
  });

  // Extras that have been bent are bent pieces like any other - a BACK bent
  // off an extra sheet covers an almirah exactly as one off the plan does.
  // Leaving them out pegged this at the plan's count alone, which on a PO
  // topped up from extras reads far below what is really built.
  (extraEntries || []).forEach(function (e) {
    addBent(e.partName, e.done ? e.totalQty : e.bentQty);
  });

  // Same for pieces declared bent that were never cut here: the whole point
  // of the override is that they exist.
  var forced = parseJsonSafe(order.ForceBentParts, {});
  Object.keys(forced).forEach(function (partName) {
    addBent(partName, (forced[partName] && forced[partName].qty) || 0);
  });

  var units = null;
  Object.keys(bentByPart).forEach(function (key) {
    var def = modelParts[key];
    var perUnit = (def && typeof def === 'object') ? (Number(def.qty) || 0) : (Number(def) || 0);
    if (!(perUnit > 0)) return;
    var forThis = Math.floor(bentByPart[key] / perUnit);
    units = (units === null) ? forThis : Math.min(units, forThis);
  });
  return units === null ? 0 : units;
}

// The per-part figure each card shows for the current batch, spread across
// however many cards produce that part. A part cut on two different sheets
// used to show the WHOLE order's need on BOTH cards - read literally that is
// twice the real requirement. The need is allocated across them in order
// instead, so the cards still sum to exactly perUnit x batch.
function allocateBatchNeeds(entries, perUnitByPart, batchQty) {
  var byPart = {};
  entries.forEach(function (e) {
    var key = String(e.partName || '').trim();
    if (!perUnitByPart[key]) return;
    if (!byPart[key]) byPart[key] = [];
    byPart[key].push(e);
  });
  Object.keys(byPart).forEach(function (key) {
    var list = byPart[key];
    var remaining = perUnitByPart[key] * batchQty;
    list.forEach(function (e, i) {
      // The last card carries whatever is left, so the allocation never
      // quietly loses pieces when the earlier cards cannot cover the need.
      if (i === list.length - 1) {
        e.batchNeed = Math.max(0, remaining);
        return;
      }
      var take = Math.min(remaining, Number(e.totalQty) || 0);
      e.batchNeed = take;
      remaining -= take;
    });
  });
}

// The plan's bending entries for a PO. Shared by the queue read and by
// setBendingComplete, which needs the same batchNeed/totalQty the operator
// was looking at when they ticked - deriving it twice is how the two drift.
function buildPlanBendingEntries(order, sheets) {
  var sheetCompletion = parseJsonSafe(order.SheetCompletion, []);
  var bendingCompletion = parseJsonSafe(order.BendingCompletion, []);
  var sheetPlan = computeOrderSheetPlan(
    sheets,
    getOrderSheetMultiplier(order),
    parseJsonSafe(order.MultiYieldDecisions, {}),
    sanitizeSheetQtyOverrides(parseJsonSafe(order.SheetQtyOverrides, {}), sheets.length)
  );

  var planEntryMoves = parseJsonSafe(order.PlanEntryInventoryMoves, {});
  var bendingPartial = parseJsonSafe(order.BendingPartial, {});

  // Batch defaults to the whole order, so an untouched PO reads as "what
  // this order needs" rather than silently scaling to something arbitrary.
  var orderQty = Number(order.Qty) || 0;
  var batchQty = Number(order.BendingBatchQty) || orderQty;
  var perUnitByPart = {};
  try {
    var pp = getModelParts(order.ModelName).partsPerUnit || {};
    Object.keys(pp).forEach(function (n) {
      var def = pp[n];
      perUnitByPart[String(n).trim()] =
        (def && typeof def === 'object') ? (Number(def.qty) || 0) : (Number(def) || 0);
    });
  } catch (err) {
    // model gone - every part simply has no per-unit figure to scale by
  }

  // Any plan entry (a required part or a plan-level "extra" output alike)
  // can have some or all of its produced qty manually moved to the Leftover
  // Ledger via moveEntryQtyToInventory - for whenever a run produced more
  // than this PO actually needed. `totalQty` here is already NET of that
  // (the real pending-for-bending count); an entry fully moved (nothing left
  // to bend) is dropped from the list entirely, same as if it never existed.
  var entries = flattenPlanOutputs(sheets).map(function (entry, index) {
    // Non-extra parts only - mirrors applyCutStockAndLedger's own scoping
    // (extras never auto-post to/draw from the ledger). Live lookup each
    // time, so it reflects whatever another order's completion may have
    // already consumed.
    var leftoverAvailable = (!entry.isExtra && !bendingCompletion[index])
      ? getExtraPartInventoryQty(order.ModelName, entry.partName, '')
      : 0;
    var rawTotalQty = producedQtyForEntry(sheetPlan, entry);
    var movedQty = Number(planEntryMoves[index]) || 0;
    var pendingQty = Math.max(0, rawTotalQty - movedQty);
    var perUnit = perUnitByPart[String(entry.partName || '').trim()] || null;
    return {
      index: index,
      sheetIndex: entry.sheetIndex,
      sheetLabel: sheetLabelForBending(sheets[entry.sheetIndex], entry.sheetIndex),
      partName: entry.partName,
      qty: entry.qty,
      // What one sheet of this type actually yields of this part. Same as
      // qty for an ordinary output; for a multi-yield one it is
      // yieldPerSheet, since there qty is the per-almirah requirement.
      perSheetYield: (function () {
        var r = (sheetPlan[entry.sheetIndex] && sheetPlan[entry.sheetIndex].rows || [])[entry.outputIndex];
        return (r && r.yieldPerSheet) ? Number(r.yieldPerSheet) : (Number(entry.qty) || 0);
      })(),
      totalQty: pendingQty,
      movedQty: movedQty,
      isExtra: entry.isExtra,
      size: entry.size,
      unlocked: !!sheetCompletion[entry.sheetIndex],
      done: !!bendingCompletion[index],
      bentQty: Number(bendingPartial[String(index)]) || 0,
      perUnit: perUnit,
      batchNeed: perUnit ? perUnit * batchQty : null,
      leftoverAvailable: leftoverAvailable
    };
  }).filter(function (entry) {
    return !(entry.movedQty > 0 && entry.totalQty <= 0);
  });

  allocateBatchNeeds(entries, perUnitByPart, batchQty);
  return { entries: entries, batchQty: batchQty, orderQty: orderQty, sheetPlan: sheetPlan };
}

function getBendingQueueForOrder(poNumber) {
  var order = findRowById('Orders', 'PoNumber', poNumber);
  if (!order) {
    throw new Error('PO not found: ' + poNumber);
  }
  var sheets = getOrderActiveSheets(order);
  var built = buildPlanBendingEntries(order, sheets);
  var entries = built.entries;
  var batchQty = built.batchQty;

  // Parts currently sitting as surplus stock this order could pull from -
  // its own model plus the Universal bucket (see resolveExtraInventoryModel).
  // Bundled here (rather than a separate round trip) so the "Pull from Extra
  // Inventory" picker opens instantly.
  var availableInventory = listExtraPartInventory().filter(function (r) {
    return (r.modelName === order.ModelName || r.modelName === UNIVERSAL_MODEL_TAG) && r.qty > 0;
  });

  var extraEntries = getExtraBendingEntries(poNumber, order);

  return {
    poNumber: String(order.PoNumber),
    modelName: String(order.ModelName),
    qty: Number(order.Qty) || 0,
    createdAt: order.CreatedAt,
    partyName: order.PartyName || '',
    cuttingStatus: order.CuttingStatus || 'pending',
    entries: entries,
    extraEntries: extraEntries,
    batchQty: batchQty,
    forceBendAllowed: isForceBendAllowed(order),
    forceBent: parseJsonSafe(order.ForceBentParts, {}),
    unitsBent: computeUnitsBent(order, entries, extraEntries),
    stillToCut: buildStillToCut(order, entries, extraEntries),
    availableInventory: availableInventory,
    bendingStatus: order.BendingStatus || 'pending'
  };
}

// Best-effort: pull an entry's need from the Leftover Ledger instead of
// leaving that surplus sitting unused - an explicit per-entry choice
// (useFromInventory, from a checkbox next to the leftover note) rather than
// automatic, so the operator decides whether to use existing stock or bend
// the freshly-cut parts. Only on a genuine not-done -> done transition
// (never retroactive for an already-done entry), guarded by
// BendingLeftoverConsumed too so a re-check never double-consumes. Extras
// (plan-level ones) are skipped - they never auto-post to/draw from the
// ledger either way.
function consumeBendingLeftoverIfRequested(row, entry, idx, wasDone, useFromInventory, consumedMap, actor) {
  if (wasDone || !useFromInventory || consumedMap[String(idx)] || entry.isExtra || !entry.partName) return;
  try {
    consumeExtraPartInventory(row.ModelName, entry.partName, '', Number(entry.qty) || 0, {
      poNumber: row.PoNumber,
      actor: actor || '',
      reason: 'bending-used-inventory',
      note: 'Used from inventory instead of bending fresh'
    });
  } catch (err) {
    // swallow - completion must still record
  }
  consumedMap[String(idx)] = true;
}

// Partial bending progress lives in ONE namespaced map, Orders.BendingPartial:
// a plain index ("3") for a plan entry, "extra:<extraKey>" for an extra -
// the same namespacing BendingLeftoverConsumed already uses, rather than a
// second column that would need its own migration and its own bugs.
//
// BendingCompletion stays the single source of truth for "done". The partial
// count is progress toward that, and crossing the entry's full qty is what
// flips it - so nothing downstream (BendingStatus, the PO History report,
// listPendingBendingOrders) has to learn a new notion of completeness.
function bendingPartialKey(entryIndex, extraKey) {
  return extraKey ? ('extra:' + extraKey) : String(entryIndex);
}

function getBendingPartial(row, entryIndex, extraKey) {
  var map = parseJsonSafe(row.BendingPartial, {});
  return Number(map[bendingPartialKey(entryIndex, extraKey)]) || 0;
}

// How many almirahs the bender is working through right now. Stored per PO
// so it survives a reload and whoever opens the page next sees the same
// batch - it describes the job, not one person's screen.
//
// It records NOTHING about bending. It only scales the quantity each part
// card shows (per-unit x batch), so the bender can read off what this batch
// needs instead of doing the arithmetic. Marking a part done is still the
// checkbox, and still means the whole part for the PO.
// Declares a shortfall bent without it ever being cut here. Deliberately
// asks nothing and checks no stock: the operator is telling the system
// something it cannot know, and the alternative is a PO that can never be
// completed because a few pieces came from somewhere else.
//
// It is an override, so it records who did it and when - and it is gated
// per PO by AllowForceBend, which an admin controls.
function forceBendShortfall(payload) {
  var row = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!row) {
    throw new Error('PO not found: ' + payload.poNumber);
  }
  if (!isForceBendAllowed(row)) {
    throw new Error('Force-bend is turned off for this PO.');
  }
  var partName = String(payload.partName || '').trim();
  if (!partName) {
    throw new Error('Which part?');
  }

  var queue = getBendingQueueForOrder(payload.poNumber);
  var target = null;
  (queue.stillToCut || []).forEach(function (r) {
    if (String(r.partName).trim() === partName) target = r;
  });
  if (!target) {
    throw new Error('That part is no longer short - nothing to force.');
  }

  var forced = parseJsonSafe(row.ForceBentParts, {});
  var prev = (forced[partName] && Number(forced[partName].qty)) || 0;
  forced[partName] = {
    qty: prev + target.stillToCut,
    at: nowIso(),
    by: resolveActorName(payload.token)
  };

  writeRowUpdates('Orders', row._rowIndex, { ForceBentParts: JSON.stringify(forced) });
  return getBendingQueueForOrder(payload.poNumber);
}

// Default ON: the button is meant to be there, and an admin takes it away
// per PO rather than having to switch it on before it can be used.
function isForceBendAllowed(row) {
  var v = row.AllowForceBend;
  if (v === '' || v === null || v === undefined) return true;
  return !(v === false || v === 'false' || v === 'FALSE' || v === 0 || v === '0');
}

// Undo for the override. It has to exist: force-bend permanently changes
// whether a PO can complete, the card vanishes the moment it is used, and
// a mis-click would otherwise be unrecoverable from the UI.
function clearForceBend(payload) {
  var row = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!row) {
    throw new Error('PO not found: ' + payload.poNumber);
  }
  requireAdmin(payload.token);
  var partName = String(payload.partName || '').trim();
  var forced = parseJsonSafe(row.ForceBentParts, {});
  if (!forced[partName]) {
    throw new Error('Nothing force-bent for that part.');
  }
  delete forced[partName];
  writeRowUpdates('Orders', row._rowIndex, { ForceBentParts: JSON.stringify(forced) });
  return getBendingQueueForOrder(payload.poNumber);
}

function setAllowForceBend(payload) {
  var row = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!row) {
    throw new Error('PO not found: ' + payload.poNumber);
  }
  requireAdmin(payload.token);
  writeRowUpdates('Orders', row._rowIndex, {
    AllowForceBend: payload.allowed ? 'true' : 'false'
  });
  return getBendingQueueForOrder(payload.poNumber);
}

function setBendingBatchQty(payload) {
  var row = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!row) {
    throw new Error('PO not found: ' + payload.poNumber);
  }
  var qty = Number(payload.qty);
  if (!(qty > 0)) {
    throw new Error('Enter how many almirahs this batch covers.');
  }
  var orderQty = Number(row.Qty) || 0;
  if (orderQty > 0 && qty > orderQty) {
    throw new Error('This PO is only for ' + orderQty + ' almirahs.');
  }
  writeRowUpdates('Orders', row._rowIndex, { BendingBatchQty: qty });
  return getBendingQueueForOrder(payload.poNumber);
}

// "Bending is finished" means every plan card AND every extra task is
// accounted for. Extras used to be left out of the status entirely, so a PO
// could report complete with extra parts still sitting unbent - and Assembly
// opens on exactly this signal.
//
// A plan entry whose whole quantity was banked to the Leftover Ledger counts
// as accounted for too: buildPlanBendingEntries drops its card, so there is
// nothing left on screen that could ever tick it, and without this the PO
// could never finish bending at all.
//
// Takes the updates about to be written, so it judges the state that is
// being saved rather than the one already on the row.
function recomputeBendingStatus(row, sheets, updates) {
  var merged = {};
  Object.keys(row).forEach(function (k) { merged[k] = row[k]; });
  Object.keys(updates || {}).forEach(function (k) { merged[k] = updates[k]; });

  var planEntries = buildPlanBendingEntries(merged, sheets).entries;
  var extras = getExtraBendingEntries(merged.PoNumber, merged);
  if (planEntries.length + extras.length === 0) return 'pending';

  var allDone = true;
  planEntries.forEach(function (e) { if (!e.done) allDone = false; });
  extras.forEach(function (e) { if (!e.done) allDone = false; });
  return allDone ? 'complete' : 'pending';
}

function setBendingComplete(payload) {
  var row = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!row) {
    throw new Error('PO not found: ' + payload.poNumber);
  }
  var idx = Number(payload.entryIndex);
  if (idx < 0 || isNaN(idx)) {
    throw new Error('Invalid entry index');
  }

  var sheets = getOrderActiveSheets(row);
  var flat = flattenPlanOutputs(sheets);
  var entry = flat[idx];
  if (!entry) {
    throw new Error('Bending entry not found');
  }

  var sheetCompletion = parseJsonSafe(row.SheetCompletion, []);
  if (payload.completed && !sheetCompletion[entry.sheetIndex]) {
    throw new Error('That part\'s sheet has not been marked complete in Cutting yet');
  }

  var completion = parseJsonSafe(row.BendingCompletion, []);
  var wasDone = !!completion[idx];
  var actor = resolveActorName(payload.token);
  var completionMeta = parseJsonSafe(row.BendingCompletionMeta, {});
  var partial = parseJsonSafe(row.BendingPartial, {});
  var partialKey = bendingPartialKey(idx, '');

  // The same numbers the operator was looking at when they clicked.
  var built = buildPlanBendingEntries(row, sheets);
  var liveEntry = null;
  built.entries.forEach(function (e) { if (e.index === idx) liveEntry = e; });

  // Batch mode: when the bender is working through fewer almirahs than the
  // PO is for, marking a part bent means "this batch's worth is bent" - NOT
  // the whole part. Booking all of it there is how a 20-of-50 batch used to
  // close a PO out for bending with 60% of the work still to do.
  //
  // The count accumulates in BendingPartial and crossing the entry's full
  // quantity is what flips the boolean, so nothing downstream has to learn a
  // new notion of completeness. Outside batch mode - and for entries with no
  // per-unit figure to scale by, like plan extras - a tick still means all
  // of it, exactly as before.
  var batchCovers = null;
  if (payload.completed && liveEntry &&
      built.batchQty > 0 && built.batchQty < built.orderQty &&
      liveEntry.batchNeed !== null && liveEntry.batchNeed > 0 &&
      liveEntry.batchNeed < liveEntry.totalQty) {
    batchCovers = liveEntry.batchNeed;
  }

  var nowDone;
  if (batchCovers !== null) {
    var already = Number(partial[partialKey]) || 0;
    var next = Math.min(liveEntry.totalQty, already + batchCovers);
    nowDone = next >= liveEntry.totalQty;
    if (nowDone) {
      delete partial[partialKey];
    } else {
      partial[partialKey] = next;
    }
  } else {
    nowDone = !!payload.completed;
    // The boolean supersedes the partial count either way: once done, "all
    // of it" is implied; once un-done, progress is back to zero.
    delete partial[partialKey];
  }
  completion[idx] = nowDone;

  // When/by whom/from where - BendingCompletion is only a boolean array, so
  // the PO History report has nothing to show about a part's bending without
  // this. fromInventory records whether this part was covered by existing
  // leftover stock rather than freshly-cut pieces.
  if (nowDone) {
    completionMeta[String(idx)] = { at: nowIso(), by: actor, fromInventory: !!payload.useFromInventory };
  } else {
    delete completionMeta[String(idx)];
  }

  var updates = {
    BendingCompletion: JSON.stringify(completion),
    BendingCompletionMeta: JSON.stringify(completionMeta),
    BendingPartial: JSON.stringify(partial)
  };
  // Only on a genuine not-done -> done transition, so a batch tick that
  // leaves the entry part-way does not draw from the ledger early.
  if (nowDone) {
    var consumedMap = parseJsonSafe(row.BendingLeftoverConsumed, {});
    consumeBendingLeftoverIfRequested(row, entry, idx, wasDone, !!payload.useFromInventory, consumedMap, actor);
    updates.BendingLeftoverConsumed = JSON.stringify(consumedMap);
  }
  updates.BendingStatus = recomputeBendingStatus(row, sheets, updates);
  writeRowUpdates('Orders', row._rowIndex, updates);
  return getBendingQueueForOrder(payload.poNumber);
}

// Undo for a mis-clicked batch tick: zeroes an entry's recorded progress
// without touching anything else. A part-way entry has no ticked checkbox to
// un-tick, so without this the only way back was to tick it all the way to
// done and then un-tick that.
function clearBendingPartial(payload) {
  var row = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!row) {
    throw new Error('PO not found: ' + payload.poNumber);
  }
  var idx = Number(payload.entryIndex);
  if (idx < 0 || isNaN(idx)) {
    throw new Error('Invalid entry index');
  }
  var partial = parseJsonSafe(row.BendingPartial, {});
  delete partial[bendingPartialKey(idx, '')];
  writeRowUpdates('Orders', row._rowIndex, { BendingPartial: JSON.stringify(partial) });
  return getBendingQueueForOrder(payload.poNumber);
}

// Resolves a Bending extraKey back to what it needs to consume from the
// ledger - re-reads its source CuttingExtras row, since setExtraBendingComplete
// itself only stores the completion flag, not the part/qty.
function resolveExtraBendingTask(poNumber, extraKey, orderModelName) {
  var sepIdx = String(extraKey).indexOf(':');
  var extraId = sepIdx === -1 ? String(extraKey) : String(extraKey).substring(0, sepIdx);
  var partNameFromKey = sepIdx === -1 ? null : String(extraKey).substring(sepIdx + 1);
  var row = findRow('CuttingExtras', function (r) {
    return String(r.PoNumber) === String(poNumber) && String(r.ExtraId) === extraId;
  });
  if (!row) return null;
  var d = parseJsonSafe(row.Details, {});
  if (row.Type === 'extra-part') {
    return { partName: d.partName, qty: Number(d.qty) || 0, size: d.size || '', inventoryModel: resolveExtraInventoryModel(orderModelName, d) };
  }
  if (row.Type === 'extra-sheet' && partNameFromKey) {
    var produced = d.partsProduced || {};
    return { partName: partNameFromKey, qty: Number(produced[partNameFromKey]) || 0, size: '', inventoryModel: orderModelName };
  }
  return null;
}

// Moves some or all of a plan entry's pending (not-yet-bent) qty to the
// Leftover Ledger - whether a required part like BACK/SHELF or a plan-level
// "extra" output like a rip/scrap piece defined on the sheet itself.
// Requires the part's sheet to already be cut (unlocked) and the entry to
// not already be fully bent - moving surplus only makes sense for flat,
// not-yet-bent stock. Orders.PlanEntryInventoryMoves (keyed by entry index)
// tracks the running total moved so far; getBendingQueueForOrder nets this
// off the entry's totalQty and drops the entry entirely once nothing's left.
function moveEntryQtyToInventory(payload) {
  var row = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!row) {
    throw new Error('PO not found: ' + payload.poNumber);
  }
  var idx = Number(payload.entryIndex);
  if (idx < 0 || isNaN(idx)) {
    throw new Error('Invalid entry index');
  }
  var qtyToMove = Number(payload.qty);
  if (!(qtyToMove > 0)) {
    throw new Error('Enter a quantity greater than zero.');
  }

  var sheets = getOrderActiveSheets(row);
  var flat = flattenPlanOutputs(sheets);
  var entry = flat[idx];
  if (!entry) {
    throw new Error('Bending entry not found');
  }

  var sheetCompletion = parseJsonSafe(row.SheetCompletion, []);
  if (!sheetCompletion[entry.sheetIndex]) {
    throw new Error('That part\'s sheet has not been marked complete in Cutting yet');
  }
  var bendingCompletion = parseJsonSafe(row.BendingCompletion, []);
  if (bendingCompletion[idx]) {
    throw new Error('This part is already marked bent.');
  }

  var sheetPlan = computeOrderSheetPlan(
    sheets,
    getOrderSheetMultiplier(row),
    parseJsonSafe(row.MultiYieldDecisions, {}),
    sanitizeSheetQtyOverrides(parseJsonSafe(row.SheetQtyOverrides, {}), sheets.length)
  );
  var rawTotalQty = producedQtyForEntry(sheetPlan, entry);

  var moves = parseJsonSafe(row.PlanEntryInventoryMoves, {});
  var alreadyMoved = Number(moves[idx]) || 0;
  // Pieces already bent are spoken for - no longer flat stock, so they
  // cannot be banked as surplus and come off what is movable.
  var alreadyBent = getBendingPartial(row, idx, '');
  var remaining = rawTotalQty - alreadyMoved - alreadyBent;
  if (qtyToMove > remaining) {
    throw new Error('Only ' + Math.max(0, remaining) + ' pcs left to move'
      + (alreadyBent ? ' (' + alreadyBent + ' already bent).' : '.'));
  }

  addToExtraPartInventory(row.ModelName, entry.partName, entry.size || '', qtyToMove, {
    poNumber: row.PoNumber,
    actor: resolveActorName(payload.token),
    reason: 'moved-from-bending',
    note: 'Surplus moved out of bending queue'
  });
  moves[idx] = alreadyMoved + qtyToMove;

  var updates = { PlanEntryInventoryMoves: JSON.stringify(moves) };

  // Banking surplus shrinks what is left to bend, which can mean the pieces
  // already bent now ARE the whole outstanding job. Without re-checking here
  // the entry sits at "0 left" and never ticks - found live on PO-0001,
  // where 10 BACK were bent and the other 40 were moved to inventory.
  var pendingAfter = rawTotalQty - moves[idx];
  if (pendingAfter > 0 && alreadyBent >= pendingAfter) {
    var completion = parseJsonSafe(row.BendingCompletion, []);
    var completionMeta = parseJsonSafe(row.BendingCompletionMeta, {});
    var partialMap = parseJsonSafe(row.BendingPartial, {});
    completion[idx] = true;
    completionMeta[String(idx)] = {
      at: nowIso(), by: resolveActorName(payload.token), fromInventory: false
    };
    delete partialMap[bendingPartialKey(idx, '')];
    updates.BendingCompletion = JSON.stringify(completion);
    updates.BendingCompletionMeta = JSON.stringify(completionMeta);
    updates.BendingPartial = JSON.stringify(partialMap);
  }

  // Banking an entry's WHOLE quantity removes its card, so re-deriving the
  // status here is what lets a PO still finish bending afterwards - the
  // vanished card's slot can never be ticked by anyone.
  updates.BendingStatus = recomputeBendingStatus(row, sheets, updates);
  writeRowUpdates('Orders', row._rowIndex, updates);
  return getBendingQueueForOrder(payload.poNumber);
}

// The reverse direction: pulls a qty of some part OUT of the Leftover
// Ledger and injects it as a new Bending task for this PO - lets the bender
// proceed on stock that's already sitting as surplus even if Cutting hasn't
// finished (or even started) that part's real sheet for this order.
// Reuses the CuttingExtras/getExtraBendingEntries machinery with a distinct
// 'inventory-pull' type rather than a fourth parallel tracking table -
// AddedToInventory is pre-marked {main:true} since it came FROM the ledger,
// so it's never offered back into it a second time.
function pullFromExtraInventory(payload) {
  var row = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!row) {
    throw new Error('PO not found: ' + payload.poNumber);
  }
  var modelName = String(payload.modelName || '');
  var partName = String(payload.partName || '');
  var size = payload.size || '';
  var qty = Number(payload.qty);
  if (!modelName || !partName) {
    throw new Error('Choose a part.');
  }
  if (!(qty > 0)) {
    throw new Error('Enter a quantity greater than zero.');
  }

  var available = getExtraPartInventoryQty(modelName, partName, size);
  if (qty > available) {
    throw new Error('Only ' + available + ' pcs available in Extra Part Inventory.');
  }
  consumeExtraPartInventory(modelName, partName, size, qty, {
    poNumber: payload.poNumber,
    actor: resolveActorName(payload.token),
    reason: 'pulled-into-bending',
    note: 'Pulled into this PO\'s bending queue'
  });

  appendRow('CuttingExtras', {
    ExtraId: generateId('EX'),
    PoNumber: payload.poNumber,
    Type: 'inventory-pull',
    Details: JSON.stringify({ partName: partName, qty: qty, size: size, sourceModel: modelName }),
    Timestamp: nowIso(),
    AddedToInventory: JSON.stringify({ main: true })
  });

  return getBendingQueueForOrder(payload.poNumber);
}

function setExtraBendingComplete(payload) {
  var row = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!row) {
    throw new Error('PO not found: ' + payload.poNumber);
  }
  var key = String(payload.extraKey || '');
  if (!key) {
    throw new Error('Invalid extra key');
  }
  var completion = parseJsonSafe(row.ExtraBendingCompletion, {});
  completion[key] = !!payload.completed;
  var actor = resolveActorName(payload.token);

  var completionMeta = parseJsonSafe(row.ExtraBendingCompletionMeta, {});
  if (payload.completed) {
    completionMeta[key] = { at: nowIso(), by: actor, fromInventory: !!payload.useFromInventory };
  } else {
    delete completionMeta[key];
  }

  // The boolean supersedes any partial count in both directions - same
  // reasoning as the clear in setBendingComplete.
  var partial = parseJsonSafe(row.BendingPartial, {});
  delete partial[bendingPartialKey(-1, key)];

  var updates = {
    ExtraBendingCompletion: JSON.stringify(completion),
    ExtraBendingCompletionMeta: JSON.stringify(completionMeta),
    BendingPartial: JSON.stringify(partial)
  };

  // Shares BendingLeftoverConsumed with the plan-entry path (setBendingComplete)
  // rather than deriving "already consumed" from ExtraBendingCompletion itself -
  // that map resets on uncheck, which would let an uncheck+recheck-with-
  // useFromInventory double-consume. A "extra:" prefix keeps this namespace
  // distinct from the plan entries' plain numeric-index keys (not that they
  // could collide anyway).
  if (payload.completed && payload.useFromInventory) {
    var consumedMap = parseJsonSafe(row.BendingLeftoverConsumed, {});
    var guardKey = 'extra:' + key;
    if (!consumedMap[guardKey]) {
      var task = resolveExtraBendingTask(payload.poNumber, key, row.ModelName);
      if (task && task.partName && task.qty > 0) {
        try {
          consumeExtraPartInventory(task.inventoryModel, task.partName, task.size || '', task.qty, {
            poNumber: payload.poNumber,
            actor: actor,
            reason: 'bending-used-inventory',
            note: 'Used from inventory for extra part'
          });
        } catch (err) {
          // best-effort - completion must still record
        }
      }
      consumedMap[guardKey] = true;
      updates.BendingLeftoverConsumed = JSON.stringify(consumedMap);
    }
  }

  // Extras count toward the PO's bending status now, so the last extra to be
  // ticked is what finishes it - and un-ticking one re-opens it.
  updates.BendingStatus = recomputeBendingStatus(row, getOrderActiveSheets(row), updates);
  writeRowUpdates('Orders', row._rowIndex, updates);
  return getBendingQueueForOrder(payload.poNumber);
}

function markAllBendingComplete(payload) {
  var row = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!row) {
    throw new Error('PO not found: ' + payload.poNumber);
  }
  var sheets = getOrderActiveSheets(row);
  var flat = flattenPlanOutputs(sheets);
  var sheetCompletion = parseJsonSafe(row.SheetCompletion, []);
  var completion = parseJsonSafe(row.BendingCompletion, []);

  var actor = resolveActorName(payload.token);
  var stamp = nowIso();
  var completionMeta = parseJsonSafe(row.BendingCompletionMeta, {});
  var extraCompletionMeta = parseJsonSafe(row.ExtraBendingCompletionMeta, {});

  // Bulk-complete never touches the Leftover Ledger - "use inventory" is an
  // explicit, per-entry choice (see setBendingComplete/setExtraBendingComplete)
  // with no natural per-entry UI in a single bulk action. Only entries this
  // call actually completes get stamped; already-done ones keep their original.
  flat.forEach(function (entry, idx) {
    if (sheetCompletion[entry.sheetIndex]) {
      if (!completion[idx]) {
        completionMeta[String(idx)] = { at: stamp, by: actor, fromInventory: false, viaMarkAll: true };
      }
      completion[idx] = true;
    }
  });

  var extraCompletion = parseJsonSafe(row.ExtraBendingCompletion, {});
  getExtraBendingEntries(payload.poNumber, row).forEach(function (e) {
    if (!extraCompletion[e.extraKey]) {
      extraCompletionMeta[e.extraKey] = { at: stamp, by: actor, fromInventory: false, viaMarkAll: true };
    }
    extraCompletion[e.extraKey] = true;
  });

  // Everything reachable is now fully bent, so no partial counts survive.
  var bulkUpdates = {
    BendingPartial: JSON.stringify({}),
    BendingCompletion: JSON.stringify(completion),
    BendingCompletionMeta: JSON.stringify(completionMeta),
    ExtraBendingCompletion: JSON.stringify(extraCompletion),
    ExtraBendingCompletionMeta: JSON.stringify(extraCompletionMeta)
  };
  bulkUpdates.BendingStatus = recomputeBendingStatus(row, sheets, bulkUpdates);
  writeRowUpdates('Orders', row._rowIndex, bulkUpdates);
  return getBendingQueueForOrder(payload.poNumber);
}

function listPendingBendingOrders() {
  var result = [];
  getAllRows('Orders').forEach(function (r) {
    if ((r.BendingStatus || 'pending') === 'complete') {
      return;
    }
    var sheetCompletion = parseJsonSafe(r.SheetCompletion, []);
    var hasStarted = sheetCompletion.some(function (v) { return v === true; });
    // Extra parts logged during cutting are unlocked immediately (no "wait
    // for cutting" gate), so a PO can have pending bending work from these
    // alone even before any plan sheet is marked done.
    var extraEntries = getExtraBendingEntries(String(r.PoNumber), r);
    if (!hasStarted && extraEntries.length === 0) {
      return;
    }

    var sheets = getOrderActiveSheets(r);
    var flat = flattenPlanOutputs(sheets);
    var bendingCompletion = parseJsonSafe(r.BendingCompletion, []);
    var availableParts = 0;
    var donePartsCount = 0;
    flat.forEach(function (entry, idx) {
      if (sheetCompletion[entry.sheetIndex]) {
        availableParts++;
        if (bendingCompletion[idx]) {
          donePartsCount++;
        }
      }
    });
    availableParts += extraEntries.length;
    donePartsCount += extraEntries.filter(function (e) { return e.done; }).length;

    result.push({
      poNumber: String(r.PoNumber),
      modelName: String(r.ModelName),
      qty: Number(r.Qty) || 0,
      createdAt: r.CreatedAt,
      partyName: r.PartyName || '',
      availableParts: availableParts,
      donePartsCount: donePartsCount,
      totalPartsInPlan: flat.length + extraEntries.length
    });
  });
  return result;
}
