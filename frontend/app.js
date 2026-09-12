var API_URL = 'https://script.google.com/macros/s/AKfycbycgBW8zp3sF20h90ZqpxLFGQ-kBO2Z6yKCkjcnnXbXMcr1ZI2HSqa3onKmu-n70n6Qcw/exec';
var SESSION_STORAGE_KEY = 'almirahSession';

function el(id) { return document.getElementById(id); }

// --- Auth / session -------------------------------------------------------
// The token lives in localStorage (per-browser) and is sent as a plain
// parameter on every request - GET query param, POST body field - same
// shape every other param already uses. There's no practical way to use
// real cookies across the origins involved (this Vercel-hosted frontend,
// script.google.com, and the script.googleusercontent.com redirect the
// backend responds through), so this is the pragmatic option.
function getStoredSession() {
  try {
    var raw = localStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function getToken() {
  var s = getStoredSession();
  return s && s.token ? s.token : null;
}

function getCurrentUser() {
  var s = getStoredSession();
  return s ? s.user : null;
}

function saveSession(token, user) {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ token: token, user: user }));
  } catch (err) { /* private-browsing / storage disabled - session just won't persist a refresh */ }
}

function clearSession() {
  try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch (err) {}
}

// menuKey is one of Auth.gs's MENU_KEYS: cuttingConfig, orders, cuttingStage,
// bendingStage, extraInventory, sheetStock. Admins' stored permissions are
// already all-'edit' (see userRowToObject in Auth.gs), so these need no
// separate "or is admin" branch.
function canView(menuKey) {
  var user = getCurrentUser();
  if (!user) return false;
  var level = (user.permissions || {})[menuKey] || 'none';
  return level === 'view' || level === 'edit';
}

function canEdit(menuKey) {
  var user = getCurrentUser();
  if (!user) return false;
  return ((user.permissions || {})[menuKey] || 'none') === 'edit';
}

// Every page (except login.html) calls this first, before its own init.
// Redirects to login.html if there's no session or the backend says it's no
// longer valid (expired / revoked) - otherwise refreshes the cached user
// object (permissions may have changed since last login) and resolves with it.
function requireAuth() {
  var stored = getStoredSession();
  if (!stored || !stored.token) {
    window.location.href = 'login.html';
    return new Promise(function () {}); // never resolves - we're navigating away
  }
  return apiGet('whoAmI', {}).then(function (result) {
    if (!result.ok) {
      clearSession();
      window.location.href = 'login.html';
      return new Promise(function () {});
    }
    saveSession(stored.token, result.data);
    return result.data;
  }).catch(function () {
    clearSession();
    window.location.href = 'login.html';
    return new Promise(function () {});
  });
}

function doLogout() {
  var token = getToken();
  clearSession();
  if (token) {
    apiPost('logout', { token: token }).catch(function () {});
  }
  window.location.href = 'login.html';
}

// Dashboard is visible to any signed-in user regardless of menu grants;
// the 6 real pages need at least 'view' on their own menu; User Management
// is admin-only, not a grantable menu.
var NAV_PAGES = [
  { key: 'dashboard', label: 'Dashboard', href: 'dashboard.html', menu: null },
  { key: 'cuttingConfig', label: 'Cutting Configuration', href: 'index.html', menu: 'cuttingConfig' },
  { key: 'orders', label: 'Production Order Form', href: 'orders.html', menu: 'orders' },
  { key: 'cuttingStage', label: 'Cutting Stage', href: 'cuttingStage.html', menu: 'cuttingStage' },
  { key: 'bendingStage', label: 'Bending Stage', href: 'bendingStage.html', menu: 'bendingStage' },
  { key: 'extraInventory', label: 'Extra Part Inventory', href: 'extraPartInventory.html', menu: 'extraInventory' },
  { key: 'sheetStock', label: 'Raw Sheet Stock', href: 'sheetStock.html', menu: 'sheetStock' }
];

