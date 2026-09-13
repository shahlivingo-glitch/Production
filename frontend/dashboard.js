function initDashboard() {
  loadDashboard();
}

function loadDashboard() {
  el('dash-loading').style.display = 'flex';
  el('dash-error').style.display = 'none';
  el('dash-content').style.display = 'none';

  apiGet('dashboardSummary', {}).then(function (result) {
    el('dash-loading').style.display = 'none';
    if (!result.ok) {
      el('dash-error').textContent = 'Could not load Dashboard: ' + result.error;
      el('dash-error').style.display = 'block';
      return;
    }
    el('dash-content').style.display = 'block';
    renderDashboard(result.data);
  }).catch(function (err) {
    el('dash-loading').style.display = 'none';
    el('dash-error').textContent = 'Could not load Dashboard: ' + (err && err.message ? err.message : err);
    el('dash-error').style.display = 'block';
  });
}

function renderDashboard(d) {
  el('tile-pending-pos').textContent = d.pendingPOsCount;
  el('tile-pending-bending').textContent = d.pendingBendingCount;
  el('tile-pending-decisions').textContent = d.pendingMultiYieldDecisions.length;
  el('tile-stock-short').textContent = d.stockShort.length;

  var decisionsSection = el('dash-decisions-section');
  var decisionsList = el('dash-decisions-list');
  decisionsList.innerHTML = '';
  if (d.pendingMultiYieldDecisions.length > 0 && canView('cuttingStage')) {
    decisionsSection.style.display = 'block';
    d.pendingMultiYieldDecisions.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'dash-row';
      row.innerHTML = '<span>' + item.poNumber + ' — ' + item.modelName + '</span>' +
        '<a href="cuttingStage.html" class="btn-secondary" style="text-decoration:none; font-size:12px; padding:4px 10px;">Resolve in Cutting Stage</a>';
      decisionsList.appendChild(row);
    });
  } else {
    decisionsSection.style.display = 'none';
  }

  var stockSection = el('dash-stock-section');
  var stockList = el('dash-stock-list');
  stockList.innerHTML = '';
  if (d.stockShort.length > 0 && canView('sheetStock')) {
    stockSection.style.display = 'block';
    d.stockShort.forEach(function (s) {
      var row = document.createElement('div');
      row.className = 'dash-row';
      row.innerHTML = '<span>' + s.width + ' × ' + s.height + ' × ' + s.thickness + ' mm</span>' +
        '<span class="stock-warn">' + s.qty + '</span>';
      stockList.appendChild(row);
    });
  } else {
    stockSection.style.display = 'none';
  }

  var activityList = el('dash-activity-list');
  activityList.innerHTML = '';
  if (d.recentActivity.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No activity yet.';
    activityList.appendChild(empty);
  } else {
    d.recentActivity.forEach(function (a) {
      var row = document.createElement('div');
      row.className = 'dash-row dash-row-link';
      var label = a.type === 'order' ? 'PO created' : a.detail;
      row.innerHTML = '<span><strong>' + a.poNumber + '</strong> — ' + label + (a.type === 'order' ? ': ' + a.detail : '') + '</span>' +
        '<span class="muted">' + new Date(a.timestamp).toLocaleString() + '</span>';
      row.title = 'Open full history for ' + a.poNumber;
      row.addEventListener('click', function () {
        window.location.href = 'poHistory.html?po=' + encodeURIComponent(a.poNumber);
      });
      activityList.appendChild(row);
    });
  }
}

document.addEventListener('DOMContentLoaded', function () {
  requireAuth().then(function () {
    renderSideNav('dashboard');
    initDashboard();
  });
});
