var assemblyTimerHandle = null;
var assemblyState = null;

function stopAssemblyTimer() {
  if (assemblyTimerHandle) {
    clearInterval(assemblyTimerHandle);
    assemblyTimerHandle = null;
  }
}

function startAssemblyTimer(startedAtIso) {
  stopAssemblyTimer();
  var startedAt = new Date(startedAtIso).getTime();

  function tick() {
    var timerEl = el('assembly-timer');
    if (!timerEl) {
      stopAssemblyTimer();
      return;
    }
    var elapsedSec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    var m = Math.floor(elapsedSec / 60);
    var s = elapsedSec % 60;
    timerEl.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  tick();
  assemblyTimerHandle = setInterval(tick, 1000);
}

function renderAssemblyView() {
  stopAssemblyTimer();
  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Assembling'));

  var guide = document.createElement('div');
  guide.className = 'guide-banner';
  guide.textContent = 'Orders appear here once every part has been bent and passed QC.';
  root.appendChild(guide);

  apiGet('readyAssemblyOrders', { userId: currentSession.userId }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    renderAssemblyOrderList(result.data);
  }).catch(showFatalError);
}

function renderAssemblyOrderList(orders) {
  var root = el('dashboard-root');

  if (orders.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No orders ready for assembly yet.';
    root.appendChild(empty);
    return;
  }

  orders.forEach(function (o) {
    var card = document.createElement('div');
    card.className = 'card list-row';
    card.innerHTML =
      '<div class="list-row-title">' + o.orderId + ' — ' + o.modelNoName + '</div>' +
      '<div class="muted">Qty ' + o.qty + (o.customerName ? ' · ' + o.customerName : '') + ' · Target: ' + o.assemblyTimeTarget + ' min</div>';
    card.addEventListener('click', function () { renderAssemblyOrderDetail(o.orderId); });
    root.appendChild(card);
  });
}

function renderAssemblyOrderDetail(orderId) {
  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Assemble Order'));

  apiGet('assemblyOrderDetail', { userId: currentSession.userId, orderId: orderId }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    renderAssemblyDetailContent(result.data);
  }).catch(showFatalError);
}

function renderAssemblyDetailContent(detail) {
  var root = el('dashboard-root');

  var card = document.createElement('div');
  card.className = 'card';
  card.innerHTML =
    '<div class="list-row-title">' + detail.orderId + ' — ' + detail.modelNoName + '</div>' +
    '<div class="muted">Qty ' + detail.qty + (detail.customerName ? ' · ' + detail.customerName : '') + ' · Target: ' + detail.assemblyTimeTarget + ' min</div>';
  root.appendChild(card);

  if (detail.shortages.length > 0) {
    var alertBanner = document.createElement('div');
    alertBanner.className = 'alert-banner';
    alertBanner.textContent = 'Inventory short: ' + detail.shortages.map(function (s) {
      return s.item + ' (need ' + s.needed + ', have ' + s.available + ')';
    }).join(', ') + '. You can still proceed.';
    root.appendChild(alertBanner);
  }

  var bomTitle = document.createElement('div');
  bomTitle.className = 'section-title';
  bomTitle.textContent = 'Planned Materials';
  root.appendChild(bomTitle);

  var bomCard = document.createElement('div');
  bomCard.className = 'card';
  var bomItems = Object.keys(detail.plannedBOM);
  bomCard.innerHTML = bomItems.length
    ? bomItems.map(function (item) { return item + ': ' + detail.plannedBOM[item]; }).join('<br>')
    : '<span class="muted">No BOM configured for this model.</span>';
  root.appendChild(bomCard);

  var startBtn = document.createElement('button');
  startBtn.className = 'btn btn-primary btn-block';
  startBtn.style.marginTop = '16px';
  startBtn.textContent = 'Start Assembly';
  startBtn.addEventListener('click', function () {
    apiPost('startAssembly', { userId: currentSession.userId, orderId: detail.orderId }).then(function (result) {
      if (!result.ok) return showFatalError(result.error);
      renderAssemblyInProgress(result.data);
    }).catch(showFatalError);
  });
  root.appendChild(startBtn);
}

function renderAssemblyInProgress(data) {
  assemblyState = { logId: data.logId, orderId: data.orderId, plannedBOM: data.plannedBOM, actualBOM: Object.assign({}, data.plannedBOM) };

  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Assembling ' + data.orderId));

  var timerCard = document.createElement('div');
  timerCard.className = 'card center-col';
  timerCard.innerHTML = '<div class="muted">Elapsed</div><div id="assembly-timer" style="font-size:36px;font-weight:800;">00:00</div>';
  root.appendChild(timerCard);
  startAssemblyTimer(data.startedAt);

  var doneBtn = document.createElement('button');
  doneBtn.className = 'btn btn-primary btn-block';
  doneBtn.style.marginTop = '16px';
  doneBtn.textContent = 'Mark Done';
  doneBtn.addEventListener('click', function () {
    stopAssemblyTimer();
    renderAssemblyBOMConfirm();
  });
  root.appendChild(doneBtn);
}

function renderAssemblyBOMConfirm() {
  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Confirm Materials Used'));

  var guide = document.createElement('div');
  guide.className = 'guide-banner';
  guide.textContent = 'Adjust any quantities that differ from the plan, then confirm.';
  root.appendChild(guide);

  Object.keys(assemblyState.plannedBOM).forEach(function (item) {
    root.appendChild(buildNumberField(item, assemblyState.actualBOM[item], function (v) {
      assemblyState.actualBOM[item] = v;
    }));
  });

  var confirmBtn = document.createElement('button');
  confirmBtn.className = 'btn btn-primary btn-block';
  confirmBtn.textContent = 'Confirm & Complete';
  confirmBtn.addEventListener('click', function () {
    var actualBOM = {};
    Object.keys(assemblyState.actualBOM).forEach(function (item) {
      actualBOM[item] = Number(assemblyState.actualBOM[item]) || 0;
    });

    apiPost('completeAssembly', {
      userId: currentSession.userId,
      logId: assemblyState.logId,
      actualBOM: actualBOM
    }).then(function (result) {
      if (!result.ok) return showFatalError(result.error);
      var msg = result.data.shortages.length
        ? 'Assembly complete. Now short on: ' + result.data.shortages.join(', ')
        : 'Assembly complete.';
      alert(msg);
      renderAssemblyView();
    }).catch(showFatalError);
  });
  root.appendChild(confirmBtn);
}
