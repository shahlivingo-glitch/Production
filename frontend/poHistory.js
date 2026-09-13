// Read-only consolidated report for one PO (?po=PO-0001). Everything here
// comes from a single poFullHistory call - this page never writes.

var historyData = null;

function poNumberFromUrl() {
  var params = new URLSearchParams(window.location.search);
  return params.get('po') || '';
}

function fmtTime(value) {
  if (!value) return '<span class="muted">not recorded</span>';
  var d = new Date(value);
  if (isNaN(d.getTime())) return '<span class="muted">not recorded</span>';
  return d.toLocaleString();
}

function fmtActor(value) {
  return value ? value : '<span class="muted">—</span>';
}

// Date-only fields (delivery deadline) come back from Sheets as a full ISO
// timestamp - show just the date rather than a misleading midnight-ish time.
function fmtDate(value) {
  if (!value) return '—';
  var d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString();
}

// Variance reads as a plain dash at zero rather than "0", so a scan down the
// column only stops on sheets/parts that actually diverged from plan.
function fmtVariance(n) {
  if (!n) return '<span class="muted">—</span>';
  var cls = n > 0 ? 'variance-surplus' : 'variance-short';
  return '<span class="' + cls + '">' + (n > 0 ? '+' : '') + n + '</span>';
}

function buildTable(headers, rows, emptyText) {
  if (!rows.length) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = emptyText;
    return empty;
  }
  var wrap = document.createElement('div');
  wrap.style.overflowX = 'auto';
  var table = document.createElement('table');
  table.className = 'po-table';
  table.innerHTML =
    '<thead><tr>' + headers.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead>' +
    '<tbody>' + rows.map(function (cells) {
      return '<tr>' + cells.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
    }).join('') + '</tbody>';
  wrap.appendChild(table);
  return wrap;
}

function loadHistory() {
  var poNumber = poNumberFromUrl();
  if (!poNumber) {
    el('hist-loading').style.display = 'none';
    el('hist-error').textContent = 'No PO specified.';
    el('hist-error').style.display = 'block';
    return;
  }
  el('po-title').textContent = poNumber;

  apiGet('poFullHistory', { poNumber: poNumber }).then(function (result) {
    el('hist-loading').style.display = 'none';
    if (!result.ok) {
      el('hist-error').textContent = 'Could not load ' + poNumber + ': ' + result.error;
      el('hist-error').style.display = 'block';
      return;
    }
    historyData = result.data;
    el('hist-content').style.display = 'block';
    renderAll();
  }).catch(function (err) {
    el('hist-loading').style.display = 'none';
    el('hist-error').textContent = 'Could not load ' + poNumber + ': ' + (err && err.message ? err.message : err);
    el('hist-error').style.display = 'block';
  });
}

function renderAll() {
  renderSummary();
  renderCutting();
  renderExtras();
  renderInventory();
  renderBending();
  renderActivity();
}

function renderSummary() {
  var o = historyData.order;
  el('po-status-pills').innerHTML =
    '<span class="status-pill status-' + o.cuttingStatus + '">cutting: ' + o.cuttingStatus + '</span> ' +
    '<span class="status-pill status-' + o.bendingStatus + '">bending: ' + o.bendingStatus + '</span>';

  var box = el('hist-summary');
  box.innerHTML = '';
  var fields = [
    ['Model', o.modelName],
    ['Qty Ordered', o.planType === 'bulk'
      ? o.qty + ' <span class="muted">(Bulk ×' + o.bulkBaseQty + ', ' + o.bulkMultiplier + '×)</span>'
      : o.qty],
    ['Created', new Date(o.createdAt).toLocaleString()],
    ['Party', o.partyName || '—'],
    ['DXF Ref', o.dxfRefNo || '—'],
    ['Delivery Deadline', fmtDate(o.deliveryDeadline)],
    ['Colour Plan', o.colourPlan || '—'],
    ['Plan', o.planName + (o.planVersionId ? ' <span class="muted">(versioned)</span>' : '')]
  ];
  fields.forEach(function (f) {
    var block = document.createElement('div');
    block.className = 'field-block';
    block.innerHTML = '<label>' + f[0] + '</label><div>' + f[1] + '</div>';
    box.appendChild(block);
  });
}

function renderCutting() {
  var host = el('hist-cutting');
  host.innerHTML = '';

  if (!historyData.cuttingSheets.length) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'This PO has no sheets in its plan.';
    host.appendChild(empty);
    return;
  }

  historyData.cuttingSheets.forEach(function (s) {
    var card = document.createElement('div');
    card.className = 'cs-sheet-card' + (s.done ? ' done' : '');

    var header = document.createElement('div');
    header.className = 'sheet-header';
    header.innerHTML =
      '<span class="sheet-title">' + s.label + (s.done ? ' — Cut' : ' — not yet cut') + '</span>';
    card.appendChild(header);

    var meta = document.createElement('div');
    meta.className = 'cs-sheet-total-line';
    meta.innerHTML =
      '<span>Planned <strong>' + s.plannedSheets + '</strong> sheets · Actual <strong>' + s.actualSheets +
      '</strong> sheets · Variance ' + fmtVariance(s.sheetVariance) + '</span>' +
      '<span class="muted">' + (s.done ? 'Done ' + fmtTime(s.doneAt) + ' by ' + fmtActor(s.doneBy) : 'Pending') + '</span>';
    card.appendChild(meta);

    card.appendChild(buildTable(
      ['Part', 'Size', 'Pcs/sheet', 'Planned total', 'Actual total', 'Variance'],
      s.parts.map(function (p) {
        return [
          p.partName + (p.isExtra ? ' <span class="muted">[extra]</span>' : ''),
          p.size || '<span class="muted">—</span>',
          String(p.perSheet),
          String(p.plannedTotal),
          '<strong>' + p.actualTotal + '</strong>',
          fmtVariance(p.variance)
        ];
      }),
      'No parts defined on this sheet.'
    ));

    host.appendChild(card);
  });
}

