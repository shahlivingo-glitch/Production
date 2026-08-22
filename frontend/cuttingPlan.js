var planStockState = {};

function renderPlanCuttingView(orderId) {
  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Plan Cutting'));

  apiGet('orderPlanContext', { userId: currentSession.userId, orderId: orderId }).then(function (result) {
    if (!result.ok) return showFatalError(result.error);
    renderPlanCuttingForm(result.data);
  }).catch(showFatalError);
}

function sheetLabel(context, code) {
  return context.sheetSizes[code] ? code + ' (' + context.sheetSizes[code] + ')' : code;
}

function renderPlanCuttingForm(context) {
  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Plan Cutting'));

  var guide = document.createElement('div');
  guide.className = 'guide-banner';
  guide.textContent = 'Enter what sheet stock you actually have on hand — this works out the mix of patterns that covers the order with the least waste.';
  root.appendChild(guide);

  var card = document.createElement('div');
  card.className = 'card';
  card.innerHTML =
    '<div class="list-row-title">' + context.orderId + ' — ' + context.modelNoName + '</div>' +
    '<div class="muted">Qty ' + context.qty + '</div>';
  root.appendChild(card);

  if (context.resolvedSheetSequence.length > 0) {
    var already = document.createElement('div');
    already.className = 'muted';
    already.style.margin = '10px 0';
    already.textContent = 'A cutting plan is already confirmed for this order (' + context.resolvedSheetSequence.length + ' sheets). Computing a new one will replace it.';
    root.appendChild(already);
  }

  var stockTitle = document.createElement('div');
  stockTitle.className = 'section-title';
  stockTitle.textContent = 'Available Stock on Hand';
  root.appendChild(stockTitle);

  planStockState = {};
  context.sheetSequence.forEach(function (code) {
    planStockState[code] = '';
    root.appendChild(buildNumberField(sheetLabel(context, code), planStockState[code], function (v) {
      planStockState[code] = v;
    }));
  });

  var computeBtn = document.createElement('button');
  computeBtn.className = 'btn btn-primary btn-block';
  computeBtn.textContent = 'Compute Plan';
  computeBtn.addEventListener('click', function () {
    var stock = {};
    context.sheetSequence.forEach(function (code) {
      stock[code] = Number(planStockState[code]) || 0;
    });

    apiPost('previewCuttingPlan', {
      userId: currentSession.userId,
      orderId: context.orderId,
      availableStock: stock
    }).then(function (result) {
      if (!result.ok) return showFatalError(result.error);
      renderPlanPreview(context, result.data);
    }).catch(showFatalError);
  });
  root.appendChild(computeBtn);
}

function renderPlanPreview(context, plan) {
  var root = el('dashboard-root');
  root.innerHTML = '';
  root.appendChild(buildViewHeader('Cutting Plan — ' + context.orderId));

  var countByCode = {};
  plan.sequence.forEach(function (code) {
    countByCode[code] = (countByCode[code] || 0) + 1;
  });

  var summaryCard = document.createElement('div');
  summaryCard.className = 'card';
  var comboText = Object.keys(countByCode).length
    ? Object.keys(countByCode).map(function (code) { return countByCode[code] + '× ' + sheetLabel(context, code); }).join(', ')
    : 'No sheets available to plan with.';
  summaryCard.innerHTML =
    '<div class="list-row-title">' + comboText + '</div>' +
    '<div class="muted">Total sheets: ' + plan.totalSheets + '</div>';
  root.appendChild(summaryCard);

  var leftoverItems = Object.keys(plan.leftover).filter(function (p) { return plan.leftover[p] > 0; });
  if (leftoverItems.length > 0) {
    var leftoverCard = document.createElement('div');
    leftoverCard.className = 'card';
    leftoverCard.innerHTML = '<div class="muted">Leftover parts</div><div class="list-row-title">' +
      leftoverItems.map(function (p) { return p + ': ' + plan.leftover[p]; }).join(', ') + '</div>';
    root.appendChild(leftoverCard);
  }

  var shortfallItems = Object.keys(plan.shortfall);
  if (shortfallItems.length > 0) {
    var shortageBanner = document.createElement('div');
    shortageBanner.className = 'alert-banner';
    shortageBanner.textContent = 'Not enough stock to fully cover this order — short by: ' +
      shortfallItems.map(function (p) { return p + ' x' + plan.shortfall[p]; }).join(', ');
    root.appendChild(shortageBanner);
  }

  var confirmBtn = document.createElement('button');
  confirmBtn.className = 'btn btn-primary btn-block';
  confirmBtn.textContent = 'Confirm This Plan';
  confirmBtn.disabled = plan.sequence.length === 0;
  confirmBtn.addEventListener('click', function () {
    apiPost('confirmCuttingPlan', {
      userId: currentSession.userId,
      orderId: context.orderId,
      sequence: plan.sequence
    }).then(function (result) {
      if (!result.ok) return showFatalError(result.error);
      alert('Cutting plan saved for ' + context.orderId + ' — ' + result.data.sheetsPlanned + ' sheets.');
      renderOrderFormView();
    }).catch(showFatalError);
  });
  root.appendChild(confirmBtn);

  var backBtn = document.createElement('button');
  backBtn.className = 'btn btn-secondary btn-block';
  backBtn.style.marginTop = '10px';
  backBtn.textContent = 'Adjust Stock';
  backBtn.addEventListener('click', function () { renderPlanCuttingView(context.orderId); });
  root.appendChild(backBtn);
}
