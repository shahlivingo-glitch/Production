// Read-only consolidated report for one PO: everything the system captured
// about it, across Cutting, Extras, the Leftover Ledger and Bending, plus a
// single chronological activity log. Pure composition over existing records -
// this never writes anything.
//
// Note on history depth: per-sheet/per-part completion timestamps and actors
// (SheetCompletionMeta / BendingCompletionMeta / ExtraBendingCompletionMeta)
// and the Leftover Ledger's movement log (ExtraInventoryLog) only exist from
// the moment those were added. Anything completed before that reads as
// "not recorded" rather than being wrong - callers should render it that way.

function listExtraInventoryLog(poNumber) {
  return getAllRows('ExtraInventoryLog')
    .filter(function (r) { return !poNumber || String(r.PoNumber) === String(poNumber); })
    .map(function (r) {
      return {
        logId: String(r.LogId),
        modelName: String(r.ModelName),
        partName: String(r.PartName),
        size: r.Size || '',
        delta: Number(r.Delta) || 0,
        reason: r.Reason || '',
        reasonLabel: reasonLabel(r.Reason),
        poNumber: String(r.PoNumber || ''),
        actor: r.Actor || '',
        timestamp: r.Timestamp,
        note: r.Note || ''
      };
    })
    .sort(function (a, b) { return String(a.timestamp).localeCompare(String(b.timestamp)); });
}

function listSheetStockLogForPo(poNumber) {
  return getAllRows('SheetStockLog')
    .filter(function (r) { return String(r.PoNumber) === String(poNumber); })
    .map(function (r) {
      return {
        logId: String(r.LogId),
        size: String(r.Size),
        delta: Number(r.Delta) || 0,
        reason: r.Reason || '',
        timestamp: r.Timestamp,
        note: r.Note || ''
      };
    })
    .sort(function (a, b) { return String(a.timestamp).localeCompare(String(b.timestamp)); });
}

// Per sheet-type: what the plan called for vs what was actually cut, and the
// same comparison per part on that sheet. "Planned" deliberately re-runs the
// sheet math with NO overrides applied, so it reflects the original
// calculated requirement rather than whatever number was later keyed in.
function buildCuttingPlanVsActual(order, sheets) {
  var multiplier = getOrderSheetMultiplier(order);
  var decisions = parseJsonSafe(order.MultiYieldDecisions, {});
  var overrides = sanitizeSheetQtyOverrides(parseJsonSafe(order.SheetQtyOverrides, {}), sheets.length);
  var completion = parseJsonSafe(order.SheetCompletion, []);
  var completionMeta = parseJsonSafe(order.SheetCompletionMeta, {});

  var plannedPlan = computeOrderSheetPlan(sheets, multiplier, decisions, {});
  var actualPlan = computeOrderSheetPlan(sheets, multiplier, decisions, overrides);

  return sheets.map(function (sheet, sheetIndex) {
    var planned = plannedPlan[sheetIndex] || {};
    var actual = actualPlan[sheetIndex] || {};
    var plannedSheets = Number(planned.physicalSheets) || 0;
    var actualSheets = Number(actual.physicalSheets) || 0;
    var meta = completionMeta[String(sheetIndex)] || null;

    // Per-part figures here are THIS SHEET'S contribution only - deliberately
    // no planned/variance at this level: a part's requirement is a PO-wide
    // figure that other sheets, extra cuts and inventory pulls also feed, so
    // comparing it against one sheet's yield reads as a shortfall that isn't
    // real. That comparison lives in buildPartTotals instead.
    var parts = (sheet.outputs || []).map(function (output) {
      var perSheet = Number(output.qty) || 0;
      return {
        partName: output.partName || '',
        size: output.size || '',
        isExtra: !!output.isExtra,
        perSheet: perSheet,
        actualTotal: perSheet * actualSheets
      };
    });

    return {
      sheetIndex: sheetIndex,
      label: sheetLabelForBending(sheet, sheetIndex),
      width: sheet.width,
      height: sheet.height,
      thickness: sheet.thickness,
      plannedSheets: plannedSheets,
      actualSheets: actualSheets,
      sheetVariance: actualSheets - plannedSheets,
      overridden: !!(overrides && overrides.hasOwnProperty(String(sheetIndex))),
      done: !!completion[sheetIndex],
      doneAt: meta ? meta.at : null,
      doneBy: meta ? meta.by : null,
      parts: parts
    };
  });
}

