var pendingBendingOrders = [];
var currentBendingQueue = null;

function initBendingStage() {
  el('back-to-dashboard-btn').addEventListener('click', showBendingDashboard);
  el('mark-all-complete-btn').addEventListener('click', markAllBendingComplete);
  el('pull-inventory-btn').addEventListener('click', openPullInventoryModal);
  el('pull-inventory-cancel-btn').addEventListener('click', function () {
    el('pull-inventory-overlay').style.display = 'none';
  });
  if (!canEdit('bendingStage')) {
    el('mark-all-complete-btn').style.display = 'none';
    el('pull-inventory-btn').style.display = 'none';
  }
  showBendingDashboard();
}

function showBendingDashboard() {
  el('detail-view').style.display = 'none';
  el('dashboard-view').style.display = 'block';
  loadPendingBendingOrders();
}

function loadPendingBendingOrders() {
  el('pending-loading').style.display = 'flex';
  el('pending-error').style.display = 'none';
  el('pending-po-list').innerHTML = '';

  apiGet('pendingBendingOrders', {}).then(function (result) {
    el('pending-loading').style.display = 'none';
    if (!result.ok) {
      el('pending-error').textContent = 'Could not load Pending Bending: ' + result.error;
      el('pending-error').style.display = 'block';
      return;
    }
    pendingBendingOrders = result.data;
    renderBendingDashboard();
  }).catch(function (err) {
    el('pending-loading').style.display = 'none';
    el('pending-error').textContent = 'Could not load Pending Bending: ' + (err && err.message ? err.message : err);
    el('pending-error').style.display = 'block';
  });
}

function renderBendingDashboard() {
  el('pending-count-heading').textContent = 'Pending Bending (' + pendingBendingOrders.length + ')';
  var list = el('pending-po-list');
  list.innerHTML = '';

  if (pendingBendingOrders.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Nothing waiting on bending — either nothing has been cut yet, or it\'s all bent.';
    list.appendChild(empty);
    return;
  }

  pendingBendingOrders.slice().reverse().forEach(function (po) {
    var card = document.createElement('div');
    card.className = 'cs-po-card';
    card.addEventListener('click', function () { openBendingOrder(po.poNumber); });

    var main = document.createElement('div');
    main.className = 'cs-po-card-main';
    main.innerHTML =
      '<div class="cs-po-number">' + po.poNumber + ' — ' + po.modelName + '</div>' +
      '<div class="muted">Qty ' + po.qty + ' · ' + new Date(po.createdAt).toLocaleDateString() + (po.partyName ? ' · ' + po.partyName : '') + '</div>';

    var progress = document.createElement('div');
    progress.className = 'cs-po-card-sheets';
    // The waiting-on-cutting count is red here too, so it's visible without
    // opening the PO - but static, not blinking like the detail panel: a list
    // of flashing rows would be noise rather than a signal.
    progress.innerHTML = '<strong>' + po.donePartsCount + ' / ' + po.availableParts + '</strong>parts bent' +
      (po.availableParts < po.totalPartsInPlan ? ' <span class="cut-pending-inline">(' + (po.totalPartsInPlan - po.availableParts) + ' more waiting on cutting)</span>' : '');

    card.appendChild(main);
    card.appendChild(progress);
    list.appendChild(card);
  });
}

function openBendingOrder(poNumber) {
  // Switch to the detail view immediately on click - previously nothing
  // happened until both API calls resolved, which on a slow connection
  // just looked like the app had hung. Now the view + spinner show right
  // away and only the content underneath waits on the fetch.
  el('dashboard-view').style.display = 'none';
  el('detail-view').style.display = 'block';
  el('detail-po-title').textContent = poNumber;
  el('detail-status-pill').innerHTML = '';
  el('detail-loading').style.display = 'flex';
  el('detail-error').style.display = 'none';
  el('detail-content').style.display = 'none';

  apiGet('bendingQueueForOrder', { poNumber: poNumber }).then(function (result) {
    el('detail-loading').style.display = 'none';
    if (!result.ok) {
      el('detail-error').textContent = 'Could not load ' + poNumber + ': ' + result.error;
      el('detail-error').style.display = 'block';
      return;
    }
    currentBendingQueue = result.data;
    el('detail-content').style.display = 'block';
    renderBendingStatusPill();
    renderBendingPoSummary();
    renderBendingEntries();
    renderExtraBendingEntries();
  }).catch(function (err) {
    el('detail-loading').style.display = 'none';
    el('detail-error').textContent = 'Could not load ' + poNumber + ': ' + (err && err.message ? err.message : err);
    el('detail-error').style.display = 'block';
  });
}

