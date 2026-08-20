function listOrders(userId) {
  requirePermission(userId, 'orders');
  return getAllRows('Orders').map(function (o) {
    return {
      orderId: o.OrderID,
      modelNoName: o.ModelNoName,
      qty: o.Qty,
      dxfRefNo: o.DXFRefNo,
      colourPlan: parseJsonSafe(o.ColourPlan, {}),
      deliveryDeadline: o.DeliveryDeadline,
      customerName: o.CustomerName,
      status: o.Status,
      createdAt: o.CreatedAt,
      createdBy: o.CreatedBy
    };
  });
}

function createOrder(payload) {
  requirePermission(payload.userId, 'orders');

  var model = findRowById('ModelSettings', 'ModelNoName', payload.modelNoName);
  if (!model) {
    throw new Error('Unknown model: ' + payload.modelNoName);
  }

  var qty = Number(payload.qty);
  if (!qty || qty <= 0) {
    throw new Error('Quantity must be a positive number');
  }

  var orderId = generateId('ORD');

  appendRow('Orders', {
    OrderID: orderId,
    ModelNoName: payload.modelNoName,
    Qty: qty,
    DXFRefNo: payload.dxfRefNo || '',
    ColourPlan: JSON.stringify(payload.colourPlan || {}),
    DeliveryDeadline: payload.deliveryDeadline || '',
    CustomerName: payload.customerName || '',
    Status: 'pending',
    CreatedAt: nowIso(),
    CreatedBy: payload.userId
  });

  var sheetSequence = parseJsonSafe(model.SheetSequence, []);
  sheetSequence.forEach(function (sheetCode, index) {
    appendRow('CuttingLog', {
      LogID: generateId('CUT'),
      OrderID: orderId,
      ModelNoName: payload.modelNoName,
      SheetCode: sheetCode,
      SheetSequencePos: index + 1,
      Status: 'pending',
      StartedAt: '',
      CompletedAt: '',
      OperatorID: '',
      Points: ''
    });
  });

  return { orderId: orderId, sheetsQueued: sheetSequence.length };
}