// One row per part, combining EVERY source that produced or covered it in
// this PO - because a part's real position can't be read off any single
// sheet. The same part routinely comes off more than one sheet (SHELF at
// 4/sheet on one and 1/sheet on another), and can additionally be topped up
// by an extra sheet cut, an ad-hoc logged extra, or a pull from the
// Leftover Ledger. Per-sheet figures alone make a fully-covered part look
// short by whatever the other sources contributed.
//
// Planned comes from the model's own Parts-in-One-Unit definition × the
// order's unit qty - the true requirement - rather than being re-derived
// from any sheet's yield. Parts with no per-unit definition (plan-level
// extras like rips, or ad-hoc logged extras) have no requirement to compare
// against, so they carry a null planned/variance and render as "—".
function buildPartTotals(order, extras, cuttingSheets) {
  var orderQty = Number(order.Qty) || 0;
  var modelParts = {};
  try {
    modelParts = getModelParts(order.ModelName).partsPerUnit || {};
  } catch (err) {
    // model since deleted - actuals still aggregate, planned just stays null
  }

  var totals = {};
  // Keyed on trimmed part name alone, deliberately:
  //  - name only, because an extra sheet cut records just {partName: qty}
  //    with no size, so keying on name+size would stop those contributions
  //    ever joining the planned part they actually satisfy;
  //  - trimmed, because plan outputs are hand-typed and stray whitespace is
  //    real in this data ("Shelf rip" vs "Shelf rip "), which would silently
  //    split one part's total across two rows and understate its coverage.
  // Case is deliberately NOT folded - the Leftover Ledger matches parts with
  // exact string comparison, and diverging from that here would make this
  // report disagree with the stock it's reporting on.
  function bucket(partName) {
    var key = String(partName).trim();
    if (!totals[key]) {
      totals[key] = {
        partName: key,
        sizes: [],
        perUnit: null,
        plannedTotal: null,
        fromPlanSheets: 0,
        fromExtraSheets: 0,
        fromExtraParts: 0,
        fromInventory: 0,
        isPlanExtra: false
      };
    }
    return totals[key];
  }

  // Same-named outputs can legitimately carry different sizes (two rips off
  // one sheet). They still aggregate as one part, but every distinct size is
  // kept so the row never implies a single dimension it doesn't have.
  function noteSize(b, size) {
    var s = String(size || '').trim();
    if (s && b.sizes.indexOf(s) === -1) b.sizes.push(s);
  }

  cuttingSheets.forEach(function (sheet) {
    sheet.parts.forEach(function (p) {
      if (!p.partName) return;
      var b = bucket(p.partName);
      b.fromPlanSheets += Number(p.actualTotal) || 0;
      noteSize(b, p.size);
      if (p.isExtra) b.isPlanExtra = true;
    });
  });

  extras.forEach(function (e) {
    var d = e.details || {};
    if (e.type === 'extra-sheet') {
      var produced = d.partsProduced || {};
      Object.keys(produced).forEach(function (partName) {
        bucket(partName).fromExtraSheets += Number(produced[partName]) || 0;
      });
    } else if (e.type === 'extra-part' && d.partName) {
      var bp = bucket(d.partName);
      bp.fromExtraParts += Number(d.qty) || 0;
      noteSize(bp, d.size);
    } else if (e.type === 'inventory-pull' && d.partName) {
      var bi = bucket(d.partName);
      bi.fromInventory += Number(d.qty) || 0;
      noteSize(bi, d.size);
    }
  });

  Object.keys(modelParts).forEach(function (partName) {
    var def = modelParts[partName];
    var perUnit = (def && typeof def === 'object') ? (Number(def.qty) || 0) : (Number(def) || 0);
    var b = bucket(partName);
    b.perUnit = perUnit;
    b.plannedTotal = perUnit * orderQty;
    if (def && typeof def === 'object') noteSize(b, def.size);
  });

  return Object.keys(totals).map(function (key) {
    var b = totals[key];
    b.size = b.sizes.join(', ');
    b.actualTotal = b.fromPlanSheets + b.fromExtraSheets + b.fromExtraParts + b.fromInventory;
    b.variance = (b.plannedTotal === null) ? null : (b.actualTotal - b.plannedTotal);
    return b;
  }).sort(function (a, b) {
    return a.partName < b.partName ? -1 : (a.partName > b.partName ? 1 : 0);
  });
}

