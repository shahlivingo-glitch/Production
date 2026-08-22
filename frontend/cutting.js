var cuttingTimerHandle = null;
var cuttingQcState = null;

function stopCuttingTimer() {
  if (cuttingTimerHandle) {
    clearInterval(cuttingTimerHandle);
    cuttingTimerHandle = null;
  }
}

function startCuttingTimer(startedAtIso) {
  stopCuttingTimer();
  var startedAt = new Date(startedAtIso).getTime();

  function tick() {
    var timerEl = el('cutting-timer');
    if (!timerEl) {
      stopCuttingTimer();
      return;
    }
    var elapsedSec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    var m = Math.floor(elapsedSec / 60);
    var s = elapsedSec % 60;
    timerEl.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  tick();
  cuttingTimerHandle = setInterval(tick, 1000);
}

function renderCuttingQueueView() {
  stopCuttingTimer();
  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Cutting'));

  var guide = document.createElement('div');
  guide.className = 'guide-banner';
  guide.textContent = 'One sheet at a time. Start it, cut it, mark done, then recount before it moves to Bending.';
  root.appendChild(guide);

  apiGet('cuttingQueue', { userId: currentSession.userId }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    renderCuttingQueueContent(result.data);
  }).catch(showFatalError);
}

function renderCuttingQueueContent(sheet) {
  var root = el('dashboard-root');

  if (!sheet) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No sheets waiting. All caught up!';
    root.appendChild(empty);
    return;
  }

  var card = document.createElement('div');
  card.className = 'card';
  card.innerHTML =
    '<div class="list-row-title">Sheet ' + sheet.sheetCode + ' — ' + sheet.modelNoName + '</div>' +
    '<div class="muted">Order ' + sheet.orderId + (sheet.customerName ? ' · ' + sheet.customerName : '') + '</div>' +
    '<div class="muted"><strong>Unit ' + sheet.unitIndex + ' of ' + sheet.totalUnits + '</strong></div>' +
    '<div class="muted">Target: ' + sheet.cuttingTimeTarget + ' min · This sheet yields: ' + sheet.parts.join(', ') + '</div>';
  root.appendChild(card);

  if (sheet.status === 'in-progress') {
    var timerCard = document.createElement('div');
    timerCard.className = 'card center-col';
    timerCard.style.marginTop = '16px';
    timerCard.innerHTML = '<div class="muted">Elapsed</div><div id="cutting-timer" style="font-size:36px;font-weight:800;">00:00</div>';
    root.appendChild(timerCard);
    startCuttingTimer(sheet.startedAt);

    var doneBtn = document.createElement('button');
    doneBtn.className = 'btn btn-primary btn-block';
    doneBtn.style.marginTop = '16px';
    doneBtn.textContent = 'Mark Done';
    doneBtn.addEventListener('click', function () { completeCutting(sheet.logId); });
    root.appendChild(doneBtn);
  } else {
    var startBtn = document.createElement('button');
    startBtn.className = 'btn btn-primary btn-block';
    startBtn.style.marginTop = '16px';
    startBtn.textContent = 'Start Cutting';
    startBtn.addEventListener('click', function () { startCutting(sheet.logId); });
    root.appendChild(startBtn);
  }
}

function startCutting(logId) {
  apiPost('startCutting', { userId: currentSession.userId, logId: logId }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    renderCuttingQueueView();
  }).catch(showFatalError);
}

function completeCutting(logId) {
  stopCuttingTimer();
  apiPost('completeCutting', { userId: currentSession.userId, logId: logId }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    renderCuttingQCView(result.data);
  }).catch(showFatalError);
}

function renderCuttingQCView(completion) {
  cuttingQcState = {
    logId: completion.logId,
    expectedQty: completion.expectedQty,
    checkedQty: completion.expectedQty,
    result: 'pass',
    failAction: 'recut'
  };

  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Recount — Sheet ' + completion.sheetCode));

  var summary = document.createElement('div');
  summary.className = 'guide-banner';
  summary.textContent = 'Nice work — ' + completion.actualMinutes + ' min, ' + completion.points + ' points. Now recount the parts before this moves on.';
  root.appendChild(summary);

  var partsCard = document.createElement('div');
  partsCard.className = 'card';
  partsCard.innerHTML = '<div class="muted">Parts on this sheet</div><div class="list-row-title">' + completion.parts.join(', ') + '</div>';
  root.appendChild(partsCard);

  var expectedField = document.createElement('div');
  expectedField.className = 'field';
  expectedField.innerHTML = '<label>Expected Qty</label><div style="padding:10px 0;font-weight:700;">' + cuttingQcState.expectedQty + '</div>';
  root.appendChild(expectedField);

  root.appendChild(buildNumberField('Actual Counted Qty', cuttingQcState.checkedQty, function (v) {
    cuttingQcState.checkedQty = v;
  }));

  var resultTitle = document.createElement('div');
  resultTitle.className = 'section-title';
  resultTitle.textContent = 'Result';
  root.appendChild(resultTitle);

  var resultRow = document.createElement('div');
  resultRow.style.display = 'flex';
  resultRow.style.gap = '10px';
  resultRow.style.marginBottom = '10px';

  var passBtn = document.createElement('button');
  passBtn.className = 'btn btn-primary';
  passBtn.style.flex = '1';
  passBtn.textContent = 'Pass';

  var failBtn = document.createElement('button');
  failBtn.className = 'btn btn-danger';
  failBtn.style.flex = '1';
  failBtn.textContent = 'Fail';

  resultRow.appendChild(passBtn);
  resultRow.appendChild(failBtn);
  root.appendChild(resultRow);

  var failActionWrap = document.createElement('div');
  failActionWrap.style.display = 'none';
  root.appendChild(failActionWrap);

  var failOptions = [
    { action: 'recut', label: 'Re-cut this sheet' },
    { action: 'continue', label: 'Continue with current qty' },
    { action: 'block', label: 'Block bending for this sheet' }
  ];

  failOptions.forEach(function (opt) {
    var btn = document.createElement('button');
    btn.className = 'btn btn-secondary btn-block';
    btn.style.marginBottom = '8px';
    btn.textContent = opt.label;
    btn.addEventListener('click', function () {
      cuttingQcState.result = 'fail';
      cuttingQcState.failAction = opt.action;
      submitCuttingQCResult();
    });
    failActionWrap.appendChild(btn);
  });

  passBtn.addEventListener('click', function () {
    cuttingQcState.result = 'pass';
    submitCuttingQCResult();
  });

  failBtn.addEventListener('click', function () {
    failActionWrap.style.display = 'block';
  });
}

function submitCuttingQCResult() {
  apiPost('submitCuttingQC', {
    userId: currentSession.userId,
    logId: cuttingQcState.logId,
    checkedQty: cuttingQcState.checkedQty,
    expectedQty: cuttingQcState.expectedQty,
    result: cuttingQcState.result,
    failAction: cuttingQcState.failAction
  }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    var data = result.data;
    var msg;
    if (data.result === 'pass' || data.failAction === 'continue') {
      msg = data.pushedParts.length + ' part(s) sent to Bending.';
    } else if (data.failAction === 'recut') {
      msg = 'Queued for re-cut.';
    } else {
      msg = 'Blocked — bending not started for this sheet.';
    }
    alert(msg);
    renderCuttingQueueView();
  }).catch(showFatalError);
}
