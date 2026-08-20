function renderPowderStockAdminView() {
  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Powder Stock'));

  var guide = document.createElement('div');
  guide.className = 'guide-banner';
  guide.textContent = 'Use this after a physical powder count to correct recorded stock.';
  root.appendChild(guide);

  Promise.all([
    apiGet('powderStockSummary', { userId: currentSession.userId }),
    apiGet('personalStockList', { userId: currentSession.userId }),
    apiGet('users', {})
  ]).then(function (results) {
    var mainResult = results[0];
    var personalResult = results[1];
    var usersResult = results[2];
    if (!mainResult.ok) return showFatalError(mainResult.error);
    if (!personalResult.ok) return showFatalError(personalResult.error);
    if (!usersResult.ok) return showFatalError(usersResult.error);

    var nameById = {};
    usersResult.data.forEach(function (u) { nameById[u.userId] = u.name; });

    renderMainStockSection(mainResult.data.mainStock);
    renderPersonalStockSection(personalResult.data, nameById);
  }).catch(showFatalError);
}

function renderMainStockSection(mainStock) {
  var root = el('dashboard-root');

  var title = document.createElement('div');
  title.className = 'section-title';
  title.textContent = 'Main Stock';
  root.appendChild(title);

  mainStock.forEach(function (s) {
    root.appendChild(buildStockVerifyRow(s.colour, s.currentKg, function (verifiedKg) {
      apiPost('verifyMainStock', { userId: currentSession.userId, colour: s.colour, verifiedKg: verifiedKg })
        .then(function (result) {
          if (!result.ok) return showFatalError(result.error);
          renderPowderStockAdminView();
        }).catch(showFatalError);
    }));
  });

  var addColourWrap = document.createElement('div');
  addColourWrap.className = 'dynamic-row';

  var colourInput = document.createElement('input');
  colourInput.placeholder = 'New colour name';

  var kgInput = document.createElement('input');
  kgInput.type = 'number';
  kgInput.placeholder = 'kg';
  kgInput.style.maxWidth = '100px';

  var addBtn = document.createElement('button');
  addBtn.className = 'btn btn-secondary';
  addBtn.style.minHeight = '44px';
  addBtn.textContent = 'Add';
  addBtn.addEventListener('click', function () {
    if (!colourInput.value.trim()) return;
    apiPost('verifyMainStock', {
      userId: currentSession.userId,
      colour: colourInput.value.trim(),
      verifiedKg: Number(kgInput.value) || 0
    }).then(function (result) {
      if (!result.ok) return showFatalError(result.error);
      renderPowderStockAdminView();
    }).catch(showFatalError);
  });

  addColourWrap.appendChild(colourInput);
  addColourWrap.appendChild(kgInput);
  addColourWrap.appendChild(addBtn);
  root.appendChild(addColourWrap);
}

function renderPersonalStockSection(personalStock, nameById) {
  var root = el('dashboard-root');

  var title = document.createElement('div');
  title.className = 'section-title';
  title.textContent = 'Personal Stock';
  root.appendChild(title);

  if (personalStock.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'No personal stock recorded yet.';
    root.appendChild(empty);
    return;
  }

  personalStock.forEach(function (s) {
    var name = nameById[s.operatorId] || s.operatorId;
    root.appendChild(buildStockVerifyRow(name + ' — ' + s.colour, s.currentKg, function (verifiedKg) {
      apiPost('verifyPersonalStock', {
        userId: currentSession.userId,
        operatorId: s.operatorId,
        colour: s.colour,
        verifiedKg: verifiedKg
      }).then(function (result) {
        if (!result.ok) return showFatalError(result.error);
        renderPowderStockAdminView();
      }).catch(showFatalError);
    }));
  });
}

function buildStockVerifyRow(label, currentKg, onVerify) {
  var row = document.createElement('div');
  row.className = 'dynamic-row';

  var labelSpan = document.createElement('div');
  labelSpan.style.flex = '1';
  labelSpan.style.fontWeight = '600';
  labelSpan.textContent = label + ' (' + currentKg + 'kg)';

  var input = document.createElement('input');
  input.type = 'number';
  input.placeholder = 'Verified kg';
  input.style.maxWidth = '110px';

  var btn = document.createElement('button');
  btn.className = 'btn btn-secondary';
  btn.style.minHeight = '44px';
  btn.textContent = 'Set';
  btn.addEventListener('click', function () {
    onVerify(Number(input.value) || 0);
  });

  row.appendChild(labelSpan);
  row.appendChild(input);
  row.appendChild(btn);
  return row;
}
