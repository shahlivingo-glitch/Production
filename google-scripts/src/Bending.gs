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
          leftoverAvailable: done ? 0 : getExtraPartInventoryQty(order.ModelName, partName, ''),
          alreadyInInventory: !!addedMap[partName]
        });
      });
    }
  });
  return entries;
}

function getBendingQueueForOrder(poNumber) {
  var order = findRowById('Orders', 'PoNumber', poNumber);
  if (!order) {
    throw new Error('PO not found: ' + poNumber);
  }
  var sheets = getOrderActiveSheets(order);
  var sheetCompletion = parseJsonSafe(order.SheetCompletion, []);
  var bendingCompletion = parseJsonSafe(order.BendingCompletion, []);

  // entry.qty (from flattenPlanOutputs) is the per-sheet rate as configured
  // in the plan (e.g. "4" for Shelf) - not how many actually come out of
  // cutting for this PO. That's qty x however many of that sheet-type are
  // actually being/were cut (its real physicalSheets, honoring any
  // SheetQtyOverride) - the exact same math Cutting Stage's own output rows
  // use. Computed once per sheet-type here, then applied per entry below.
  var sheetPlan = computeOrderSheetPlan(
    sheets,
    getOrderSheetMultiplier(order),
    parseJsonSafe(order.MultiYieldDecisions, {}),
    sanitizeSheetQtyOverrides(parseJsonSafe(order.SheetQtyOverrides, {}), sheets.length)
  );

  var planEntryMoves = parseJsonSafe(order.PlanEntryInventoryMoves, {});

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
    var physicalSheetsForThisSheet = (sheetPlan[entry.sheetIndex] && sheetPlan[entry.sheetIndex].physicalSheets) || 0;
    var rawTotalQty = entry.qty * physicalSheetsForThisSheet;
    var movedQty = Number(planEntryMoves[index]) || 0;
    var pendingQty = Math.max(0, rawTotalQty - movedQty);
    return {
      index: index,
      sheetIndex: entry.sheetIndex,
      sheetLabel: sheetLabelForBending(sheets[entry.sheetIndex], entry.sheetIndex),
      partName: entry.partName,
      qty: entry.qty,
      totalQty: pendingQty,
      movedQty: movedQty,
      isExtra: entry.isExtra,
      size: entry.size,
      unlocked: !!sheetCompletion[entry.sheetIndex],
      done: !!bendingCompletion[index],
      leftoverAvailable: leftoverAvailable
    };
  }).filter(function (entry) {
    return !(entry.movedQty > 0 && entry.totalQty <= 0);
  });

  // Parts currently sitting as surplus stock this order could pull from -
  // its own model plus the Universal bucket (see resolveExtraInventoryModel).
  // Bundled here (rather than a separate round trip) so the "Pull from Extra
  // Inventory" picker opens instantly.
  var availableInventory = listExtraPartInventory().filter(function (r) {
    return (r.modelName === order.ModelName || r.modelName === UNIVERSAL_MODEL_TAG) && r.qty > 0;
  });

  return {
    poNumber: String(order.PoNumber),
    modelName: String(order.ModelName),
    qty: Number(order.Qty) || 0,
    createdAt: order.CreatedAt,
    partyName: order.PartyName || '',
    cuttingStatus: order.CuttingStatus || 'pending',
    entries: entries,
    extraEntries: getExtraBendingEntries(poNumber, order),
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
  completion[idx] = !!payload.completed;
  var actor = resolveActorName(payload.token);

  // When/by whom/from where - BendingCompletion is only a boolean array, so
  // the PO History report has nothing to show about a part's bending without
  // this. fromInventory records whether this part was covered by existing
  // leftover stock rather than freshly-cut pieces.
  var completionMeta = parseJsonSafe(row.BendingCompletionMeta, {});
  if (payload.completed) {
    completionMeta[String(idx)] = { at: nowIso(), by: actor, fromInventory: !!payload.useFromInventory };
  } else {
    delete completionMeta[String(idx)];
  }

  var updates = {
    BendingCompletion: JSON.stringify(completion),
    BendingCompletionMeta: JSON.stringify(completionMeta),
    BendingStatus: computeBendingStatus(completion, flat.length)
  };
  if (payload.completed) {
    var consumedMap = parseJsonSafe(row.BendingLeftoverConsumed, {});
    consumeBendingLeftoverIfRequested(row, entry, idx, wasDone, !!payload.useFromInventory, consumedMap, actor);
    updates.BendingLeftoverConsumed = JSON.stringify(consumedMap);
  }
  writeRowUpdates('Orders', row._rowIndex, updates);
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
  var physicalSheetsForThisSheet = (sheetPlan[entry.sheetIndex] && sheetPlan[entry.sheetIndex].physicalSheets) || 0;
  var rawTotalQty = entry.qty * physicalSheetsForThisSheet;

  var moves = parseJsonSafe(row.PlanEntryInventoryMoves, {});
  var alreadyMoved = Number(moves[idx]) || 0;
  var remaining = rawTotalQty - alreadyMoved;
  if (qtyToMove > remaining) {
    throw new Error('Only ' + remaining + ' pcs left to move.');
  }

  addToExtraPartInventory(row.ModelName, entry.partName, entry.size || '', qtyToMove, {
    poNumber: row.PoNumber,
    actor: resolveActorName(payload.token),
    reason: 'moved-from-bending',
    note: 'Surplus moved out of bending queue'
  });
  moves[idx] = alreadyMoved + qtyToMove;
  writeRowUpdates('Orders', row._rowIndex, { PlanEntryInventoryMoves: JSON.stringify(moves) });
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

  var updates = {
    ExtraBendingCompletion: JSON.stringify(completion),
    ExtraBendingCompletionMeta: JSON.stringify(completionMeta)
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

  writeRowUpdates('Orders', row._rowIndex, {
    BendingCompletion: JSON.stringify(completion),
    BendingCompletionMeta: JSON.stringify(completionMeta),
    BendingStatus: computeBendingStatus(completion, flat.length),
    ExtraBendingCompletion: JSON.stringify(extraCompletion),
    ExtraBendingCompletionMeta: JSON.stringify(extraCompletionMeta)
  });
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
