var TAB_HEADERS = {
  Models: ['ModelName', 'PartsPerUnit', 'UpdatedAt'],
  CuttingPlans: ['ModelName', 'PlanName', 'Sheets', 'UpdatedAt', 'PlanType', 'BaseQty'],
  Orders: ['PoNumber', 'ModelName', 'PlanName', 'Qty', 'DxfRefNo', 'ColourPlan', 'DeliveryDeadline', 'PartyName', 'PlanVersionId', 'SheetCompletion', 'BendingCompletion', 'TotalSheetsRequired', 'CuttingStatus', 'BendingStatus', 'CreatedAt', 'MultiYieldDecisions', 'SheetStockConsumed', 'PlanType', 'BulkBaseQty', 'BulkMultiplier', 'SheetQtyOverrides', 'BendingLeftoverConsumed', 'ExtraBendingCompletion', 'PlanEntryInventoryMoves', 'SheetCompletionMeta', 'BendingCompletionMeta', 'ExtraBendingCompletionMeta'],
  PlanVersions: ['VersionId', 'ModelName', 'VersionNumber', 'SourcePlanName', 'Sheets', 'CreatedAt', 'Note'],
  CuttingExtras: ['ExtraId', 'PoNumber', 'Type', 'Details', 'Timestamp', 'AddedToInventory'],
  ExtraPartInventory: ['ModelName', 'PartName', 'Size', 'Qty', 'UpdatedAt'],
  // Per-movement audit trail for ExtraPartInventory (the Leftover Ledger),
  // mirroring SheetStockLog's role for raw sheets. ExtraPartInventory itself
  // only holds a running balance per part, so without this there's no way to
  // answer "what moved in/out for this PO, when, and who did it" - which is
  // exactly what the PO History report needs. Delta > 0 is stock added,
  // delta < 0 is stock consumed.
  ExtraInventoryLog: ['LogId', 'ModelName', 'PartName', 'Size', 'Delta', 'Reason', 'PoNumber', 'Actor', 'Timestamp', 'Note'],
  SheetStock: ['Size', 'Width', 'Height', 'Thickness', 'Qty', 'UpdatedAt'],
  SheetStockLog: ['LogId', 'Size', 'Delta', 'Reason', 'PoNumber', 'Timestamp', 'Note'],
  // Named AppUsers/AppSessions, not Users/Sessions - a tab literally named
  // "Users" already existed in this spreadsheet from before the project's
  // full reset (a different, unrelated login system). setupSpreadsheet()
  // only rewrites header LABELS, never touches existing data rows (gotcha
  // #2), so reusing that name would have silently relabeled that old tab's
  // stale row underneath our new columns instead of starting fresh - caught
  // live via a stray "Admin" row dated from before this rebuild even began.
  AppUsers: ['UserId', 'Username', 'PasswordHash', 'PasswordSalt', 'Role', 'Permissions', 'CreatedAt', 'CreatedBy'],
  AppSessions: ['Token', 'UserId', 'CreatedAt', 'ExpiresAt']
};

// The project is STANDALONE, not bound to the spreadsheet, so there is no
// "active" spreadsheet to pick up implicitly - it has to be opened by id.
//
// Standalone because the original bound project hit Apps Script's hard
// ceiling of 200 versions (they cannot be deleted), and a spreadsheet can
// only ever have one bound script - so a replacement had to live outside
// it. The id is read from Script Properties rather than hardcoded: it is
// the address of the entire business dataset, and this repo is on GitHub.
//
// Cached per execution; opening a spreadsheet is a real round trip and
// getSheet() is called many times per request.
var _spreadsheetHandle = null;

function getSpreadsheet() {
  if (_spreadsheetHandle) return _spreadsheetHandle;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) {
    throw new Error('SPREADSHEET_ID script property is not set — see Project Settings.');
  }
  _spreadsheetHandle = SpreadsheetApp.openById(id);
  return _spreadsheetHandle;
}

function getSheet(tabName) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    throw new Error('Unknown tab: ' + tabName);
  }
  return sheet;
}

function rowsToObjects(sheet) {
  return valuesToObjects(sheet.getDataRange().getValues());
}

function valuesToObjects(values) {
  var headers = values[0];
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      obj[headers[c]] = row[c];
    }
    obj._rowIndex = i + 1;
    out.push(obj);
  }
  return out;
}

