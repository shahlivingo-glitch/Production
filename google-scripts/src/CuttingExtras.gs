function addCuttingExtra(payload) {
  var order = findRowById('Orders', 'PoNumber', payload.poNumber);
  if (!order) {
    throw new Error('PO not found: ' + payload.poNumber);
  }
  if (payload.type !== 'extra-sheet' && payload.type !== 'extra-part') {
    throw new Error('Unknown extra type: ' + payload.type);
  }
  var extraId = generateId('EX');
  appendRow('CuttingExtras', {
    ExtraId: extraId,
    PoNumber: payload.poNumber,
    Type: payload.type,
    Details: JSON.stringify(payload.details || {}),
    Timestamp: nowIso()
  });
  return { extraId: extraId };
}

function listCuttingExtras(poNumber) {
  return getAllRows('CuttingExtras')
    .filter(function (r) { return String(r.PoNumber) === String(poNumber); })
    .map(function (r) {
      return {
        extraId: String(r.ExtraId),
        poNumber: String(r.PoNumber),
        type: r.Type,
        details: parseJsonSafe(r.Details, {}),
        timestamp: r.Timestamp
      };
    })
    .sort(function (a, b) { return a.timestamp < b.timestamp ? -1 : 1; });
}