function renderExtras() {
  var extraSheets = historyData.extras.filter(function (e) { return e.type === 'extra-sheet'; });
  var extraParts = historyData.extras.filter(function (e) { return e.type === 'extra-part'; });
  var host = el('hist-extras');
  host.innerHTML = '';

  host.appendChild(buildTable(
    ['Sheet size', 'DXF No.', 'Parts produced', 'When'],
    extraSheets.map(function (e) {
      var d = e.details || {};
      var produced = Object.keys(d.partsProduced || {}).map(function (p) {
        return p + ' × ' + d.partsProduced[p];
      }).join(', ');
      return [
        [d.width, d.height, d.thickness].filter(function (v) { return v; }).join(' × ') + ' mm',
        d.dxfNo || '<span class="muted">—</span>',
        produced || '<span class="muted">none recorded</span>',
        fmtTime(e.timestamp)
      ];
    }),
    'No extra sheets were cut for this PO.'
  ));

  if (extraParts.length) {
    var subTitle = document.createElement('div');
    subTitle.className = 'section-hint';
    subTitle.style.marginTop = '12px';
    subTitle.textContent = 'Extra parts logged (without cutting a whole extra sheet):';
    host.appendChild(subTitle);

    host.appendChild(buildTable(
      ['Part', 'Size', 'Qty', 'When'],
      extraParts.map(function (e) {
        var d = e.details || {};
        return [
          d.partName || '—',
          d.size || '<span class="muted">—</span>',
          String(d.qty || 0),
          fmtTime(e.timestamp)
        ];
      }),
      'None.'
    ));
  }
}

function renderInventory() {
  var host = el('hist-inventory');
  host.innerHTML = '';
  host.appendChild(buildTable(
    ['Direction', 'Part', 'Size', 'Qty', 'Reason', 'When', 'By'],
    historyData.inventoryLog.map(function (m) {
      var isIn = m.delta >= 0;
      return [
        isIn
          ? '<span class="variance-surplus">→ into inventory</span>'
          : '<span class="variance-short">← out of inventory</span>',
        m.partName,
        m.size || '<span class="muted">—</span>',
        String(Math.abs(m.delta)),
        m.reasonLabel || m.reason || '<span class="muted">—</span>',
        fmtTime(m.timestamp),
        fmtActor(m.actor)
      ];
    }),
    'No Extra Part Inventory movements recorded for this PO.'
  ));
}

function renderBending() {
  var host = el('hist-bending');
  host.innerHTML = '';

  host.appendChild(buildTable(
    ['Part', 'From sheet', 'Qty to bend', 'Moved to inventory', 'Status', 'Source', 'Done at', 'By'],
    historyData.bendingEntries.map(function (b) {
      return [
        b.partName + (b.isExtra ? ' <span class="muted">[extra]</span>' : '') +
          (b.size ? ' <span class="muted">(' + b.size + ')</span>' : ''),
        '<span class="muted">' + b.sheetLabel + '</span>',
        String(b.pendingQty),
        b.movedToInventory ? String(b.movedToInventory) : '<span class="muted">—</span>',
        '<span class="status-pill status-' + (b.done ? 'complete' : 'pending') + '">' + b.status + '</span>',
        b.done ? b.source : '<span class="muted">—</span>',
        b.done ? fmtTime(b.doneAt) : '<span class="muted">—</span>',
        b.done ? fmtActor(b.doneBy) : '<span class="muted">—</span>'
      ];
    }),
    'This plan has no bending entries.'
  ));

  if (historyData.extraBending.length) {
    var subTitle = document.createElement('div');
    subTitle.className = 'section-hint';
    subTitle.style.marginTop = '12px';
    subTitle.textContent = 'Extra parts and inventory pulls bent for this PO:';
    host.appendChild(subTitle);

    host.appendChild(buildTable(
      ['Part', 'Origin', 'Qty', 'Status', 'Done at', 'By'],
      historyData.extraBending.map(function (b) {
        return [
          b.partName + (b.size ? ' <span class="muted">(' + b.size + ')</span>' : ''),
          b.isFromInventory ? 'Pulled from Extra Inventory' : '<span class="muted">' + b.sheetLabel + '</span>',
          String(b.qty),
          '<span class="status-pill status-' + (b.done ? 'complete' : 'pending') + '">' + b.status + '</span>',
          b.done ? fmtTime(b.doneAt) : '<span class="muted">—</span>',
          b.done ? fmtActor(b.doneBy) : '<span class="muted">—</span>'
        ];
      }),
      'None.'
    ));
  }
}

function renderActivity() {
  var host = el('hist-activity');
  host.innerHTML = '';
  host.appendChild(buildTable(
    ['When', 'Stage', 'Action', 'Detail', 'By'],
    historyData.activityLog.map(function (e) {
      return [
        fmtTime(e.timestamp),
        '<span class="muted">' + e.stage + '</span>',
        '<strong>' + e.action + '</strong>',
        e.detail || '',
        fmtActor(e.actor)
      ];
    }),
    'No activity recorded for this PO.'
  ));
}

document.addEventListener('DOMContentLoaded', function () {
  requireAuth().then(function () {
    renderSideNav('dashboard');
    el('back-btn').addEventListener('click', function () {
      window.location.href = 'dashboard.html';
    });
    loadHistory();
  });
});