// Per-execution read cache. A single doGet/doPost call routinely reads the
// same tab many times over (e.g. listPendingBendingOrders reads
// CuttingPlans/PlanVersions once per order row) and every one of those was
// a fresh getDataRange().getValues() round trip - that N+1 pattern is what
// was making pages take 30+ seconds to load. This var is a fresh, empty
// object at the start of every execution (Apps Script gives each web app
// request its own runtime), so caching here never leaks stale data across
// requests - only repeat reads *within* the same request are served from
// memory. Any write (appendRow/writeRowUpdates/deleteRowsWhere) invalidates
// the affected tab immediately so a read-after-write in the same execution
// (e.g. createOrder appending then immediately re-reading its own row)
// always sees fresh data.
var _sheetRowCache = {};

function invalidateSheetCache(tabName) {
  delete _sheetRowCache[tabName];
  bumpSharedTabVersion(tabName);
}

function getAllRows(tabName) {
  if (!_sheetRowCache.hasOwnProperty(tabName)) {
    _sheetRowCache[tabName] = valuesToObjects(readTabValues(tabName));
  }
  return _sheetRowCache[tabName];
}

// --- Cross-request cache (CacheService) --------------------------------------
// Each tab read costs ~150ms-1.3s of Sheets latency no matter how few rows
// it has (measured live), and a page load touches 3-6 tabs incl. the
// AppSessions/AppUsers auth check. So GET requests read tab values from the
// script cache instead, keyed by a per-tab version that every write through
// this file bumps (and onEdit() below bumps for manual edits in the Sheet).
// Versioned keys make read/write races harmless: a reader that raced a write
// can only populate the *old* version's key, which nobody reads any more.
//
// POST requests (every write action) never read from it - _useSharedCache
// stays false - so the _rowIndex a write targets always comes from a fresh
// Sheet read, even if someone inserted/deleted rows by hand (a structural
// change onEdit doesn't see; those only affect GET display, until the TTL).
var _useSharedCache = false;
var SHARED_CACHE_TTL = 1800;   // seconds
var SHARED_CACHE_CHUNK = 30000; // chars; CacheService caps a value at 100KB

function sharedCache() {
  try { return CacheService.getScriptCache(); } catch (err) { return null; }
}

function bumpSharedTabVersion(tabName) {
  _sharedPrefetch = null;
  var cache = sharedCache();
  if (!cache) return;
  try { cache.put('v:' + tabName, Utilities.getUuid(), SHARED_CACHE_TTL); } catch (err) {}
}

// Every CacheService call is a ~50-300ms round trip of its own, so a hit
// must not cost one call per key. The first read in a request fetches every
// tab's version in ONE getAll, then every tab's first chunk in a second
// getAll - after that, most tab reads (data is small: one chunk) are free.
// Chunk 0 is stored as "<chunkCount>|<json chunk>".
var _sharedPrefetch = null;

function prefetchSharedCache(cache) {
  if (_sharedPrefetch) return _sharedPrefetch;
  var tabs = Object.keys(TAB_HEADERS);
  var versions = cache.getAll(tabs.map(function (t) { return 'v:' + t; }));
  var missing = {};
  var prefixes = {};
  tabs.forEach(function (t) {
    var ver = versions['v:' + t];
    if (!ver) {
      ver = Utilities.getUuid();
      missing['v:' + t] = ver;
    }
    prefixes[t] = 'd:' + t + ':' + ver + ':';
  });
  if (Object.keys(missing).length) cache.putAll(missing, SHARED_CACHE_TTL);
  var firstChunks = cache.getAll(tabs.map(function (t) { return prefixes[t] + '0'; }));
  _sharedPrefetch = { prefixes: prefixes, firstChunks: firstChunks };
  return _sharedPrefetch;
}

