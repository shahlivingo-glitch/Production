function loadExtraPartInventory() {
  apiGet('extraPartInventory', {}).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    renderInventoryTable(result.data);
  }).catch(showFatalError);
}

function renderInventoryTable(rows) {
  var tbody = el('inventory-table-body');
  tbody.innerHTML = '';
  var emptyState = el('inventory-empty');

  if (rows.length === 0) {
    emptyState.style.display = 'block';
    return;
  }
  emptyState.style.display = 'none';

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
