var bendingTimerHandle = null;
var bendingQcState = null;

function stopBendingTimer() {
  if (bendingTimerHandle) {
    clearInterval(bendingTimerHandle);
    bendingTimerHandle = null;
  }
}

function startBendingTimer(startedAtIso) {
  stopBendingTimer();
  var startedAt = new Date(startedAtIso).getTime();

  function tick() {
    var timerEl = el('bending-timer');
    if (!timerEl) {
      stopBendingTimer();
      return;
    }
    var elapsedSec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    var m = Math.floor(elapsedSec / 60);
    var s = elapsedSec % 60;
    timerEl.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  tick();
  bendingTimerHandle = setInterval(tick, 1000);
}

function renderBendingQueueView() {
  stopBendingTimer();
  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Bending'));

  var guide = document.createElement('div');
  guide.className = 'guide-banner';
  guide.textContent = 'One part at a time. Start it, bend it, mark done, then recount before it moves on.';
  root.appendChild(guide);

  var reorderLink = document.createElement('button');
  reorderLink.className = 'btn btn-secondary add-row-btn';
  reorderLink.textContent = 'Reorder Priority';
  reorderLink.addEventListener('click', renderBendingReorderView);
  root.appendChild(reorderLink);

  apiGet('bendingQueue', { userId: currentSession.userId }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    renderBendingQueueContent(result.data);
  }).catch(showFatalError);
}

function renderBendingQueueContent(part) {
  var root = el('dashboard-root');

  if (!part) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No parts waiting. All caught up!';
    root.appendChild(empty);
    return;
  }

  var card = document.createElement('div');
  card.className = 'card';
  card.innerHTML =
    '<div class="list-row-title">' + part.partName + ' — ' + part.modelNoName + '</div>' +
    '<div class="muted">Order ' + part.orderId + (part.customerName ? ' · ' + part.customerName : '') + '</div>' +
    '<div class="muted">From sheet ' + part.sheetCode + ' · Qty ' + part.qty + ' · Target: ' + part.bendingTimeTarget + ' min' + (part.includesSetup ? ' (includes machine setup)' : '') + '</div>';
  root.appendChild(card);

  if (part.status === 'in-progress') {
    var timerCard = document.createElement('div');
    timerCard.className = 'card center-col';
    timerCard.style.marginTop = '16px';
    timerCard.innerHTML = '<div class="muted">Elapsed</div><div id="bending-timer" style="font-size:36px;font-weight:800;">00:00</div>';
    root.appendChild(timerCard);
    startBendingTimer(part.startedAt);

    var doneBtn = document.createElement('button');
    doneBtn.className = 'btn btn-primary btn-block';
    doneBtn.style.marginTop = '16px';
    doneBtn.textContent = 'Mark Done';
    doneBtn.addEventListener('click', function () { completeBending(part.queueId); });
    root.appendChild(doneBtn);
  } else {
    var startBtn = document.createElement('button');
    startBtn.className = 'btn btn-primary btn-block';
    startBtn.style.marginTop = '16px';
    startBtn.textContent = 'Start Bending';
    startBtn.addEventListener('click', function () { startBending(part.queueId); });
    root.appendChild(startBtn);
  }
}

function startBending(queueId) {
  apiPost('startBending', { userId: currentSession.userId, queueId: queueId }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    renderBendingQueueView();
  }).catch(showFatalError);
}

function completeBending(queueId) {
  stopBendingTimer();
  apiPost('completeBending', { userId: currentSession.userId, queueId: queueId }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    renderBendingQCView(result.data);
  }).catch(showFatalError);
}

