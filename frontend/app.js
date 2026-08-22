var API_URL = 'https://script.google.com/macros/s/AKfycbycgBW8zp3sF20h90ZqpxLFGQ-kBO2Z6yKCkjcnnXbXMcr1ZI2HSqa3onKmu-n70n6Qcw/exec';

var SESSION_KEY = 'almirah_session';

var STAGE_LABELS = {
  cutting: 'Cutting',
  bending: 'Bending',
  assembly: 'Assembling',
  powder: 'Powder Coating',
  fitting: 'Fitting',
  checker: 'QC Checker'
};

var ADMIN_EXTRA_LABELS = {
  orders: 'Order Form',
  settings: 'Model Settings',
  powderStock: 'Powder Stock',
  appSettings: 'Setup Times',
  users: 'User Management'
};

var STAGE_VIEW_HANDLERS = {
  orders: 'renderOrderFormView',
  settings: 'renderModelSettingsView',
  cutting: 'renderCuttingQueueView',
  bending: 'renderBendingQueueView',
  assembly: 'renderAssemblyView',
  powder: 'renderPowderView',
  powderStock: 'renderPowderStockAdminView',
  fitting: 'renderFittingView',
  checker: 'renderQCView',
  appSettings: 'renderAppSettingsView'
};

var state = {
  selectedUser: null,
  pinBuffer: ''
};

var currentSession = null;

function el(id) { return document.getElementById(id); }

function apiGet(action, params) {
  var url = new URL(API_URL);
  url.searchParams.set('action', action);
  Object.keys(params || {}).forEach(function (k) {
    url.searchParams.set(k, params[k]);
  });
  return fetch(url.toString()).then(function (r) { return r.json(); });
}

function apiPost(action, payload) {
  var body = Object.assign({ action: action }, payload || {});
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  }).then(function (r) { return r.json(); });
}

function init() {
  el('logout-btn').addEventListener('click', logout);
  el('pin-back-btn').addEventListener('click', backToNameStep);

  var saved = localStorage.getItem(SESSION_KEY);
  if (saved) {
    renderDashboard(JSON.parse(saved));
  } else {
    showLogin();
    loadNameGrid();
  }
}

function showLogin() {
  el('topbar').style.display = 'none';
  el('dashboard-root').style.display = 'none';
  el('login-root').style.display = 'block';
}

function loadNameGrid() {
  apiGet('users').then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    renderNames(result.data);
  }).catch(showFatalError);
}

function renderNames(users) {
  var grid = el('name-grid');
  grid.innerHTML = '';
  users.forEach(function (u) {
    var tile = document.createElement('div');
    tile.className = 'name-tile';
    tile.textContent = u.name;
    tile.addEventListener('click', function () { selectUser(u); });
    grid.appendChild(tile);
  });
}

function selectUser(user) {
  state.selectedUser = user;
  state.pinBuffer = '';
  el('pin-step-name').textContent = user.name;
  el('name-step').style.display = 'none';
  el('pin-step').style.display = 'block';
  el('login-error').style.display = 'none';
  renderPinDots();
  renderPinPad();
}

function backToNameStep() {
  state.selectedUser = null;
  state.pinBuffer = '';
  el('pin-step').style.display = 'none';
  el('name-step').style.display = 'block';
}

function renderPinDots() {
  var wrap = el('pin-dots');
  wrap.innerHTML = '';
  for (var i = 0; i < 4; i++) {
    var dot = document.createElement('div');
    dot.className = 'pin-dot' + (i < state.pinBuffer.length ? ' filled' : '');
    wrap.appendChild(dot);
  }
}

function renderPinPad() {
  var pad = el('pin-pad');
  pad.innerHTML = '';
  var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];
  keys.forEach(function (k) {
    var btn = document.createElement('button');
    btn.className = 'pin-key';
    btn.textContent = k === 'clear' ? 'C' : (k === 'back' ? '⌫' : k);
    btn.addEventListener('click', function () { onPinKey(k); });
    pad.appendChild(btn);
  });
}