function renderBendingStatusPill() {
  var pill = el('detail-status-pill');
  pill.innerHTML = '<span class="status-pill status-' + currentBendingQueue.bendingStatus + '">' + currentBendingQueue.bendingStatus + '</span>';
}

function renderBendingPoSummary() {
  var box = el('po-summary');
  box.innerHTML = '';
  var fields = [
    ['Model', currentBendingQueue.modelName],
    ['Qty', currentBendingQueue.qty],
    ['Date', new Date(currentBendingQueue.createdAt).toLocaleString()],
    ['Party', currentBendingQueue.partyName || '—'],
    ['Cutting Status', currentBendingQueue.cuttingStatus]
  ];
  fields.forEach(function (f) {
    var block = document.createElement('div');
    block.className = 'field-block';
    block.innerHTML = '<label>' + f[0] + '</label><div>' + f[1] + '</div>';
    box.appendChild(block);
  });
}

// Most part names in this data already carry their own size ("SIDE SUPPORT
// (120x1780)"), so appending the configured size again just reads as a
// stutter. Only show it when it adds something - and never for the "N/A"
// placeholder used by parts that have no meaningful dimensions.
function formatPartSizeSuffix(partName, size) {
  var s = String(size || '').trim();
  if (!s || s.toUpperCase() === 'N/A') return '';
  var squash = function (v) { return String(v).toLowerCase().replace(/\s+/g, ''); };
  if (squash(partName).indexOf(squash(s)) !== -1) return '';
  return ' <span class="muted">(' + s + ')</span>';
}

function partKey(name) {
  return String(name || '').trim();
}

// The plan's per-sheet rate for a part, if any sheet cuts it at all. Parts the
// plan never produces (the worst shortfalls) have none, so their card simply
// omits the "(N/sheet)" detail rather than inventing a rate.
function perSheetRateForPart(partName) {
  var key = partKey(partName);
  var found = 0;
  (currentBendingQueue.entries || []).forEach(function (e) {
    if (!found && partKey(e.partName) === key) found = Number(e.qty) || 0;
  });
  return found;
}

// The Leftover Ledger row a shortfall should be pulled from. Matched on part
// name rather than name+size: the ledger's size string comes from wherever the
// part was logged and does not always match the model's own definition, so
// insisting on both would leave usable stock stranded. An exact size match
// still wins when there is one.
function findInventoryForPart(partName, size) {
  var key = partKey(partName).toLowerCase();
  var matches = (currentBendingQueue.availableInventory || []).filter(function (r) {
    return partKey(r.partName).toLowerCase() === key && r.qty > 0;
  });
  if (matches.length === 0) return null;
  var wanted = String(size || '').trim().toLowerCase();
  var exact = matches.filter(function (r) { return String(r.size || '').trim().toLowerCase() === wanted; });
  var pool = exact.length ? exact : matches;
  return pool.sort(function (a, b) { return b.qty - a.qty; })[0];
}

