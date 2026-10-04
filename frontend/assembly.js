var pendingAssemblyOrders = [];
var currentAssembly = null;

function initAssemblyStage() {
  el('back-to-dashboard-btn').addEventListener('click', showAssemblyDashboard);
  el('assemble-done-btn').addEventListener('click', assembleDone);
  el('reset-assembly-btn').addEventListener('click', resetAssembly);
  if (!canEdit('assembly')) {
    el('assemble-done-btn').style.display = 'none';
  }
  showAssemblyDashboard();
}

function showAssemblyDashboard() {
  el('detail-view').style.display = 'none';
  el('dashboard-view').style.display = 'block';
  loadPendingAssemblyOrders();
}

function loadPendingAssemblyOrders() {
  el('pending-loading').style.display = 'flex';
  el('pending-error').style.display = 'none';
  el('pending-po-list').innerHTML = '';

  var shownCached = false;
  apiGetCached('pendingAssemblyOrders', {}, function (data) {
    shownCached = true;
    el('pending-loading').style.display = 'none';
    pendingAssemblyOrders = data;
    renderAssemblyDashboard();
  }).then(function (result) {
    el('pending-loading').style.display = 'none';
    if (!result.ok && shownCached) return;
    if (!result.ok) {
      el('pending-error').textContent = 'Could not load Ready to Assemble: ' + result.error;
      el('pending-error').style.display = 'block';
      return;
    }
    pendingAssemblyOrders = result.data;
    renderAssemblyDashboard();
  }).catch(function (err) {
    el('pending-loading').style.display = 'none';
    if (shownCached) return;
    el('pending-error').textContent = 'Could not load Ready to Assemble: ' + (err && err.message ? err.message : err);
    el('pending-error').style.display = 'block';
  });
}

function renderAssemblyDashboard() {
  el('pending-count-heading').textContent = 'Ready to Assemble (' + pendingAssemblyOrders.length + ')';
  var list = el('pending-po-list');
  list.innerHTML = '';

  if (pendingAssemblyOrders.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    // Two different reasons for an empty list, and the operator can act on
    // neither from here - so name both rather than leaving them wondering
    // whether the page is broken.
    empty.textContent = 'Nothing ready to assemble — every PO is either still in bending, or already fully assembled.';
    list.appendChild(empty);
    return;
  }

  pendingAssemblyOrders.slice().reverse().forEach(function (po) {
    var card = document.createElement('div');
    card.className = 'cs-po-card';
    card.addEventListener('click', function () { openAssemblyOrder(po.poNumber); });

    var main = document.createElement('div');
    main.className = 'cs-po-card-main';
    main.innerHTML =
      '<div class="cs-po-number">' + po.poNumber + ' — ' + po.modelName + '</div>' +
      '<div class="muted">Qty ' + po.qty + ' · ' + new Date(po.createdAt).toLocaleDateString() +
      (po.partyName ? ' · ' + po.partyName : '') + '</div>';

    var progress = document.createElement('div');
    progress.className = 'cs-po-card-sheets';
    progress.innerHTML = '<strong>' + po.assembledQty + ' / ' + po.qty + '</strong>assembled';

    card.appendChild(main);
    card.appendChild(progress);
    list.appendChild(card);
  });
}

function openAssemblyOrder(poNumber) {
  el('dashboard-view').style.display = 'none';
  el('detail-view').style.display = 'block';
  el('detail-po-title').textContent = poNumber;
  el('detail-status-pill').innerHTML = '';
  el('detail-loading').style.display = 'flex';
  el('detail-error').style.display = 'none';
  el('detail-content').style.display = 'none';

  apiGet('assemblyForOrder', { poNumber: poNumber }).then(function (result) {
    el('detail-loading').style.display = 'none';
    if (!result.ok) {
      el('detail-error').textContent = 'Could not load ' + poNumber + ': ' + result.error;
      el('detail-error').style.display = 'block';
      return;
    }
    currentAssembly = result.data;
    el('detail-content').style.display = 'block';
    renderAssemblyDetail();
  }).catch(function (err) {
    el('detail-loading').style.display = 'none';
    el('detail-error').textContent = 'Could not load ' + poNumber + ': ' + (err && err.message ? err.message : err);
    el('detail-error').style.display = 'block';
  });
}