function onPinKey(k) {
  if (k === 'clear') {
    state.pinBuffer = '';
  } else if (k === 'back') {
    state.pinBuffer = state.pinBuffer.slice(0, -1);
  } else if (state.pinBuffer.length < 4) {
    state.pinBuffer += k;
  }
  renderPinDots();
  if (state.pinBuffer.length === 4) {
    attemptLogin();
  }
}

function attemptLogin() {
  apiPost('login', { userId: state.selectedUser.userId, pin: state.pinBuffer })
    .then(onLoginResult)
    .catch(showFatalError);
}

function onLoginResult(result) {
  if (!result.ok) {
    el('login-error').textContent = result.error;
    el('login-error').style.display = 'block';
    state.pinBuffer = '';
    renderPinDots();
    return;
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(result.session));
  if (typeof hasSeenDemo === 'function' && typeof renderDemoIntro === 'function' && !hasSeenDemo(result.session.userId)) {
    renderDemoIntro(result.session);
  } else {
    renderDashboard(result.session);
  }
}

function goToDashboard() {
  renderDashboard(currentSession);
}

function renderDashboard(session) {
  currentSession = session;
  el('login-root').style.display = 'none';
  el('topbar').style.display = 'flex';
  el('topbar-username').textContent = session.name + ' (' + session.role + ')';

  var root = el('dashboard-root');
  root.style.display = 'block';
  root.innerHTML = '';

  var guide = document.createElement('div');
  guide.className = 'guide-banner';
  guide.textContent = 'Tap a card below to open that stage.';
  root.appendChild(guide);

  var grid = document.createElement('div');
  grid.className = 'stage-grid';

  var stages = session.stages || [];
  var isAdmin = session.role === 'admin';
  var stageKeys = isAdmin ? Object.keys(STAGE_LABELS) : stages.filter(function (s) { return STAGE_LABELS[s]; });

  stageKeys.forEach(function (key) {
    grid.appendChild(buildStageCard(STAGE_LABELS[key], key));
  });

  if (isAdmin) {
    Object.keys(ADMIN_EXTRA_LABELS).forEach(function (key) {
      grid.appendChild(buildStageCard(ADMIN_EXTRA_LABELS[key], key));
    });
  }

  root.appendChild(grid);
}

function buildStageCard(label, key) {
  var card = document.createElement('div');
  card.className = 'card stage-card';
  card.innerHTML = '<span class="stage-card-label">' + label + '</span><span>›</span>';
  card.addEventListener('click', function () {
    var handlerName = STAGE_VIEW_HANDLERS[key];
    var handler = handlerName && window[handlerName];
    if (typeof handler === 'function') {
      handler();
    } else {
      alert(label + ' opens in a later build phase.');
    }
  });
  return card;
}

function buildViewHeader(title) {
  var header = document.createElement('div');
  header.className = 'view-header';
  var back = document.createElement('button');
  back.className = 'btn btn-secondary back-btn';
  back.textContent = '← Back';
  back.addEventListener('click', goToDashboard);
  var h2 = document.createElement('h2');
  h2.textContent = title;
  header.appendChild(back);
  header.appendChild(h2);
  return header;
}

function buildTextField(labelText, value, onChange) {
  var field = document.createElement('div');
  field.className = 'field';
  var label = document.createElement('label');
  label.textContent = labelText;
  var input = document.createElement('input');
  input.type = 'text';
  input.value = value || '';
  input.addEventListener('input', function (e) { onChange(e.target.value); });
  field.appendChild(label);
  field.appendChild(input);
  return field;
}

function buildNumberField(labelText, value, onChange) {
  var field = document.createElement('div');
  field.className = 'field';
  var label = document.createElement('label');
  label.textContent = labelText;
  var input = document.createElement('input');
  input.type = 'number';
  input.value = value || '';
  input.addEventListener('input', function (e) { onChange(e.target.value); });
  field.appendChild(label);
  field.appendChild(input);
  return field;
}

function logout() {
  localStorage.removeItem(SESSION_KEY);
  state.selectedUser = null;
  state.pinBuffer = '';
  el('name-step').style.display = 'block';
  el('pin-step').style.display = 'none';
  showLogin();
  loadNameGrid();
}

function showFatalError(err) {
  alert('Something went wrong: ' + (err && err.message ? err.message : err));
}

document.addEventListener('DOMContentLoaded', init);