function renderBendingQCView(completion) {
  bendingQcState = {
    queueId: completion.queueId,
    expectedQty: completion.expectedQty,
    checkedQty: completion.expectedQty,
    result: 'pass',
    failAction: 'recut'
  };

  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Recount — ' + completion.partName));

  var summary = document.createElement('div');
  summary.className = 'guide-banner';
  summary.textContent = 'Nice work — ' + completion.actualMinutes + ' min, ' + completion.points + ' points. Now recount before this moves on.';
  root.appendChild(summary);

  var expectedField = document.createElement('div');
  expectedField.className = 'field';
  expectedField.innerHTML = '<label>Expected Qty</label><div style="padding:10px 0;font-weight:700;">' + bendingQcState.expectedQty + '</div>';
  root.appendChild(expectedField);

  root.appendChild(buildNumberField('Actual Counted Qty', bendingQcState.checkedQty, function (v) {
    bendingQcState.checkedQty = v;
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
    { action: 'recut', label: 'Re-bend this part' },
    { action: 'continue', label: 'Continue with current qty' },
    { action: 'block', label: 'Block this part from Assembly' }
  ];

  failOptions.forEach(function (opt) {
    var btn = document.createElement('button');
    btn.className = 'btn btn-secondary btn-block';
    btn.style.marginBottom = '8px';
    btn.textContent = opt.label;
    btn.addEventListener('click', function () {
      bendingQcState.result = 'fail';
      bendingQcState.failAction = opt.action;
      submitBendingQCResult();
    });
    failActionWrap.appendChild(btn);
  });

  passBtn.addEventListener('click', function () {
    bendingQcState.result = 'pass';
    submitBendingQCResult();
  });

  failBtn.addEventListener('click', function () {
    failActionWrap.style.display = 'block';
  });
}

function submitBendingQCResult() {
  apiPost('submitBendingQC', {
    userId: currentSession.userId,
    queueId: bendingQcState.queueId,
    checkedQty: bendingQcState.checkedQty,
    expectedQty: bendingQcState.expectedQty,
    result: bendingQcState.result,
    failAction: bendingQcState.failAction
  }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    var data = result.data;
    var msg;
    if (data.result === 'pass' || data.failAction === 'continue') {
      msg = 'Passed — ready for Assembly.';
    } else if (data.failAction === 'recut') {
      msg = 'Queued for re-bend.';
    } else {
      msg = 'Blocked from Assembly.';
    }
    alert(msg);
    renderBendingQueueView();
  }).catch(showFatalError);
}

function renderBendingReorderView() {
  stopBendingTimer();
  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Reorder Bending Priority'));

  var guide = document.createElement('div');
  guide.className = 'guide-banner';
  guide.textContent = 'Use the arrows to change which part bends next. Top of the list = next up.';
  root.appendChild(guide);

  apiGet('bendingUnlockedList', { userId: currentSession.userId }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    renderBendingReorderList(result.data);
  }).catch(showFatalError);
}

function renderBendingReorderList(items) {
  var root = el('dashboard-root');

  if (items.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Nothing waiting in the bending queue.';
    root.appendChild(empty);
    return;
  }

  var listWrap = document.createElement('div');
  root.appendChild(listWrap);

  function renderList() {
    listWrap.innerHTML = '';
    items.forEach(function (item, i) {
      var row = document.createElement('div');
      row.className = 'card list-row';
      row.style.flexDirection = 'row';
      row.style.alignItems = 'center';
      row.style.justifyContent = 'space-between';

      var info = document.createElement('div');
      info.innerHTML = '<div class="list-row-title">' + item.partName + '</div><div class="muted">Order ' + item.orderId + ' · Sheet ' + item.sheetCode + '</div>';

      var controls = document.createElement('div');
      controls.style.display = 'flex';
      controls.style.gap = '6px';

      var upBtn = document.createElement('button');
      upBtn.className = 'btn btn-secondary';
      upBtn.style.minHeight = '44px';
      upBtn.style.padding = '8px 14px';
      upBtn.textContent = '↑';
      upBtn.disabled = i === 0;
      upBtn.addEventListener('click', function () {
        items.splice(i - 1, 0, items.splice(i, 1)[0]);
        renderList();
      });

      var downBtn = document.createElement('button');
      downBtn.className = 'btn btn-secondary';
      downBtn.style.minHeight = '44px';
      downBtn.style.padding = '8px 14px';
      downBtn.textContent = '↓';
      downBtn.disabled = i === items.length - 1;
      downBtn.addEventListener('click', function () {
        items.splice(i + 1, 0, items.splice(i, 1)[0]);
        renderList();
      });

      controls.appendChild(upBtn);
      controls.appendChild(downBtn);
      row.appendChild(info);
      row.appendChild(controls);
      listWrap.appendChild(row);
    });
  }

  renderList();

  var saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary btn-block';
  saveBtn.style.marginTop = '16px';
  saveBtn.textContent = 'Save Order';
  saveBtn.addEventListener('click', function () {
    apiPost('reorderBending', {
      userId: currentSession.userId,
      orderedQueueIds: items.map(function (i) { return i.queueId; })
    }).then(function (result) {
      if (!result.ok) return showFatalError(result.error);
      renderBendingQueueView();
    }).catch(showFatalError);
  });
  root.appendChild(saveBtn);
}
