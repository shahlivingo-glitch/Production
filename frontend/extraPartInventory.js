function loadExtraPartInventory() {
  el('inventory-loading').style.display = 'flex';
  el('inventory-error').style.display = 'none';
  el('inventory-table-wrap').style.display = 'none';
  el('inventory-empty').style.display = 'none';

  apiGet('extraPartInventory', {}).then(function (result) {
    el('inventory-loading').style.display = 'none';
    if (!result.ok) {
      el('inventory-error').textContent = 'Could not load Extra Part Inventory: ' + result.error;
      el('inventory-error').style.display = 'block';
      return;
    }
    renderInventoryTable(result.data);
  }).catch(function (err) {
    el('inventory-loading').style.display = 'none';
    el('inventory-error').textContent = 'Could not load Extra Part Inventory: ' + (err && err.message ? err.message : err);
    el('inventory-error').style.display = 'block';
  });
}

function renderInventoryTable(rows) {
  var tbody = el('inventory-table-body');
  tbody.innerHTML = '';
  var emptyState = el('inventory-empty');

  if (rows.length === 0) {
    emptyState.style.display = 'block';
    el('inventory-table-wrap').style.display = 'none';
    return;
  }
  emptyState.style.display = 'none';
  el('inventory-table-wrap').style.display = 'block';

  rows.forEach(function (row) {
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + row.modelName + '</td>' +
      '<td>' + row.partName + '</td>' +
      '<td>' + (row.size || '—') + '</td>' +
      '<td>' + row.qty + '</td>' +
      '<td>' + new Date(row.updatedAt).toLocaleString() + '</td>';
    tbody.appendChild(tr);
  });
}

document.addEventListener('DOMContentLoaded', loadExtraPartInventory);
