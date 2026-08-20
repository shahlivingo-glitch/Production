var qcCurrentStage = 'cutting';

var QC_STAGES = [
  { key: 'cutting', label: 'Cutting' },
  { key: 'bending', label: 'Bending' },
  { key: 'assembly', label: 'Assembly' },
  { key: 'powder', label: 'Powder' },
  { key: 'fitting', label: 'Fitting' }
];

function renderQCView() {
  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('QC Checker'));

  var guide = document.createElement('div');
  guide.className = 'guide-banner';
  guide.textContent = 'Pick a stage, then tap an item to check it off.';
  root.appendChild(guide);

  var tabWrap = document.createElement('div');
  tabWrap.style.display = 'flex';
  tabWrap.style.gap = '8px';
  tabWrap.style.overflowX = 'auto';
  tabWrap.style.marginBottom = '16px';

  QC_STAGES.forEach(function (s) {
    var btn = document.createElement('button');
    btn.className = 'btn ' + (s.key === qcCurrentStage ? 'btn-primary' : 'btn-secondary');
    btn.style.flex = '0 0 auto';
    btn.style.minHeight = '44px';
    btn.style.padding = '10px 16px';
    btn.textContent = s.label;
    btn.addEventListener('click', function () {
      qcCurrentStage = s.key;
      renderQCView();
    });
    tabWrap.appendChild(btn);
  });
  root.appendChild(tabWrap);

  var listWrap = document.createElement('div');
  listWrap.id = 'qc-list-wrap';
  root.appendChild(listWrap);

  loadQCList();
}

function loadQCList() {
  apiGet('checkerQueue', { userId: currentSession.userId, stage: qcCurrentStage }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    renderQCList(result.data);
  }).catch(showFatalError);
}

function renderQCList(items) {
  var wrap = el('qc-list-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  if (items.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Nothing to check here right now.';
    wrap.appendChild(empty);
    return;
  }

  if (qcCurrentStage === 'cutting' || qcCurrentStage === 'bending') {
    items.forEach(function (item) {
      var card = document.createElement('div');
      card.className = 'card list-row';
      card.innerHTML =
        '<div class="list-row-title">' + item.orderId + ' — ' + item.ref + '</div>' +
        '<div class="muted">Result: ' + item.result + (item.failAction ? ' (' + item.failAction + ')' : '') + ' · by ' + item.checkerId + '</div>';
      wrap.appendChild(card);
    });
    return;
  }

  if (qcCurrentStage === 'assembly') {
    items.forEach(function (item) {
      wrap.appendChild(buildQcActionCard(
        item.orderId + ' — ' + item.modelNoName,
        'Qty ' + item.qty + (item.customerName ? ' · ' + item.customerName : ''),
        function (result) {
          apiPost('submitAssemblyQC', { userId: currentSession.userId, orderId: item.orderId, result: result })
            .then(function (r) { if (!r.ok) return showFatalError(r.error); loadQCList(); })
            .catch(showFatalError);
        }
      ));
    });
    return;
  }

  if (qcCurrentStage === 'powder') {
    items.forEach(function (item) {
      wrap.appendChild(buildQcActionCard(
        item.orderId + ' — ' + item.modelNoName + ' (' + item.colour + ')',
        'Qty ' + item.qty + (item.customerName ? ' · ' + item.customerName : ''),
        function (result) {
          apiPost('submitPowderQC', { userId: currentSession.userId, queueId: item.queueId, result: result })
            .then(function (r) { if (!r.ok) return showFatalError(r.error); loadQCList(); })
            .catch(showFatalError);
        }
      ));
    });
    return;
  }

  if (qcCurrentStage === 'fitting') {
    items.forEach(function (item) {
      var card = document.createElement('div');
      card.className = 'card list-row';
      card.innerHTML =
        '<div class="list-row-title">' + item.orderId + ' — ' + item.modelNoName + '</div>' +
        '<div class="muted">Qty ' + item.qty + (item.customerName ? ' · ' + item.customerName : '') + '</div>';

      var confirmBtn = document.createElement('button');
      confirmBtn.className = 'btn btn-primary btn-block';
      confirmBtn.style.marginTop = '10px';
      confirmBtn.textContent = 'Confirm Return Received';
      confirmBtn.addEventListener('click', function () {
        apiPost('confirmFittingReturnByChecker', { userId: currentSession.userId, logId: item.logId })
          .then(function (r) { if (!r.ok) return showFatalError(r.error); loadQCList(); })
          .catch(showFatalError);
      });
      card.appendChild(confirmBtn);
      wrap.appendChild(card);
    });
    return;
  }
}

function buildQcActionCard(title, subtitle, onResult) {
  var card = document.createElement('div');
  card.className = 'card list-row';
  card.innerHTML = '<div class="list-row-title">' + title + '</div><div class="muted">' + subtitle + '</div>';

  var row = document.createElement('div');
  row.style.display = 'flex';
  row.style.gap = '10px';
  row.style.marginTop = '10px';

  var passBtn = document.createElement('button');
  passBtn.className = 'btn btn-primary';
  passBtn.style.flex = '1';
  passBtn.textContent = 'Pass';
  passBtn.addEventListener('click', function () { onResult('pass'); });

  var failBtn = document.createElement('button');
  failBtn.className = 'btn btn-danger';
  failBtn.style.flex = '1';
  failBtn.textContent = 'Fail';
  failBtn.addEventListener('click', function () { onResult('fail'); });

  row.appendChild(passBtn);
  row.appendChild(failBtn);
  card.appendChild(row);
  return card;
}