// A part this order is still short of, rendered as its own card inline in the
// bending queue. Same shape as a normal row so the list reads continuously,
// but red throughout and with nothing bendable on it - the only action here is
// covering the gap from Extra Inventory.
function buildStillToCutCard(row) {
  var card = document.createElement('div');
  card.className = 'cs-sheet-card still-to-cut-card';

  var label = document.createElement('label');
  label.className = 'cs-sheet-done-label';

  // Kept for alignment with the bendable rows, but never actionable: there is
  // nothing cut yet to mark as bent.
  var checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.disabled = true;
  checkbox.title = 'Nothing to bend yet - this part still has to be cut';

  var perSheet = perSheetRateForPart(row.partName);
  var text = document.createElement('span');
  text.innerHTML = '<strong>' + row.partName + '</strong>' + formatPartSizeSuffix(row.partName, row.size) +
    ' × ' + row.stillToCut +
    (perSheet ? ' <span class="muted">(' + perSheet + '/sheet)</span>' : '') +
    ' — <span class="still-to-cut-flag">Still to be cut</span>' +
    ' <span class="muted">(cut ' + row.cut + ' of ' + row.required + ')</span>';

  label.appendChild(checkbox);
  label.appendChild(text);
  card.appendChild(label);

  var actions = document.createElement('div');
  actions.className = 'still-to-cut-actions';
  var source = findInventoryForPart(row.partName, row.size);

  if (!source) {
    // Offering the button with nothing behind it would just walk the operator
    // into the server's "Only 0 pcs available".
    var none = document.createElement('span');
    none.className = 'still-to-cut-none';
    none.textContent = 'None of this part in Extra Inventory to pull from.';
    actions.appendChild(none);
    card.appendChild(actions);
    return card;
  }

  var qtyInput = document.createElement('input');
  qtyInput.type = 'number';
  qtyInput.min = '1';
  qtyInput.max = String(source.qty);
  qtyInput.value = String(row.stillToCut);
  qtyInput.disabled = !canEdit('bendingStage');

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-secondary';
  btn.textContent = 'Pull part from Extra Inventory';
  btn.disabled = !canEdit('bendingStage');
  btn.addEventListener('click', function () {
    pullShortfallFromInventory(row, source, qtyInput, btn);
  });

  var avail = document.createElement('span');
  avail.className = 'still-to-cut-none';
  avail.textContent = source.qty + ' available' +
    (source.modelName === 'Universal' ? ' (Universal)' : '');

  actions.appendChild(qtyInput);
  actions.appendChild(btn);
  actions.appendChild(avail);
  card.appendChild(actions);
  return card;
}

function pullShortfallFromInventory(row, source, qtyInput, btn) {
  if (!canEdit('bendingStage')) {
    showFatalError('View only - ask an admin for edit access to change this.');
    return;
  }
  var qty = Number(qtyInput.value);
  if (!(qty > 0)) {
    showFatalError('Enter a quantity greater than zero.');
    return;
  }
  if (qty > source.qty) {
    showFatalError('Only ' + source.qty + ' pcs available in Extra Part Inventory.');
    return;
  }
  // Pulling exactly the outstanding shortfall is the expected move, so it goes
  // through unchallenged. Anything else is a deliberate deviation worth
  // confirming: it either leaves the order short or takes stock another order
  // may be counting on.
  if (qty !== row.stillToCut) {
    if (!confirm('Pull qty differs from remaining shortfall (' + row.stillToCut + ').\n\n' +
        'Confirm pulling ' + qty + ' pcs instead?')) {
      return;
    }
  }
  btn.disabled = true;
  apiPost('pullFromExtraInventory', {
    poNumber: currentBendingQueue.poNumber,
    modelName: source.modelName,
    partName: source.partName,
    size: source.size,
    qty: qty
  }).then(function (result) {
    if (!result.ok) {
      btn.disabled = false;
      showFatalError(result.error);
      return;
    }
    currentBendingQueue = result.data;
    renderBendingStatusPill();
    renderBendingEntries();
    renderExtraBendingEntries();
  }).catch(function (err) {
    btn.disabled = false;
    showFatalError(err);
  });
}