// The plan's own bending entries, each with whatever completion metadata was
// captured. Mirrors getBendingQueueForOrder's shaping (including the
// inventory-move netting) but adds the audit fields the report needs.
function buildBendingPlanVsActual(order, sheets) {
  var multiplier = getOrderSheetMultiplier(order);
  var decisions = parseJsonSafe(order.MultiYieldDecisions, {});
  var overrides = sanitizeSheetQtyOverrides(parseJsonSafe(order.SheetQtyOverrides, {}), sheets.length);
  var sheetPlan = computeOrderSheetPlan(sheets, multiplier, decisions, overrides);
  var sheetCompletion = parseJsonSafe(order.SheetCompletion, []);
  var bendingCompletion = parseJsonSafe(order.BendingCompletion, []);
  var bendingMeta = parseJsonSafe(order.BendingCompletionMeta, {});
  var moves = parseJsonSafe(order.PlanEntryInventoryMoves, {});

  return flattenPlanOutputs(sheets).map(function (entry, index) {
    var physical = (sheetPlan[entry.sheetIndex] && sheetPlan[entry.sheetIndex].physicalSheets) || 0;
    var producedQty = entry.qty * physical;
    var movedQty = Number(moves[index]) || 0;
    var meta = bendingMeta[String(index)] || null;
    var done = !!bendingCompletion[index];
    var unlocked = !!sheetCompletion[entry.sheetIndex];
    return {
      index: index,
      partName: entry.partName,
      size: entry.size || '',
      isExtra: entry.isExtra,
      sheetLabel: sheetLabelForBending(sheets[entry.sheetIndex], entry.sheetIndex),
      producedQty: producedQty,
      movedToInventory: movedQty,
      pendingQty: Math.max(0, producedQty - movedQty),
      status: done ? 'done' : (unlocked ? 'in-progress' : 'pending'),
      done: done,
      doneAt: meta ? meta.at : null,
      doneBy: meta ? meta.by : null,
      fromInventory: meta ? !!meta.fromInventory : false,
      source: (meta && meta.fromInventory) ? 'Extra Inventory' : 'Fresh cutting'
    };
  });
}

// Extra-derived bending tasks (logged extras and inventory pulls alike),
// with their own completion metadata.
function buildExtraBendingHistory(poNumber, order) {
  var meta = parseJsonSafe(order.ExtraBendingCompletionMeta, {});
  return getExtraBendingEntries(poNumber, order).map(function (e) {
    var m = meta[e.extraKey] || null;
    return {
      extraKey: e.extraKey,
      partName: e.partName,
      size: e.size || '',
      qty: e.totalQty,
      isFromInventory: !!e.isFromInventory,
      sheetLabel: e.sheetLabel,
      status: e.done ? 'done' : 'in-progress',
      done: e.done,
      doneAt: m ? m.at : null,
      doneBy: m ? m.by : null,
      fromInventory: m ? !!m.fromInventory : false,
      source: e.isFromInventory ? 'Extra Inventory' : ((m && m.fromInventory) ? 'Extra Inventory' : 'Fresh cutting')
    };
  });
}

function reasonLabel(reason) {
  var labels = {
    'cut-surplus': 'Surplus from cutting',
    'logged-extra': 'Logged extra at cutting',
    'added-from-bending': 'Added from Bending Stage',
    'moved-from-bending': 'Moved out of bending queue',
    'pulled-into-bending': 'Pulled into bending queue',
    'bending-used-inventory': 'Used from inventory at bending'
  };
  return labels[reason] || reason || 'Movement';
}

