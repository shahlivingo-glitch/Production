var fittingTimerHandle = null;
var fittingState = null;

function stopFittingTimer() {
  if (fittingTimerHandle) {
    clearInterval(fittingTimerHandle);
    fittingTimerHandle = null;
  }
}

function startFittingTimer(startedAtIso) {
  stopFittingTimer();
  var startedAt = new Date(startedAtIso).getTime();

  function tick() {
    var timerEl = el('fitting-timer');
    if (!timerEl) {
      stopFittingTimer();
      return;
    }
    var elapsedSec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    var m = Math.floor(elapsedSec / 60);
    var s = elapsedSec % 60;
    timerEl.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  tick();
  fittingTimerHandle = setInterval(tick, 1000);
}

function renderFittingView() {
  stopFittingTimer();
  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Fitting'));

  var guide = document.createElement('div');
  guide.className = 'guide-banner';
  guide.textContent = 'Orders appear here once all powder coating batches are done. All unused kit material must go back to store when finished.';
  root.appendChild(guide);

  apiGet('readyFittingOrders', { userId: currentSession.userId }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    renderFittingOrderList(result.data);
  }).catch(showFatalError);
}

function renderFittingOrderList(orders) {
  var root = el('dashboard-root');

  if (orders.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No orders ready for fitting yet.';
    root.appendChild(empty);
    return;
  }

  orders.forEach(function (o) {
    var card = document.createElement('div');
    card.className = 'card list-row';
    card.innerHTML =
      '<div class="list-row-title">' + o.orderId + ' — ' + o.modelNoName + '</div>' +
      '<div class="muted">' + o.unitsFitted + ' of ' + o.qty + ' fitted' + (o.customerName ? ' · ' + o.customerName : '') + '</div>' +
      '<div class="muted">Target: ' + o.fittingTimeTarget + ' min' + (o.unitsFitted === 0 ? ' (first unit includes machine setup)' : ' per unit') + '</div>';
    card.addEventListener('click', function () { renderFittingOrderDetail(o.orderId); });
    root.appendChild(card);
  });
}

function renderFittingOrderDetail(orderId) {
  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Fit Order'));

  apiGet('fittingOrderDetail', { userId: currentSession.userId, orderId: orderId }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    renderFittingDetailContent(result.data);
  }).catch(showFatalError);
}

function renderFittingDetailContent(detail) {
  var root = el('dashboard-root');

  var card = document.createElement('div');
  card.className = 'card';
  card.innerHTML =
    '<div class="list-row-title">' + detail.orderId + ' — ' + detail.modelNoName + '</div>' +
    '<div class="muted">' + detail.unitsFitted + ' of ' + detail.qty + ' fitted' + (detail.customerName ? ' · ' + detail.customerName : '') + '</div>' +
    '<div class="muted">Target: ' + detail.fittingTimeTarget + ' min' + (detail.unitsFitted === 0 ? ' (first unit includes machine setup)' : ' per unit') + '</div>';
  root.appendChild(card);

  var kitTitle = document.createElement('div');
  kitTitle.className = 'section-title';
  kitTitle.textContent = 'Kit List (this unit)';
  root.appendChild(kitTitle);

  var kitCard = document.createElement('div');
  kitCard.className = 'card';
  var kitItems = Object.keys(detail.kitList);
  kitCard.innerHTML = kitItems.length
    ? kitItems.map(function (item) { return item + ': ' + detail.kitList[item]; }).join('<br>')
    : '<span class="muted">No BOM configured for this model.</span>';
  root.appendChild(kitCard);

  var startBtn = document.createElement('button');
  startBtn.className = 'btn btn-primary btn-block';
  startBtn.style.marginTop = '16px';
  startBtn.textContent = 'Start Fitting';
  startBtn.addEventListener('click', function () {
    apiPost('startFitting', { userId: currentSession.userId, orderId: detail.orderId }).then(function (result) {
      if (!result.ok) return showFatalError(result.error);
      renderFittingInProgress(result.data);
    }).catch(showFatalError);
  });
  root.appendChild(startBtn);
}

function renderFittingInProgress(data) {
  fittingState = { logId: data.logId, orderId: data.orderId, kitList: data.kitList, returnedQty: {} };
  Object.keys(data.kitList).forEach(function (item) { fittingState.returnedQty[item] = 0; });

  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Fitting unit ' + data.unitNumber + ' of ' + data.totalUnits));

  var timerCard = document.createElement('div');
  timerCard.className = 'card center-col';
  timerCard.innerHTML = '<div class="muted">Elapsed</div><div id="fitting-timer" style="font-size:36px;font-weight:800;">00:00</div>';
  root.appendChild(timerCard);
  startFittingTimer(data.startedAt);

  var doneBtn = document.createElement('button');
  doneBtn.className = 'btn btn-primary btn-block';
  doneBtn.style.marginTop = '16px';
  doneBtn.textContent = 'Mark Done';
  doneBtn.addEventListener('click', function () {
    stopFittingTimer();
    renderFittingReturnForm();
  });
  root.appendChild(doneBtn);
}

function renderFittingReturnForm() {
  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Return Unused Kit Material'));

  var guide = document.createElement('div');
  guide.className = 'guide-banner';
  guide.textContent = 'Enter what is going back to store for each item. Leave 0 if everything was used.';
  root.appendChild(guide);

  Object.keys(fittingState.kitList).forEach(function (item) {
    root.appendChild(buildNumberField(item + ' (issued ' + fittingState.kitList[item] + ')', fittingState.returnedQty[item], function (v) {
      fittingState.returnedQty[item] = v;
    }));
  });

  var confirmBtn = document.createElement('button');
  confirmBtn.className = 'btn btn-primary btn-block';
  confirmBtn.textContent = 'Confirm Return & Complete';
  confirmBtn.addEventListener('click', function () {
    var returnedQty = {};
    Object.keys(fittingState.returnedQty).forEach(function (item) {
      returnedQty[item] = Number(fittingState.returnedQty[item]) || 0;
    });

    apiPost('completeFitting', {
      userId: currentSession.userId,
      logId: fittingState.logId,
      returnedQty: returnedQty
    }).then(function (result) {
      if (!result.ok) return showFatalError(result.error);
      alert('Fitting complete. Return logged, awaiting checker confirmation.');
      renderFittingView();
    }).catch(showFatalError);
  });
  root.appendChild(confirmBtn);
}
