var orderForm = null;

function emptyOrderForm() {
  return {
    modelNoName: '',
    qty: '',
    dxfRefNo: '',
    colourRows: [{ colour: '', qty: '' }],
    deliveryDeadline: '',
    customerName: ''
  };
}

function renderOrderFormView() {
  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Order Form'));

  var loading = document.createElement('div');
  loading.className = 'guide-banner';
  loading.textContent = 'Loading orders…';
  root.appendChild(loading);

  apiGet('orders', { userId: currentSession.userId }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    renderOrderList(result.data);
  }).catch(showFatalError);
}

function renderOrderList(orders) {
  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Order Form'));

  var addBtn = document.createElement('button');
  addBtn.className = 'btn btn-primary btn-block add-row-btn';
  addBtn.textContent = '+ New Order';
  addBtn.addEventListener('click', startNewOrder);
  root.appendChild(addBtn);

  if (orders.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No orders yet.';
    root.appendChild(empty);
    return;
  }

  orders.slice().reverse().forEach(function (o) {
    var card = document.createElement('div');
    card.className = 'card list-row';
    card.innerHTML =
      '<div class="list-row-title">' + o.orderId + ' — ' + o.modelNoName + '</div>' +
      '<div class="muted">Qty ' + o.qty + ' · ' + (o.customerName || '—') + ' · Status: ' + o.status + '</div>' +
      '<div class="muted">Deadline: ' + (o.deliveryDeadline || '—') + '</div>';
    root.appendChild(card);
  });
}

function startNewOrder() {
  apiGet('models', { userId: currentSession.userId }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    if (result.data.length === 0) {
      var root = el('dashboard-root');
      root.innerHTML = '';
      root.appendChild(buildViewHeader('New Order'));
      var empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No models configured yet. Set up a model in Model Settings before creating an order.';
      root.appendChild(empty);
      return;
    }
    orderForm = emptyOrderForm();
    orderForm.modelNoName = result.data[0].modelNoName;
    renderOrderForm(result.data);
  }).catch(showFatalError);
}

function renderOrderForm(models) {
  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('New Order'));

  var modelField = document.createElement('div');
  modelField.className = 'field';
  var modelLabel = document.createElement('label');
  modelLabel.textContent = 'Model';
  var modelSelect = document.createElement('select');
  models.forEach(function (m) {
    var opt = document.createElement('option');
    opt.value = m.modelNoName;
    opt.textContent = m.modelNoName;
    modelSelect.appendChild(opt);
  });
  modelSelect.value = orderForm.modelNoName;
  modelSelect.addEventListener('change', function (e) { orderForm.modelNoName = e.target.value; });
  modelField.appendChild(modelLabel);
  modelField.appendChild(modelSelect);
  root.appendChild(modelField);

  root.appendChild(buildNumberField('Quantity', orderForm.qty, function (v) { orderForm.qty = v; }));
  root.appendChild(buildTextField('DXF Reference No', orderForm.dxfRefNo, function (v) { orderForm.dxfRefNo = v; }));

  var colourTitle = document.createElement('div');
  colourTitle.className = 'section-title';
  colourTitle.textContent = 'Colour Plan';
  root.appendChild(colourTitle);

  var colourWrap = document.createElement('div');
  root.appendChild(colourWrap);
  renderColourRows(colourWrap);

  var addColourBtn = document.createElement('button');
  addColourBtn.className = 'btn btn-secondary add-row-btn';
  addColourBtn.textContent = '+ Add Colour';
  addColourBtn.addEventListener('click', function () {
    orderForm.colourRows.push({ colour: '', qty: '' });
    renderColourRows(colourWrap);
  });
  root.appendChild(addColourBtn);

  var deadlineField = document.createElement('div');
  deadlineField.className = 'field';
  var deadlineLabel = document.createElement('label');
  deadlineLabel.textContent = 'Delivery Deadline';
  var deadlineInput = document.createElement('input');
  deadlineInput.type = 'date';
  deadlineInput.value = orderForm.deliveryDeadline;
  deadlineInput.addEventListener('input', function (e) { orderForm.deliveryDeadline = e.target.value; });
  deadlineField.appendChild(deadlineLabel);
  deadlineField.appendChild(deadlineInput);
  root.appendChild(deadlineField);

  root.appendChild(buildTextField('Customer Name', orderForm.customerName, function (v) { orderForm.customerName = v; }));

  var submitBtn = document.createElement('button');
  submitBtn.className = 'btn btn-primary btn-block';
  submitBtn.textContent = 'Create Order';
  submitBtn.addEventListener('click', submitOrderForm);
  root.appendChild(submitBtn);
}

function renderColourRows(wrap) {
  wrap.innerHTML = '';
  orderForm.colourRows.forEach(function (row, i) {
    var line = document.createElement('div');
    line.className = 'dynamic-row';

    var colourInput = document.createElement('input');
    colourInput.placeholder = 'Colour (e.g. Red)';
    colourInput.value = row.colour;
    colourInput.addEventListener('input', function (e) { row.colour = e.target.value; });

    var qtyInput = document.createElement('input');
    qtyInput.type = 'number';
    qtyInput.placeholder = 'Qty';
    qtyInput.value = row.qty;
    qtyInput.style.maxWidth = '90px';
    qtyInput.addEventListener('input', function (e) { row.qty = e.target.value; });

    line.appendChild(colourInput);
    line.appendChild(qtyInput);

    if (orderForm.colourRows.length > 1) {
      var removeBtn = document.createElement('button');
      removeBtn.className = 'remove-row-btn';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', function () {
        orderForm.colourRows.splice(i, 1);
        renderColourRows(wrap);
      });
      line.appendChild(removeBtn);
    }

    wrap.appendChild(line);
  });
}

function submitOrderForm() {
  if (!orderForm.modelNoName) {
    alert('Pick a model.');
    return;
  }
  if (!orderForm.qty || Number(orderForm.qty) <= 0) {
    alert('Enter a valid quantity.');
    return;
  }

  var colourPlan = {};
  orderForm.colourRows.forEach(function (row) {
    var colour = row.colour.trim();
    if (!colour) return;
    colourPlan[colour] = Number(row.qty) || 0;
  });

  apiPost('createOrder', {
    userId: currentSession.userId,
    modelNoName: orderForm.modelNoName,
    qty: orderForm.qty,
    dxfRefNo: orderForm.dxfRefNo,
    colourPlan: colourPlan,
    deliveryDeadline: orderForm.deliveryDeadline,
    customerName: orderForm.customerName
  }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    alert('Order ' + result.data.orderId + ' created — ' + result.data.sheetsQueued + ' cutting sheets queued.');
    renderOrderFormView();
  }).catch(showFatalError);
}