function renderBendingEntries() {
  var body = el('bending-entries-body');
  body.innerHTML = '';

  var entries = currentBendingQueue.entries || [];
  var extraEntries = currentBendingQueue.extraEntries || [];
  var shortRows = currentBendingQueue.stillToCut || [];

  if (entries.length === 0 && extraEntries.length === 0 && shortRows.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'This plan has no parts defined yet.';
    body.appendChild(empty);
    return;
  }

  var shortByPart = {};
  shortRows.forEach(function (r) { shortByPart[partKey(r.partName)] = r; });

  // A shortfall card slots in after the LAST normal row for that part, so you
  // read every sheet's contribution first and then what is still missing.
  // Parts no sheet cuts at all have no such anchor and go at the end.
  var lastIndexForPart = {};
  entries.forEach(function (entry, i) { lastIndexForPart[partKey(entry.partName)] = i; });

  var placed = {};
  entries.forEach(function (entry, i) {
    body.appendChild(buildBendingEntryCard(entry));
    var key = partKey(entry.partName);
    if (shortByPart[key] && lastIndexForPart[key] === i && !placed[key]) {
      placed[key] = true;
      body.appendChild(buildStillToCutCard(shortByPart[key]));
    }
  });

  shortRows.forEach(function (r) {
    var key = partKey(r.partName);
    if (!placed[key]) {
      placed[key] = true;
      body.appendChild(buildStillToCutCard(r));
    }
  });
}

// Shared by both the plan-entry cards and the extra-entry cards below - the
// "use N from Leftover Inventory instead" checkbox. Explicit, unchecked by
// default: the operator decides whether to pull from existing stock or bend
// the freshly-cut parts, rather than it happening automatically. Returns
// null when there's nothing to offer (already done, or nothing available).
function buildUseInventoryCheckbox(entry) {
  if (entry.done || !(entry.leftoverAvailable > 0)) return null;
  var wrap = document.createElement('label');
  wrap.className = 'leftover-action-banner';
  wrap.style.marginTop = 'var(--space-3)';
  wrap.style.marginBottom = '0';
  wrap.style.display = 'flex';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '8px';
  wrap.style.cursor = 'pointer';

  var cb = document.createElement('input');
  cb.type = 'checkbox';

  var text = document.createElement('span');
  text.textContent = entry.leftoverAvailable + ' pcs of ' + entry.partName +
    ' already available in leftover stock — use these instead of bending fresh ones?';

  wrap.appendChild(cb);
  wrap.appendChild(text);
  wrap._checkbox = cb;
  return wrap;
}

// entry.qty is the per-sheet rate as configured in the plan (e.g. "4" for
// Shelf) - not how many actually need bending for this PO. entry.totalQty
// (qty x however many of that sheet-type are actually being/were cut,
// honoring any SheetQtyOverride - see getBendingQueueForOrder) is the real
// count. For an extra-derived entry the two are already equal (a logged
// extra has no separate per-sheet rate), so the "(N/sheet)" detail only
// shows when it's actually informative.
function formatBendingQtyText(entry) {
  var total = entry.totalQty !== undefined ? entry.totalQty : entry.qty;
  if (total !== entry.qty) {
    return total + ' <span class="muted">(' + entry.qty + '/sheet)</span>';
  }
  return String(total);
}

function buildBendingEntryCard(entry) {
  var card = document.createElement('div');
  card.className = 'cs-sheet-card' + (entry.done ? ' done' : '');

  var label = document.createElement('label');
  label.className = 'cs-sheet-done-label';

  var checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = entry.done;
  checkbox.disabled = !entry.unlocked || !canEdit('bendingStage');

  var text = document.createElement('span');
  var sizeTag = entry.isExtra ? ' [extra' + (entry.size ? ', ' + entry.size : '') + ']' : '';
  text.innerHTML = '<strong>' + entry.partName + sizeTag + '</strong> × ' + formatBendingQtyText(entry) + ' <span class="muted">— from ' + entry.sheetLabel + '</span>';

  label.appendChild(checkbox);
  label.appendChild(text);
  card.appendChild(label);

  if (!entry.unlocked) {
    var banner = document.createElement('div');
    banner.className = 'alert-banner';
    banner.style.marginTop = 'var(--space-3)';
    banner.style.marginBottom = '0';
    banner.textContent = 'Waiting on Cutting to mark this part\'s sheet done.';
    card.appendChild(banner);
  }

  var useInventoryBox = buildUseInventoryCheckbox(entry);
  if (useInventoryBox) card.appendChild(useInventoryBox);

  var moveControl = buildMoveToInventoryControl(entry);
  if (moveControl) card.appendChild(moveControl);

  checkbox.addEventListener('change', function (e) {
    var useFromInventory = !!(useInventoryBox && useInventoryBox._checkbox.checked);
    toggleBendingEntry(entry.index, e.target.checked, useFromInventory);
  });

  return card;
}