function renderAssemblyDetail() {
  renderAssemblyStatusPill();
  renderAssemblyPoSummary();
  renderAssemblyProgress();
  renderAssemblyPartialBar();
  renderAssemblyShortfall();
  renderAssemblyLog();
  renderAssemblyActions();
}

function renderAssemblyStatusPill() {
  el('detail-status-pill').innerHTML =
    '<span class="status-pill status-' + currentAssembly.assemblyStatus + '">' +
    currentAssembly.assemblyStatus + '</span>';
}

function renderAssemblyPoSummary() {
  var box = el('po-summary');
  box.innerHTML = '';
  [
    ['Model', currentAssembly.modelName],
    ['Qty Ordered', currentAssembly.qty],
    ['Date', new Date(currentAssembly.createdAt).toLocaleString()],
    ['Party', currentAssembly.partyName || '—'],
    ['Colour', currentAssembly.colourPlan || '—'],
    ['Deadline', currentAssembly.deliveryDeadline || '—']
  ].forEach(function (f) {
    var block = document.createElement('div');
    block.className = 'field-block';
    block.innerHTML = '<label>' + f[0] + '</label><div>' + f[1] + '</div>';
    box.appendChild(block);
  });
}

function renderAssemblyProgress() {
  var host = el('assembly-progress');
  host.innerHTML = '';
  var card = document.createElement('div');
  card.className = 'cs-sheet-card' + (currentAssembly.assemblyStatus === 'complete' ? ' done' : '');
  // The headline number of the whole stage, so it is sized like one -
  // readable across a workshop rather than tucked into a 12px meta line.
  card.innerHTML =
    '<div class="assembly-count"><strong>' + currentAssembly.assembledQty + '</strong>' +
    '<span>of ' + currentAssembly.qty + ' almirahs assembled</span></div>' +
    '<div class="assembly-count-sub">' +
    (currentAssembly.remaining > 0
      ? currentAssembly.remaining + ' still to build'
      : 'Nothing left to build — this PO is complete.') + '</div>';
  host.appendChild(card);
}

// Partial entry: "I assembled 8 today". Additive, so the number typed is
// what was just built - not a running total the operator has to work out.
// Hidden once the PO is complete, since there is nothing left to add.
function renderAssemblyPartialBar() {
  var host = el('assembly-partial-bar');
  host.innerHTML = '';
  if (!canEdit('assembly') || currentAssembly.remaining <= 0) {
    host.style.display = 'none';
    return;
  }
  host.style.display = 'flex';

  var label = document.createElement('span');
  label.className = 'bend-units-label';
  label.textContent = 'Assembled now:';

  var input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.max = String(currentAssembly.remaining);
  input.value = String(currentAssembly.remaining);
  input.className = 'bend-units-input';
  input.id = 'assembly-qty-input';

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-primary';
  btn.textContent = 'Record';
  btn.addEventListener('click', function () {
    var qty = Number(input.value);
    if (!(qty > 0)) {
      showFatalError('Enter how many almirahs were assembled.');
      return;
    }
    addAssemblyProgress(qty, btn);
  });

  var note = document.createElement('span');
  note.className = 'bend-units-done';
  note.textContent = 'of ' + currentAssembly.remaining + ' remaining — adds to the ' +
    currentAssembly.assembledQty + ' already recorded';

  host.appendChild(label);
  host.appendChild(input);
  host.appendChild(btn);
  host.appendChild(note);
}

// Parts the plan never produced. Bending can read complete while these are
// outstanding (force-bend, or a part no sheet cuts), and the assembler is
// the one who hits it physically - so it is shown here, not acted on.
function renderAssemblyShortfall() {
  var host = el('assembly-shortfall');
  host.innerHTML = '';
  var rows = currentAssembly.stillToCut || [];
  if (rows.length === 0) {
    host.style.display = 'none';
    return;
  }
  host.style.display = 'block';

  var title = document.createElement('div');
  title.className = 'section-title';
  title.textContent = 'Parts Short';
  host.appendChild(title);

  var hint = document.createElement('div');
  hint.className = 'section-hint';
  hint.textContent = 'Bending is marked done for this PO, but these pieces were never produced here. Check them before assembling.';
  host.appendChild(hint);

  rows.forEach(function (r) {
    var card = document.createElement('div');
    card.className = 'cs-sheet-card still-to-cut-card';
    card.innerHTML = '<div class="cs-sheet-total-line"><strong>' + r.partName +
      '</strong> <span class="muted">— ' + r.stillToCut + ' short</span></div>';
    host.appendChild(card);
  });
}

