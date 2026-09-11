// Operational overview for the Dashboard page. Pure composition over
// functions that already exist (Orders.gs, Bending.gs, SheetStock.gs) plus a
// couple of small "most recent N" reads - no new stored aggregates, nothing
// here changes when it's called or how often (safe to call on every
// Dashboard page load).
function getDashboardSummary() {
  var orders = listOrders();
  var pendingPOsCount = orders.filter(function (o) { return o.cuttingStatus !== 'complete'; }).length;
  var pendingBendingCount = listPendingBendingOrders().length;

  var pendingMultiYieldDecisions = [];
  orders.forEach(function (o) {
    if (o.hasPendingMultiYield) {
      pendingMultiYieldDecisions.push({ poNumber: o.poNumber, modelName: o.modelName });
    }
  });

  var stockShort = listSheetStock().filter(function (s) { return s.qty < 0; });

  var recentExtras = getAllRows('CuttingExtras')
    .sort(function (a, b) { return String(b.Timestamp).localeCompare(String(a.Timestamp)); })
    .slice(0, 5)
    .map(function (r) {
      return { type: 'extra', poNumber: String(r.PoNumber), timestamp: r.Timestamp, detail: r.Type === 'extra-sheet' ? 'Extra Sheet Cut' : 'Extra Part' };
    });

  var recentOrders = orders.slice()
    .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); })
    .slice(0, 5)
    .map(function (o) {
      return { type: 'order', poNumber: o.poNumber, timestamp: o.createdAt, detail: o.modelName + ' × ' + o.qty };
    });

  var recentActivity = recentExtras.concat(recentOrders)
    .sort(function (a, b) { return String(b.timestamp).localeCompare(String(a.timestamp)); })
    .slice(0, 8);

  return {
    pendingPOsCount: pendingPOsCount,
    pendingBendingCount: pendingBendingCount,
    pendingMultiYieldDecisions: pendingMultiYieldDecisions,
    stockShort: stockShort,
    recentActivity: recentActivity
  };
}