// One chronological stream of everything that happened to this PO, built
// from the per-stage records above. Sorted oldest-first so the page reads
// top to bottom like an audit trail.
function buildActivityLog(order, cuttingSheets, extras, inventoryLog, stockLog, bendingEntries, extraBending) {
  var events = [];

  events.push({
    timestamp: order.CreatedAt,
    stage: 'Order',
    action: 'PO created',
    detail: order.ModelName + ' × ' + (Number(order.Qty) || 0) + (order.PartyName ? ' for ' + order.PartyName : ''),
    actor: ''
  });

  cuttingSheets.forEach(function (s) {
    if (!s.done) return;
    events.push({
      timestamp: s.doneAt,
      stage: 'Cutting',
      action: 'Sheet marked done',
      detail: s.label + ' — ' + s.actualSheets + ' sheets cut' +
        (s.sheetVariance !== 0 ? ' (' + (s.sheetVariance > 0 ? '+' : '') + s.sheetVariance + ' vs plan)' : ''),
      actor: s.doneBy || ''
    });
  });

  extras.forEach(function (e) {
    var d = e.details || {};
    if (e.type === 'extra-sheet') {
      var producedList = Object.keys(d.partsProduced || {}).map(function (p) {
        return p + ' × ' + d.partsProduced[p];
      }).join(', ');
      events.push({
        timestamp: e.timestamp,
        stage: 'Cutting',
        action: 'Extra sheet cut',
        detail: [d.width, d.height, d.thickness].filter(function (v) { return v; }).join(' × ') + ' mm' +
          (d.dxfNo ? ' · DXF ' + d.dxfNo : '') + (producedList ? ' → ' + producedList : ''),
        actor: ''
      });
    } else if (e.type === 'extra-part') {
      events.push({
        timestamp: e.timestamp,
        stage: 'Cutting',
        action: 'Extra part logged',
        detail: d.partName + ' × ' + d.qty + (d.size ? ' (' + d.size + ')' : ''),
        actor: ''
      });
    }
    // 'inventory-pull' rows are deliberately not emitted here: the same
    // action already appears via ExtraInventoryLog below ("Taken from Extra
    // Inventory"), which additionally knows who did it. Emitting both put
    // two rows in the log for one operator action.
  });

  inventoryLog.forEach(function (m) {
    events.push({
      timestamp: m.timestamp,
      stage: 'Inventory',
      action: m.delta >= 0 ? 'Moved into Extra Inventory' : 'Taken from Extra Inventory',
      detail: m.partName + (m.size ? ' (' + m.size + ')' : '') + ' × ' + Math.abs(m.delta) +
        ' — ' + reasonLabel(m.reason),
      actor: m.actor || ''
    });
  });

  stockLog.forEach(function (s) {
    events.push({
      timestamp: s.timestamp,
      stage: 'Raw Stock',
      action: s.delta < 0 ? 'Raw sheets consumed' : 'Raw sheets returned',
      detail: s.size + ' × ' + Math.abs(s.delta) + (s.note ? ' — ' + s.note : ''),
      actor: ''
    });
  });

  bendingEntries.forEach(function (b) {
    if (!b.done) return;
    events.push({
      timestamp: b.doneAt,
      stage: 'Bending',
      action: 'Part bent',
      detail: b.partName + ' × ' + b.pendingQty + ' — ' + b.source,
      actor: b.doneBy || ''
    });
  });

  extraBending.forEach(function (b) {
    if (!b.done) return;
    events.push({
      timestamp: b.doneAt,
      stage: 'Bending',
      action: 'Extra part bent',
      detail: b.partName + ' × ' + b.qty + ' — ' + b.source,
      actor: b.doneBy || ''
    });
  });

  return events.sort(function (a, b) {
    // Events with no recorded timestamp (pre-dating the audit fields) sink to
    // the end rather than jumping to the top as empty strings would.
    if (!a.timestamp && !b.timestamp) return 0;
    if (!a.timestamp) return 1;
    if (!b.timestamp) return -1;
    return String(a.timestamp).localeCompare(String(b.timestamp));
  });
}

function getPoFullHistory(poNumber) {
  var order = findRowById('Orders', 'PoNumber', poNumber);
  if (!order) {
    throw new Error('PO not found: ' + poNumber);
  }
  var sheets = getOrderActiveSheets(order);

  var cuttingSheets = buildCuttingPlanVsActual(order, sheets);
  var extras = listCuttingExtras(poNumber);
  var inventoryLog = listExtraInventoryLog(poNumber);
  var stockLog = listSheetStockLogForPo(poNumber);
  var bendingEntries = buildBendingPlanVsActual(order, sheets);
  var extraBending = buildExtraBendingHistory(poNumber, order);

  return {
    order: getOrder(poNumber),
    cuttingSheets: cuttingSheets,
    partTotals: buildPartTotals(order, extras, cuttingSheets),
    extras: extras,
    inventoryLog: inventoryLog,
    stockLog: stockLog,
    bendingEntries: bendingEntries,
    extraBending: extraBending,
    activityLog: buildActivityLog(order, cuttingSheets, extras, inventoryLog, stockLog, bendingEntries, extraBending)
  };
}