// Builds the top nav from the signed-in user's own permissions (replacing
// the old static per-page <nav> HTML) plus a username + Logout control.
// Call after requireAuth() resolves. activeKey matches a NAV_PAGES.key (or
// 'users' for the admin-only User Management page) to bold the current page.
function renderSideNav(activeKey) {
  var user = getCurrentUser();
  var nav = el('sidebar-nav');
  if (!user || !nav) return;
  nav.innerHTML = '';

  NAV_PAGES.forEach(function (page) {
    if (page.menu && !canView(page.menu)) return;
    var a = document.createElement('a');
    a.href = page.href;
    a.textContent = page.label;
    if (page.key === activeKey) a.className = 'active';
    nav.appendChild(a);
  });

  if (user.role === 'admin') {
    var usersLink = document.createElement('a');
    usersLink.href = 'users.html';
    usersLink.textContent = 'User Management';
    if (activeKey === 'users') usersLink.className = 'active';
    nav.appendChild(usersLink);
  }

  var footer = el('sidebar-footer');
  if (footer) {
    footer.innerHTML = '';
    var nameSpan = document.createElement('span');
    nameSpan.textContent = user.username + (user.role === 'admin' ? ' (Admin)' : '');
    var logoutBtn = document.createElement('button');
    logoutBtn.type = 'button';
    logoutBtn.className = 'sidebar-logout-btn';
    logoutBtn.textContent = 'Logout';
    logoutBtn.addEventListener('click', doLogout);
    footer.appendChild(nameSpan);
    footer.appendChild(logoutBtn);
  }

  initSidebarToggle();
}

// The hamburger button + backdrop only matter on narrow screens (see the
// max-width:900px rule in styles.css) where the sidebar becomes an
// off-canvas drawer - harmless to wire up unconditionally.
function initSidebarToggle() {
  var toggleBtn = el('mobile-nav-toggle');
  var sidebar = el('sidebar');
  var backdrop = el('sidebar-backdrop');
  if (!toggleBtn || !sidebar || !backdrop) return;
  function openSidebar() { sidebar.classList.add('open'); backdrop.classList.add('open'); }
  function closeSidebar() { sidebar.classList.remove('open'); backdrop.classList.remove('open'); }
  toggleBtn.addEventListener('click', function () {
    if (sidebar.classList.contains('open')) closeSidebar(); else openSidebar();
  });
  backdrop.addEventListener('click', closeSidebar);
}

// Google Apps Script occasionally serves an HTML error/interstitial page
// instead of the JSON API response (post-deploy propagation lag, or just a
// brief Apps Script infra hiccup - not specific to any one action). Reading
// that as JSON throws a raw "Unexpected token '<' ... is not valid JSON"
// parse error, which used to surface straight to the user. Parse via text()
// first so both apiGet/apiPost can turn that into one clear message instead.
function parseApiResponse(response) {
  return response.text().then(function (text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      var err = new Error('The server sent an unexpected response instead of data - this is usually a brief Google Apps Script hiccup. Please try again.');
      err.isBadApiResponse = true;
      throw err;
    }
  });
}

// GETs are safe to retry automatically (idempotent reads) - a few short
// backoff attempts quietly ride out the transient-HTML-response case above
// before anything reaches the user. POSTs are NOT auto-retried here: some
// actions aren't safe to blindly repeat if the write actually went through
// server-side but the response back was the one that got mangled.
function fetchJsonWithRetry(url, delays) {
  return fetch(url).then(parseApiResponse).catch(function (err) {
    if (err && err.isBadApiResponse && delays.length) {
      return new Promise(function (resolve) { setTimeout(resolve, delays[0]); })
        .then(function () { return fetchJsonWithRetry(url, delays.slice(1)); });
    }
    throw err;
  });
}

function apiGet(action, params) {
  var url = new URL(API_URL);
  url.searchParams.set('action', action);
  var token = getToken();
  if (token) url.searchParams.set('token', token);
  Object.keys(params || {}).forEach(function (k) {
    url.searchParams.set(k, params[k]);
  });
  return fetchJsonWithRetry(url.toString(), [500, 1000, 1800]);
}

function apiPost(action, payload) {
  var body = Object.assign({ action: action, token: getToken() }, payload || {});
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  }).then(parseApiResponse);
}

function showFatalError(err) {
  alert('Something went wrong: ' + (err && err.message ? err.message : err));
}