function renderAssemblyLog() {
  var section = el('assembly-log-section');
  var body = el('assembly-log-body');
  body.innerHTML = '';
  var meta = currentAssembly.assemblyMeta || [];
  if (meta.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';

  meta.slice().reverse().forEach(function (m) {
    var row = document.createElement('div');
    row.className = 'cs-extra-row';
    row.innerHTML = '<span class="cs-extra-time">' +
      (m.at ? new Date(m.at).toLocaleString() : '') + '</span>' +
      '<span class="cs-extra-type">' + m.qty + ' assembled</span>' +
      (m.by ? ' <span class="muted">by ' + m.by + '</span>' : '');
    body.appendChild(row);
  });
}

function renderAssemblyActions() {
  var done = el('assemble-done-btn');
  if (canEdit('assembly')) {
    done.style.display = currentAssembly.remaining > 0 ? '' : 'none';
    done.textContent = currentAssembly.assembledQty > 0
      ? 'Assemble Done (' + currentAssembly.remaining + ' left)'
      : 'Assemble Done';
  }
  // Undo is admin-only and only worth showing once there is something to
  // undo - completion is what takes a PO off the floor.
  var user = getCurrentUser();
  var reset = el('reset-assembly-btn');
  reset.style.display = (user && user.role === 'admin' && currentAssembly.assembledQty > 0) ? '' : 'none';
}

function addAssemblyProgress(qty, btn) {
  if (!canEdit('assembly')) {
    showFatalError('View only - ask an admin for edit access to record assembly.');
    return;
  }
  btn.disabled = true;
  apiPost('addAssemblyProgress', {
    poNumber: currentAssembly.poNumber,
    qty: qty
  }).then(function (result) {
    btn.disabled = false;
    if (!result.ok) return showFatalError(result.error);
    currentAssembly = result.data;
    clearApiCache();
    renderAssemblyDetail();
  }).catch(function (err) {
    btn.disabled = false;
    showFatalError(err);
  });
}

// The whole remainder in one click - the common case, where the PO is
// finished in a single session and nobody wants to type its quantity.
function assembleDone() {
  if (!canEdit('assembly')) {
    alert('View only - ask an admin for edit access to record assembly.');
    return;
  }
  if (!confirm('Mark all ' + currentAssembly.remaining + ' remaining almirah(s) for ' +
      currentAssembly.poNumber + ' as assembled?')) return;

  var btn = el('assemble-done-btn');
  btn.disabled = true;
  apiPost('markAssemblyComplete', { poNumber: currentAssembly.poNumber }).then(function (result) {
    btn.disabled = false;
    if (!result.ok) return showFatalError(result.error);
    currentAssembly = result.data;
    clearApiCache();
    renderAssemblyDetail();
  }).catch(function (err) {
    btn.disabled = false;
    showFatalError(err);
  });
}

function resetAssembly() {
  if (!confirm('Clear the assembled count for ' + currentAssembly.poNumber +
      ' back to 0? This also clears its assembly log.')) return;
  var btn = el('reset-assembly-btn');
  btn.disabled = true;
  apiPost('resetAssemblyProgress', { poNumber: currentAssembly.poNumber }).then(function (result) {
    btn.disabled = false;
    if (!result.ok) return showFatalError(result.error);
    currentAssembly = result.data;
    clearApiCache();
    renderAssemblyDetail();
  }).catch(function (err) {
    btn.disabled = false;
    showFatalError(err);
  });
}

document.addEventListener('DOMContentLoaded', function () {
  requireAuth().then(function () {
    renderSideNav('assembly');
    initAssemblyStage();
  });
});