// Every plan entry - required part or plan-level "extra" output alike - can
// have some (or all) of its pending qty moved to the Leftover Ledger, for
// whenever a run produced more than this PO actually needed. Only offered
// while there's a sheet done to move FROM and the part isn't already bent -
// once fully moved, the entry drops out of the list entirely (server-side).
function buildMoveToInventoryControl(entry) {
  if (entry.done || !entry.unlocked || !(entry.totalQty > 0)) return null;

  var wrap = document.createElement('div');
  wrap.className = 'field-row';
  wrap.style.flexDirection = 'row';
  wrap.style.marginTop = 'var(--space-3)';
  wrap.style.marginBottom = '0';
  wrap.style.alignItems = 'center';
  wrap.style.flexWrap = 'wrap';
  wrap.style.gap = '8px';

  var qtyInput = document.createElement('input');
  qtyInput.type = 'number';
  qtyInput.min = '1';
  qtyInput.max = String(entry.totalQty);
  qtyInput.placeholder = 'Qty';
  qtyInput.style.maxWidth = '90px';
  qtyInput.disabled = !canEdit('bendingStage');

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-secondary';
  btn.textContent = 'Move to Extra Inventory';
  btn.disabled = !canEdit('bendingStage');
  btn.addEventListener('click', function () {
    var qty = Number(qtyInput.value);
    if (!(qty > 0)) {
      showFatalError('Enter a quantity greater than zero.');
      return;
    }
    if (qty > entry.totalQty) {
      showFatalError('Only ' + entry.totalQty + ' pcs left to move.');
      return;
    }
    moveEntryQtyToInventory(entry.index, qty, btn);
  });

  wrap.appendChild(qtyInput);
  wrap.appendChild(btn);
  return wrap;
}

function moveEntryQtyToInventory(entryIndex, qty, btn) {
  if (!canEdit('bendingStage')) {
    showFatalError('View only - ask an admin for edit access to change this.');
    return;
  }
  btn.disabled = true;
  apiPost('moveEntryQtyToInventory', {
    poNumber: currentBendingQueue.poNumber,
    entryIndex: entryIndex,
    qty: qty
  }).then(function (result) {
    if (!result.ok) {
      btn.disabled = false;
      showFatalError(result.error);
      return;
    }
    currentBendingQueue = result.data;
    renderBendingStatusPill();
    renderBendingEntries();
  }).catch(function (err) {
    btn.disabled = false;
    showFatalError(err);
  });
}

function toggleBendingEntry(entryIndex, completed, useFromInventory) {
  if (!canEdit('bendingStage')) {
    showFatalError('View only - ask an admin for edit access to mark parts done.');
    renderBendingEntries();
    return;
  }
  var payload = { poNumber: currentBendingQueue.poNumber, entryIndex: entryIndex, completed: completed };
  if (completed && useFromInventory) payload.useFromInventory = true;
  apiPost('setBendingComplete', payload).then(function (result) {
    if (!result.ok) {
      showFatalError(result.error);
      renderBendingEntries();
      return;
    }
    currentBendingQueue = result.data;
    renderBendingStatusPill();
    renderBendingEntries();
  }).catch(function (err) {
    showFatalError(err);
    renderBendingEntries();
  });
}