function readTabValues(tabName) {
  var cache = _useSharedCache ? sharedCache() : null;
  var prefix = null;
  if (cache && TAB_HEADERS.hasOwnProperty(tabName)) {
    try {
      var pre = prefetchSharedCache(cache);
      prefix = pre.prefixes[tabName];
      var first = pre.firstChunks[prefix + '0'];
      delete pre.firstChunks[prefix + '0']; // only trust it once per request
      if (first != null) {
        var bar = first.indexOf('|');
        var count = Number(first.substring(0, bar));
        var joined = first.substring(bar + 1);
        var complete = count >= 1;
        if (count > 1) {
          var keys = [];
          for (var i = 1; i < count; i++) keys.push(prefix + i);
          var parts = cache.getAll(keys);
          for (var j = 1; j < count; j++) {
            if (parts[prefix + j] == null) { complete = false; break; }
            joined += parts[prefix + j];
          }
        }
        if (complete) return JSON.parse(joined, reviveCachedDate);
      }
    } catch (err) { prefix = null; }
  }

  var values = getSheet(tabName).getDataRange().getValues();

  if (cache && prefix) {
    try {
      var json = JSON.stringify(values, function (k, v) {
        return this[k] instanceof Date ? { __d: this[k].getTime() } : v;
      });
      var chunks = [];
      for (var pos = 0; pos < json.length; pos += SHARED_CACHE_CHUNK) {
        chunks.push(json.substr(pos, SHARED_CACHE_CHUNK));
      }
      if (chunks.length && chunks.length <= 200) {
        var entries = {};
        chunks.forEach(function (c, n) {
          entries[prefix + n] = n === 0 ? chunks.length + '|' + c : c;
        });
        cache.putAll(entries, SHARED_CACHE_TTL);
      }
    } catch (err) { /* too big / quota - just don't cache */ }
  }
  return values;
}

function reviveCachedDate(k, v) {
  return (v && typeof v === 'object' && typeof v.__d === 'number' && Object.keys(v).length === 1) ? new Date(v.__d) : v;
}

// Simple trigger: a manual cell edit in the Sheet invalidates that tab.
function onEdit(e) {
  try { bumpSharedTabVersion(e.range.getSheet().getName()); } catch (err) {}
}

function findRows(tabName, matchFn) {
  return getAllRows(tabName).filter(matchFn);
}

function findRowById(tabName, idColumn, idValue) {
  var rows = getAllRows(tabName);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][idColumn]) === String(idValue)) return rows[i];
  }
  return null;
}

function appendRow(tabName, rowObj) {
  var sheet = getSheet(tabName);
  var headers = TAB_HEADERS[tabName];
  var row = headers.map(function (h) {
    return rowObj.hasOwnProperty(h) ? rowObj[h] : '';
  });
  sheet.appendRow(row);
  invalidateSheetCache(tabName);
  // Mirror from the row array actually written, not from rowObj: appendRow
  // fills missing columns with '', and mirroring rowObj alone would leave
  // those columns absent in Supabase rather than empty.
  var mirrored = {};
  headers.forEach(function (h, i) { mirrored[h] = row[i]; });
  supabasePush(tabName, [mirrored]);
  return rowObj;
}

function writeRowUpdates(tabName, rowIndex, updates) {
  var sheet = getSheet(tabName);
  var headers = TAB_HEADERS[tabName];
  var idxByHeader = {};
  headers.forEach(function (h, i) {
    idxByHeader[h] = i + 1;
  });
  Object.keys(updates).forEach(function (key) {
    if (!idxByHeader.hasOwnProperty(key)) return;
    sheet.getRange(rowIndex, idxByHeader[key]).setValue(updates[key]);
  });
  invalidateSheetCache(tabName);
  // Re-reads the row so the mirror carries every column - `updates` only
  // holds the ones that changed, and upserting from those would blank the
  // rest in Supabase.
  supabaseMirrorRowIndex(tabName, rowIndex);
}

function updateRowById(tabName, idColumn, idValue, updates) {
  var existing = findRowById(tabName, idColumn, idValue);
  if (!existing) {
    throw new Error('Row not found: ' + tabName + '.' + idColumn + ' = ' + idValue);
  }
  writeRowUpdates(tabName, existing._rowIndex, updates);
  return findRowById(tabName, idColumn, idValue);
}

function findRow(tabName, matchFn) {
  var rows = getAllRows(tabName);
  for (var i = 0; i < rows.length; i++) {
    if (matchFn(rows[i])) return rows[i];
  }
  return null;
}

function updateRow(tabName, matchFn, updates) {
  var existing = findRow(tabName, matchFn);
  if (!existing) {
    throw new Error('Row not found in ' + tabName);
  }
  writeRowUpdates(tabName, existing._rowIndex, updates);
  return findRow(tabName, matchFn);
}

function deleteRowsWhere(tabName, matchFn) {
  var sheet = getSheet(tabName);
  var rows = findRows(tabName, matchFn);
  rows.sort(function (a, b) {
    return b._rowIndex - a._rowIndex;
  });
  rows.forEach(function (r) {
    sheet.deleteRow(r._rowIndex);
  });
  invalidateSheetCache(tabName);
  // Captured before deletion above, so the natural keys are still available
  // to delete the matching Supabase rows.
  supabaseDelete(tabName, rows);
  return rows.length;
}
