var powderState = null;

function renderPowderView() {
  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Powder Coating'));

  var guide = document.createElement('div');
  guide.className = 'guide-banner';
  guide.textContent = 'Pick a batch, log where the powder comes from, then weigh in the leftover when done.';
  root.appendChild(guide);

  Promise.all([
    apiGet('powderStockSummary', { userId: currentSession.userId }),
    apiGet('powderQueue', { userId: currentSession.userId })
  ]).then(function (results) {
    var stockResult = results[0];
    var queueResult = results[1];
    if (!stockResult.ok) return showFatalError(stockResult.error);
    if (!queueResult.ok) return showFatalError(queueResult.error);
    renderPowderStockSummary(stockResult.data);
    renderPowderQueueList(queueResult.data);
  }).catch(showFatalError);
}

function renderPowderStockSummary(stock) {
  var root = el('dashboard-root');
  var card = document.createElement('div');
  card.className = 'card';
  var mainLine = stock.mainStock.length
    ? stock.mainStock.map(function (s) { return s.colour + ': ' + s.currentKg + 'kg'; }).join(', ')
    : 'No main stock recorded yet.';
  var personalLine = stock.personalStock.length
    ? stock.personalStock.map(function (s) { return s.colour + ': ' + s.currentKg + 'kg'; }).join(', ')
    : 'None yet.';
  card.innerHTML =
    '<div class="muted">Main Stock</div><div class="list-row-title">' + mainLine + '</div>' +
    '<div class="muted" style="margin-top:10px;">Your Stock</div><div class="list-row-title">' + personalLine + '</div>';
  root.appendChild(card);
}

function renderPowderQueueList(items) {
  var root = el('dashboard-root');

  if (items.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No pending batches.';
    root.appendChild(empty);
    return;
  }

  items.forEach(function (item) {
    var card = document.createElement('div');
    card.className = 'card list-row';
    card.innerHTML =
      '<div class="list-row-title">' + item.orderId + ' — ' + item.modelNoName + ' (' + item.colour + ')</div>' +
      '<div class="muted">Qty ' + item.qty + (item.customerName ? ' · ' + item.customerName : '') + ' · ' + item.status + '</div>';
    card.addEventListener('click', function () {
      if (item.status === 'pending') {
        renderPowderStartForm(item);
      } else {
        renderPowderCompleteForm(item);
      }
    });
    root.appendChild(card);
  });
}

function renderPowderStartForm(item) {
  powderState = { queueId: item.queueId, fromMainStockKg: 0, fromPersonalStockKg: 0 };

  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Start Batch — ' + item.colour));

  var card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<div class="list-row-title">' + item.orderId + ' — ' + item.modelNoName + '</div><div class="muted">Qty ' + item.qty + '</div>';
  root.appendChild(card);

  root.appendChild(buildNumberField('From Main Stock (kg)', powderState.fromMainStockKg, function (v) {
    powderState.fromMainStockKg = v;
  }));
  root.appendChild(buildNumberField('From Your Stock (kg)', powderState.fromPersonalStockKg, function (v) {
    powderState.fromPersonalStockKg = v;
  }));

  var startBtn = document.createElement('button');
  startBtn.className = 'btn btn-primary btn-block';
  startBtn.textContent = 'Start Batch';
  startBtn.addEventListener('click', function () {
    apiPost('startPowderBatch', {
      userId: currentSession.userId,
      queueId: powderState.queueId,
      fromMainStockKg: powderState.fromMainStockKg,
      fromPersonalStockKg: powderState.fromPersonalStockKg
    }).then(function (result) {
      if (!result.ok) return showFatalError(result.error);
      renderPowderView();
    }).catch(showFatalError);
  });
  root.appendChild(startBtn);
}

function renderPowderCompleteForm(item) {
  powderState = { queueId: item.queueId, leftoverKg: 0 };

  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Finish Batch — ' + item.colour));

  var card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<div class="list-row-title">' + item.orderId + ' — ' + item.modelNoName + '</div><div class="muted">Qty ' + item.qty + '</div>';
  root.appendChild(card);

  root.appendChild(buildNumberField('Leftover Powder (kg)', powderState.leftoverKg, function (v) {
    powderState.leftoverKg = v;
  }));

  var completeBtn = document.createElement('button');
  completeBtn.className = 'btn btn-primary btn-block';
  completeBtn.textContent = 'Complete Batch';
  completeBtn.addEventListener('click', function () {
    apiPost('completePowderBatch', {
      userId: currentSession.userId,
      queueId: powderState.queueId,
      leftoverKg: powderState.leftoverKg
    }).then(function (result) {
      if (!result.ok) return showFatalError(result.error);
      alert('Batch complete. ' + result.data.leftoverKg + 'kg added to your stock.');
      renderPowderView();
    }).catch(showFatalError);
  });
  root.appendChild(completeBtn);
}