// Extra parts logged during cutting (Cutting Stage's Extras tab) - each is
// its own bending task, separate from the plan's own entries above, tracked
// by a stable extraKey (see Bending.gs's getExtraBendingEntries) instead of
// a positional index. Always unlocked - the part's already been physically
// cut by the time it's logged as an extra.
function renderExtraBendingEntries() {
  var section = el('bending-extra-section');
  var body = el('bending-extra-entries-body');
  if (!section || !body) return;
  body.innerHTML = '';

  var extraEntries = currentBendingQueue.extraEntries || [];
  if (extraEntries.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  extraEntries.forEach(function (entry) {
    body.appendChild(buildExtraBendingEntryCard(entry));
  });
}

function buildExtraBendingEntryCard(entry) {
  var card = document.createElement('div');
  card.className = 'cs-sheet-card' + (entry.done ? ' done' : '');

  var label = document.createElement('label');
  label.className = 'cs-sheet-done-label';

  var checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = entry.done;
  checkbox.disabled = !canEdit('bendingStage');

  var text = document.createElement('span');
  var sizeTag = entry.isFromInventory
    ? ' [from Extra Inventory]'
    : (entry.isExtra ? ' [extra' + (entry.size ? ', ' + entry.size : '') + ']' : '');
  text.innerHTML = '<strong>' + entry.partName + sizeTag + '</strong> × ' + formatBendingQtyText(entry) + ' <span class="muted">— ' + entry.sheetLabel + '</span>';

  label.appendChild(checkbox);
  label.appendChild(text);
  card.appendChild(label);

  var useInventoryBox = buildUseInventoryCheckbox(entry);
  if (useInventoryBox) card.appendChild(useInventoryBox);

  // Second chance for whoever didn't check "Also add to Extra Part
  // Inventory" back in Cutting Stage's logging form - a one-time action,
  // hidden once it's actually been added (either from there, or from a
  // previous click here).
  if (!entry.alreadyInInventory) {
    var addToInventoryBtn = document.createElement('button');
    addToInventoryBtn.type = 'button';
    addToInventoryBtn.className = 'btn-secondary';
    addToInventoryBtn.style.marginTop = 'var(--space-3)';
    addToInventoryBtn.textContent = 'Add to Extra Part Inventory';
    addToInventoryBtn.disabled = !canEdit('bendingStage');
    addToInventoryBtn.addEventListener('click', function () {
      addExtraToInventoryNow(entry.extraKey, addToInventoryBtn);
    });
    card.appendChild(addToInventoryBtn);
  }

  checkbox.addEventListener('change', function (e) {
    var useFromInventory = !!(useInventoryBox && useInventoryBox._checkbox.checked);
    toggleExtraBendingEntry(entry.extraKey, e.target.checked, useFromInventory);
  });

  return card;
}

function addExtraToInventoryNow(extraKey, btn) {
  if (!canEdit('bendingStage')) {
    showFatalError('View only - ask an admin for edit access to change this.');
    return;
  }
  btn.disabled = true;
  apiPost('addExtraToInventoryNow', {
    poNumber: currentBendingQueue.poNumber,
    extraKey: extraKey
  }).then(function (result) {
    if (!result.ok) {
      btn.disabled = false;
      showFatalError(result.error);
      return;
    }
    // Server doesn't return the full queue here (unlike the completion
    // actions) - just re-fetch it so alreadyInInventory reflects the change.
    openBendingOrder(currentBendingQueue.poNumber);
  }).catch(function (err) {
    btn.disabled = false;
    showFatalError(err);
  });
}

function toggleExtraBendingEntry(extraKey, completed, useFromInventory) {
  if (!canEdit('bendingStage')) {
    showFatalError('View only - ask an admin for edit access to mark parts done.');
    renderExtraBendingEntries();
    return;
  }
  var payload = { poNumber: currentBendingQueue.poNumber, extraKey: extraKey, completed: completed };
  if (completed && useFromInventory) payload.useFromInventory = true;
  apiPost('setExtraBendingComplete', payload).then(function (result) {
    if (!result.ok) {
      showFatalError(result.error);
      renderExtraBendingEntries();
      return;
    }
    currentBendingQueue = result.data;
    renderBendingStatusPill();
    renderExtraBendingEntries();
  }).catch(function (err) {
    showFatalError(err);
    renderExtraBendingEntries();
  });
}

// Lets the bender pull surplus stock (already sitting in the Leftover
// Ledger for this order's model, or the cross-model Universal bucket) into
// this PO's bending list - useful when Cutting hasn't finished (or even
// started) that part's own sheet yet, but stock already exists from a prior
// order's surplus.
function openPullInventoryModal() {
  var list = el('pull-inventory-list');
  var empty = el('pull-inventory-empty');
  list.innerHTML = '';

  var avail = (currentBendingQueue && currentBendingQueue.availableInventory) || [];
  if (avail.length === 0) {
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    avail.forEach(function (row) {
      list.appendChild(buildPullInventoryRow(row));
    });
  }
  el('pull-inventory-overlay').style.display = 'flex';
}

function buildPullInventoryRow(row) {
  var wrap = document.createElement('div');
  wrap.className = 'field-row';
  wrap.style.flexDirection = 'row';
  wrap.style.alignItems = 'center';
  wrap.style.flexWrap = 'wrap';
  wrap.style.gap = '8px';
  wrap.style.marginBottom = 'var(--space-3)';

  var label = document.createElement('span');
  label.style.flex = '1';
  label.innerHTML = '<strong>' + row.partName + '</strong>' + (row.size ? ' (' + row.size + ')' : '') +
    (row.modelName === 'Universal' ? ' <span class="muted">[Universal]</span>' : '') +
    ' <span class="muted">— ' + row.qty + ' available</span>';

  var qtyInput = document.createElement('input');
  qtyInput.type = 'number';
  qtyInput.min = '1';
  qtyInput.max = String(row.qty);
  qtyInput.placeholder = 'Qty';
  qtyInput.style.maxWidth = '80px';
  qtyInput.disabled = !canEdit('bendingStage');

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-primary';
  btn.textContent = 'Pull';
  btn.disabled = !canEdit('bendingStage');
  btn.addEventListener('click', function () {
    var qty = Number(qtyInput.value);
    if (!(qty > 0)) {
      showFatalError('Enter a quantity greater than zero.');
      return;
    }
    if (qty > row.qty) {
      showFatalError('Only ' + row.qty + ' pcs available.');
      return;
    }
    pullFromExtraInventory(row, qty, btn);
  });

  wrap.appendChild(label);
  wrap.appendChild(qtyInput);
  wrap.appendChild(btn);
  return wrap;
}

function pullFromExtraInventory(row, qty, btn) {
  if (!canEdit('bendingStage')) {
    showFatalError('View only - ask an admin for edit access to change this.');
    return;
  }
  btn.disabled = true;
  apiPost('pullFromExtraInventory', {
    poNumber: currentBendingQueue.poNumber,
    modelName: row.modelName,
    partName: row.partName,
    size: row.size,
    qty: qty
  }).then(function (result) {
    if (!result.ok) {
      btn.disabled = false;
      showFatalError(result.error);
      return;
    }
    currentBendingQueue = result.data;
    el('pull-inventory-overlay').style.display = 'none';
    renderBendingStatusPill();
    renderBendingEntries();
    renderExtraBendingEntries();
  }).catch(function (err) {
    btn.disabled = false;
    showFatalError(err);
  });
}

function markAllBendingComplete() {
  if (!canEdit('bendingStage')) {
    alert('View only - ask an admin for edit access to mark parts done.');
    return;
  }
  if (!confirm('Mark every currently-available part (including any extra parts) for ' + currentBendingQueue.poNumber + ' as bent?')) return;
  apiPost('markAllBendingComplete', { poNumber: currentBendingQueue.poNumber }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    currentBendingQueue = result.data;
    renderBendingStatusPill();
    renderBendingEntries();
    renderExtraBendingEntries();
  }).catch(showFatalError);
}

document.addEventListener('DOMContentLoaded', function () {
  requireAuth().then(function () {
    renderSideNav('bendingStage');
    initBendingStage();
  });
});
