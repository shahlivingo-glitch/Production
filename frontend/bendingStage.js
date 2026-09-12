var pendingBendingOrders = [];
var currentBendingQueue = null;

function initBendingStage() {
  el('back-to-dashboard-btn').addEventListener('click', showBendingDashboard);
  el('mark-all-complete-btn').addEventListener('click', markAllBendingComplete);
  if (!canEdit('bendingStage')) {
    el('mark-all-complete-btn').style.display = 'none';
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
    progress.innerHTML = '<strong>' + po.donePartsCount + ' / ' + po.availableParts + '</strong>parts bent' +
      (po.availableParts < po.totalPartsInPlan ? ' <span class="muted">(' + (po.totalPartsInPlan - po.availableParts) + ' more waiting on cutting)</span>' : '');

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

function renderBendingEntries() {
  var body = el('bending-entries-body');
  body.innerHTML = '';

  if (currentBendingQueue.entries.length === 0) {
    // Only the true empty state - an order can have zero plan entries but
    // still have extra-part tasks below, which get their own section/empty
    // handling in renderExtraBendingEntries.
    if (!currentBendingQueue.extraEntries || currentBendingQueue.extraEntries.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'This plan has no parts defined yet.';
      body.appendChild(empty);
    }
    return;
  }

  currentBendingQueue.entries.forEach(function (entry) {
    body.appendChild(buildBendingEntryCard(entry));
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
  text.innerHTML = '<strong>' + entry.partName + sizeTag + '</strong> × ' + entry.qty + ' <span class="muted">— from ' + entry.sheetLabel + '</span>';

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

  checkbox.addEventListener('change', function (e) {
    var useFromInventory = !!(useInventoryBox && useInventoryBox._checkbox.checked);
    toggleBendingEntry(entry.index, e.target.checked, useFromInventory);
  });

  return card;
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
  var sizeTag = entry.isExtra ? ' [extra' + (entry.size ? ', ' + entry.size : '') + ']' : '';
  text.innerHTML = '<strong>' + entry.partName + sizeTag + '</strong> × ' + entry.qty + ' <span class="muted">— ' + entry.sheetLabel + '</span>';

  label.appendChild(checkbox);
  label.appendChild(text);
  card.appendChild(label);

  var useInventoryBox = buildUseInventoryCheckbox(entry);
  if (useInventoryBox) card.appendChild(useInventoryBox);

  checkbox.addEventListener('change', function (e) {
    var useFromInventory = !!(useInventoryBox && useInventoryBox._checkbox.checked);
    toggleExtraBendingEntry(entry.extraKey, e.target.checked, useFromInventory);
  });

  return card;
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
