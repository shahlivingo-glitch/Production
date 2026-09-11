function initSheetStock() {
  el('ss-receive-btn').addEventListener('click', function () { submitStockChange('receive'); });
  el('ss-adjust-btn').addEventListener('click', function () { submitStockChange('adjust'); });
  loadSheetStock();
}

function loadSheetStock() {
  el('stock-loading').style.display = 'flex';
  el('stock-error').style.display = 'none';
  el('stock-table-wrap').style.display = 'none';
  el('stock-empty').style.display = 'none';

  Promise.all([
    apiGet('sheetStock', {}),
    apiGet('sheetStockLog', { limit: 50 })
  ]).then(function (results) {
    el('stock-loading').style.display = 'none';
    if (!results[0].ok) {
      el('stock-error').textContent = 'Could not load stock: ' + results[0].error;
      el('stock-error').style.display = 'block';
      return;
    }
    renderStockTable(results[0].data);
    renderLogTable(results[1].ok ? results[1].data : []);
  }).catch(function (err) {
    el('stock-loading').style.display = 'none';
    el('stock-error').textContent = 'Could not load stock: ' + (err && err.message ? err.message : err);
    el('stock-error').style.display = 'block';
  });
}

function renderStockTable(rows) {
  var tbody = el('stock-table-body');
  tbody.innerHTML = '';
  if (!rows.length) {
    el('stock-empty').style.display = 'block';
    el('stock-table-wrap').style.display = 'none';
    return;
  }
  el('stock-empty').style.display = 'none';
  el('stock-table-wrap').style.display = 'block';

  rows.forEach(function (r) {
    var tr = document.createElement('tr');
    var qtyStyle = r.qty < 0 ? ' style="color:var(--color-destructive);font-weight:700;"' : '';
    tr.innerHTML =
      '<td>' + r.width + ' &times; ' + r.height + ' &times; ' + r.thickness + '</td>' +
      '<td' + qtyStyle + '>' + r.qty + '</td>' +
      '<td>' + (r.updatedAt ? new Date(r.updatedAt).toLocaleString() : '&mdash;') + '</td>';
    tbody.appendChild(tr);
  });
}

function renderLogTable(rows) {
  var tbody = el('log-table-body');
  tbody.innerHTML = '';
  if (!rows.length) {
    el('log-empty').style.display = 'block';
    el('log-table-wrap').style.display = 'none';
    return;
  }
  el('log-empty').style.display = 'none';
  el('log-table-wrap').style.display = 'block';

  rows.forEach(function (r) {
    var tr = document.createElement('tr');
    var sign = r.delta > 0 ? '+' : '';
    var color = r.delta > 0 ? 'var(--color-success-text)' : 'var(--color-destructive)';
    tr.innerHTML =
      '<td>' + new Date(r.timestamp).toLocaleString() + '</td>' +
      '<td>' + r.size + '</td>' +
      '<td style="color:' + color + ';font-weight:700;">' + sign + r.delta + '</td>' +
      '<td>' + r.reason + '</td>' +
      '<td>' + (r.poNumber || '&mdash;') + '</td>' +
      '<td>' + (r.note || '&mdash;') + '</td>';
    tbody.appendChild(tr);
  });
}

function submitStockChange(mode) {
  if (!canEdit('sheetStock')) {
    setStockFormStatus('View only — ask an admin for edit access to change stock.', 'error');
    return;
  }
  var width = Number(el('ss-width').value) || 0;
  var height = Number(el('ss-height').value) || 0;
  var thickness = Number(el('ss-thickness').value) || 0;
  var qty = Number(el('ss-qty').value) || 0;
  var note = el('ss-note').value;

  if (width <= 0 || height <= 0) {
    setStockFormStatus('Enter width and height.', 'error');
    return;
  }
  if (mode === 'receive' && qty <= 0) {
    setStockFormStatus('Receive qty must be greater than 0.', 'error');
    return;
  }
  if (mode === 'adjust' && qty === 0) {
    setStockFormStatus('Correction qty cannot be 0.', 'error');
    return;
  }

  var action = mode === 'receive' ? 'receiveSheetStock' : 'adjustSheetStock';
  setStockFormStatus('Saving…', 'saving');
  el('ss-receive-btn').disabled = true;
  el('ss-adjust-btn').disabled = true;

  apiPost(action, {
    width: width, height: height, thickness: thickness, qty: qty, note: note
  }).then(function (result) {
    el('ss-receive-btn').disabled = false;
    el('ss-adjust-btn').disabled = false;
    if (!result.ok) {
      setStockFormStatus('Failed: ' + result.error, 'error');
      return;
    }
    setStockFormStatus(result.data.size + ' → ' + result.data.qty + ' on hand', '');
    el('ss-qty').value = '';
    el('ss-note').value = '';
    loadSheetStock();
  }).catch(function (err) {
    el('ss-receive-btn').disabled = false;
    el('ss-adjust-btn').disabled = false;
    setStockFormStatus('Failed: ' + (err && err.message ? err.message : err), 'error');
  });
}

function setStockFormStatus(text, cls) {
  var span = el('ss-form-status');
  span.textContent = text;
  span.className = 'save-status' + (cls ? ' ' + cls : '');
  span.style.display = 'block';
}

document.addEventListener('DOMContentLoaded', function () {
  requireAuth().then(function () {
    renderTopNav('sheetStock');
    if (!canEdit('sheetStock')) {
      el('ss-receive-btn').style.display = 'none';
      el('ss-adjust-btn').style.display = 'none';
      var hint = document.createElement('div');
      hint.className = 'section-hint';
      hint.textContent = 'View only — ask an admin for edit access to change stock.';
      el('ss-form-status').parentNode.insertBefore(hint, el('ss-form-status'));
    }
    initSheetStock();
  });
});