// Client-side mirror of MultiYield.gs / computeOrderSheetPlan - kept in sync so
// the PO form and Cutting Stage can show the sheet math instantly without a
// round trip. sheets = active plan sheets, qty = PO qty, decisions =
// Orders.MultiYieldDecisions ({} on the PO form; pass a
// { "s:o": "extra-sheet"|"scrap" } choices map there instead).
//
// Shared-sheet model: one physical cut of a sheet yields every output row's
// per-sheet amount at once (a plain row's per-sheet amount = its per-unit qty;
// a multiYield row's = yieldPerSheet). So a sheet-type is cut as many times as
// its HUNGRIEST row needs (max of floor(need/yield)); every other row on it
// overproduces and the surplus posts to the Leftover Ledger. Only the binding
// row gets a "remainder" and the extra-sheet/scrap decision.
function sheetSizeKeyClient(w, h, t) {
  return (Number(w) || 0) + 'x' + (Number(h) || 0) + 'x' + (Number(t) || 0);
}

function computeSheetPlanClient(sheets, qty, decisions) {
  qty = Number(qty) || 0;
  decisions = decisions || {};
  return (sheets || []).map(function (sheet, sheetIndex) {
    var outputs = sheet.outputs || [];

    var rows = outputs.map(function (output, outputIndex) {
      var perUnit = Number(output.qty) || 0;
      var yps = Number(output.yieldPerSheet) || 0;
      var isMulti = !!output.multiYield && yps >= 1;
      var perSheetYield = isMulti ? yps : perUnit;   // plain row: 1 cut = perUnit
      var need = qty * perUnit;
      var floorSheets = perSheetYield > 0 ? Math.floor(need / perSheetYield) : 0;
      var remainder = perSheetYield > 0 ? (need % perSheetYield) : 0;
      return {
        outputIndex: outputIndex,
        partName: output.partName,
        isExtra: !!output.isExtra,
        multiYield: isMulti,
        perUnit: perUnit,
        totalNeeded: need,
        yieldPerSheet: perSheetYield,
        floorSheets: floorSheets,
        remainder: remainder
      };
    });

    // Binding row = highest floor; when tied, prefer one with a remainder
    // (that's the row that needs a decision).
    var baseSheets = outputs.length === 0 ? qty : 0;
    var binding = null;
    rows.forEach(function (r) {
      if (r.floorSheets > baseSheets) baseSheets = r.floorSheets;
    });
    rows.forEach(function (r) {
      if (r.floorSheets === baseSheets && (!binding || (r.remainder > 0 && binding.remainder === 0))) {
        binding = r;
      }
    });

    var decisionKey = null;
    var bindingRemainder = 0;
    var choice = null;
    if (binding && binding.remainder > 0) {
      decisionKey = sheetIndex + ':' + binding.outputIndex;
      bindingRemainder = binding.remainder;
      var d = decisions[decisionKey];
      choice = (d && typeof d === 'object') ? d.choice : (typeof d === 'string' ? d : null);
      if (!choice) choice = 'pending';
    }

    var physicalSheets = baseSheets + (choice === 'extra-sheet' ? 1 : 0);

    rows.forEach(function (r) {
      r.isBinding = binding && r.outputIndex === binding.outputIndex;
      r.produced = physicalSheets * r.yieldPerSheet;
      // binding row on 'scrap' cuts exactly baseSheets and makes up the
      // remainder elsewhere, so it isn't credited the +0 rounding surplus
      r.surplus = Math.max(0, r.produced - r.totalNeeded);
      r.shortOnScrap = (r.isBinding && choice === 'scrap') ? r.remainder : 0;
    });

    return {
      sheetIndex: sheetIndex,
      sizeKey: sheetSizeKeyClient(sheet.width, sheet.height, sheet.thickness),
      width: Number(sheet.width) || 0,
      height: Number(sheet.height) || 0,
      thickness: Number(sheet.thickness) || 0,
      baseSheets: baseSheets,
      physicalSheets: physicalSheets,
      decisionKey: decisionKey,
      bindingRemainder: bindingRemainder,
      choice: choice,
      rows: rows
    };
  });
}

function computeStockNeedClient(sheets, qty, decisions) {
  var need = {};
  computeSheetPlanClient(sheets, qty, decisions).forEach(function (s) {
    need[s.sizeKey] = (need[s.sizeKey] || 0) + s.physicalSheets;
  });
  return need;
}

// (Each page's own script registers its own DOMContentLoaded handler that
// calls requireAuth() then its init function - cuttingConfig.js already did
// its own wiring+init this way, which made this generic hook redundant.)
