// Pushes every Sheet write through to Supabase, so Supabase can serve the
// app's reads at ~0.1s while the Sheet remains the source of truth and the
// write path stays exactly as it is.
//
// Deliberately one-way and best-effort: a mirror failure must never block
// or fail the user's write. If a push is lost, supabaseBackfillAll()
// repairs the affected tab wholesale - every push is an upsert on the
// natural key, so re-running is always safe.
//
// Credentials live in Script Properties (File > Project Settings), never
// in source: SUPABASE_URL and SUPABASE_SERVICE_KEY. The service key
// bypasses RLS, which is required here - this process writes on behalf of
// the system, not on behalf of a signed-in user.

var SUPABASE_MIRROR_ENABLED = true;

// AppUsers/AppSessions are deliberately NOT mirrored. Auth now lives in
// Supabase Auth + profiles (keyed by auth.users.id), so copying the old
// Sheet rows over would fight that, and AppSessions is session tokens -
// there is no reason for those to leave the Sheet.
var SUPABASE_TABLES = {
  Models: {
    table: 'models',
    pk: ['model_name'],
    cols: {
      ModelName: ['model_name', 'text'],
      PartsPerUnit: ['parts_per_unit', 'json'],
      UpdatedAt: ['updated_at', 'ts']
    }
  },
  CuttingPlans: {
    table: 'cutting_plans',
    pk: ['model_name', 'plan_name'],
    cols: {
      ModelName: ['model_name', 'text'],
      PlanName: ['plan_name', 'text'],
      Sheets: ['sheets', 'json', '[]'],
      UpdatedAt: ['updated_at', 'ts'],
      PlanType: ['plan_type', 'text'],
      BaseQty: ['base_qty', 'int']
    }
  },
  PlanVersions: {
    table: 'plan_versions',
    pk: ['version_id'],
    cols: {
      VersionId: ['version_id', 'text'],
      ModelName: ['model_name', 'text'],
      VersionNumber: ['version_number', 'int'],
      SourcePlanName: ['source_plan_name', 'text'],
      Sheets: ['sheets', 'json', '[]'],
      CreatedAt: ['created_at', 'ts'],
      Note: ['note', 'text']
    }
  },
  Orders: {
    table: 'orders',
    pk: ['po_number'],
    cols: {
      PoNumber: ['po_number', 'text'],
      ModelName: ['model_name', 'text'],
      PlanName: ['plan_name', 'text'],
      Qty: ['qty', 'int'],
      DxfRefNo: ['dxf_ref_no', 'text'],
      ColourPlan: ['colour_plan', 'text'],
      DeliveryDeadline: ['delivery_deadline', 'text'],
      PartyName: ['party_name', 'text'],
      PlanVersionId: ['plan_version_id', 'textOrNull'],
      SheetCompletion: ['sheet_completion', 'json', '[]'],
      BendingCompletion: ['bending_completion', 'json', '[]'],
      TotalSheetsRequired: ['total_sheets_required', 'int'],
      CuttingStatus: ['cutting_status', 'text'],
      BendingStatus: ['bending_status', 'text'],
      CreatedAt: ['created_at', 'ts'],
      MultiYieldDecisions: ['multi_yield_decisions', 'json'],
      SheetStockConsumed: ['sheet_stock_consumed', 'json'],
      PlanType: ['plan_type', 'text'],
      BulkBaseQty: ['bulk_base_qty', 'int'],
      BulkMultiplier: ['bulk_multiplier', 'int'],
      SheetQtyOverrides: ['sheet_qty_overrides', 'json'],
      BendingLeftoverConsumed: ['bending_leftover_consumed', 'json'],
      ExtraBendingCompletion: ['extra_bending_completion', 'json'],
      PlanEntryInventoryMoves: ['plan_entry_inventory_moves', 'json'],
      SheetCompletionMeta: ['sheet_completion_meta', 'json'],
      BendingCompletionMeta: ['bending_completion_meta', 'json'],
      ExtraBendingCompletionMeta: ['extra_bending_completion_meta', 'json']
    }
  },
  CuttingExtras: {
    table: 'cutting_extras',
    pk: ['extra_id'],
    cols: {
      ExtraId: ['extra_id', 'text'],
      PoNumber: ['po_number', 'text'],
      Type: ['type', 'text'],
      Details: ['details', 'json'],
      Timestamp: ['timestamp', 'ts'],
      AddedToInventory: ['added_to_inventory', 'json']
    }
  },
  ExtraPartInventory: {
    table: 'extra_part_inventory',
    pk: ['model_name', 'part_name', 'size'],
    cols: {
      ModelName: ['model_name', 'text'],
      PartName: ['part_name', 'text'],
      Size: ['size', 'text'],
      Qty: ['qty', 'int'],
      UpdatedAt: ['updated_at', 'ts']
    }
  },
  ExtraInventoryLog: {
    table: 'extra_inventory_log',
    pk: ['log_id'],
    cols: {
      LogId: ['log_id', 'text'],
      ModelName: ['model_name', 'text'],
      PartName: ['part_name', 'text'],
      Size: ['size', 'text'],
      Delta: ['delta', 'int'],
      Reason: ['reason', 'text'],
      PoNumber: ['po_number', 'text'],
      Actor: ['actor', 'text'],
      Timestamp: ['timestamp', 'ts'],
      Note: ['note', 'text']
    }
  },
  SheetStock: {
    table: 'sheet_stock',
    pk: ['size'],
    cols: {
      Size: ['size', 'text'],
      Width: ['width', 'num'],
      Height: ['height', 'num'],
      Thickness: ['thickness', 'num'],
      Qty: ['qty', 'int'],
      UpdatedAt: ['updated_at', 'ts']
    }
  },
  SheetStockLog: {
    table: 'sheet_stock_log',
    pk: ['log_id'],
    cols: {
      LogId: ['log_id', 'text'],
      Size: ['size', 'text'],
      Delta: ['delta', 'int'],
      Reason: ['reason', 'text'],
      PoNumber: ['po_number', 'text'],
      Timestamp: ['timestamp', 'ts'],
      Note: ['note', 'text']
    }
  }
};

function supabaseConfig() {
  var p = PropertiesService.getScriptProperties();
  var url = p.getProperty('SUPABASE_URL');
  var key = p.getProperty('SUPABASE_SERVICE_KEY');
  if (!url || !key) return null;
  return { url: String(url).replace(/\/+$/, ''), key: String(key) };
}

// Sheet cells come back as JS numbers/strings/Dates/booleans; Postgres
// wants each column's own type. The JSON columns matter most: the Sheet
// holds them as TEXT, and sending that text straight through would store a
// JSON *string* rather than an object, so every jsonb query against it
// would quietly return nothing.
// jsonDefault is '{}' unless the column is an array ('[]'). It is NOT
// optional: every jsonb column in the schema is NOT NULL, and cells for
// columns added later than a row are empty strings - PO-0001 predates
// PlanEntryInventoryMoves and the *CompletionMeta maps, so returning null
// there fails the whole upsert with 23502 and silently stops that row ever
// mirroring again. Shape matters too: an array column defaulted to {} would
// break every positional index built on it.
function supabaseCoerce(value, kind, jsonDefault) {
  if (kind === 'json') {
    var fallback = JSON.parse(jsonDefault || '{}');
    if (value === '' || value === null || value === undefined) return fallback;
    try {
      var parsed = JSON.parse(String(value));
      return (parsed === null || parsed === undefined) ? fallback : parsed;
    } catch (err) {
      return fallback;
    }
  }
  if (kind === 'ts') {
    if (value === '' || value === null || value === undefined) return null;
    if (Object.prototype.toString.call(value) === '[object Date]') return value.toISOString();
    return String(value);
  }
  if (kind === 'int' || kind === 'num') {
    var n = Number(value);
    return isNaN(n) ? 0 : n;
  }
  if (kind === 'textOrNull') {
    return (value === '' || value === null || value === undefined) ? null : String(value);
  }
  return value === null || value === undefined ? '' : String(value);
}

function supabaseRowFromSheetRow(tabName, rowObj) {
  var spec = SUPABASE_TABLES[tabName];
  if (!spec) return null;
  var out = {};
  Object.keys(spec.cols).forEach(function (header) {
    var col = spec.cols[header];
    out[col[0]] = supabaseCoerce(rowObj[header], col[1], col[2]);
  });
  return out;
}

// Upsert one or more rows. on_conflict names the natural key so a repeat
// push updates in place rather than erroring or duplicating - which is
// what makes both the per-write mirror and the backfill idempotent.
function supabasePush(tabName, rows) {
  if (!SUPABASE_MIRROR_ENABLED) return;
  var spec = SUPABASE_TABLES[tabName];
  if (!spec || !rows || !rows.length) return;
  var cfg = supabaseConfig();
  if (!cfg) return;

  var payload = [];
  for (var i = 0; i < rows.length; i++) {
    var mapped = supabaseRowFromSheetRow(tabName, rows[i]);
    if (mapped) payload.push(mapped);
  }
  if (!payload.length) return;

  try {
    var res = UrlFetchApp.fetch(
      cfg.url + '/rest/v1/' + spec.table + '?on_conflict=' + spec.pk.join(','),
      {
        method: 'post',
        contentType: 'application/json',
        headers: {
          apikey: cfg.key,
          Authorization: 'Bearer ' + cfg.key,
          Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      }
    );
    var code = res.getResponseCode();
    if (code >= 300) {
      supabaseLogFailure(tabName, code + ' ' + res.getContentText().slice(0, 300));
    }
  } catch (err) {
    supabaseLogFailure(tabName, String(err));
  }
}

function supabaseDelete(tabName, rows) {
  if (!SUPABASE_MIRROR_ENABLED) return;
  var spec = SUPABASE_TABLES[tabName];
  if (!spec || !rows || !rows.length) return;
  var cfg = supabaseConfig();
  if (!cfg) return;

  for (var i = 0; i < rows.length; i++) {
    var mapped = supabaseRowFromSheetRow(tabName, rows[i]);
    if (!mapped) continue;
    var filters = spec.pk.map(function (col) {
      return col + '=eq.' + encodeURIComponent(mapped[col]);
    }).join('&');
    try {
      var res = UrlFetchApp.fetch(cfg.url + '/rest/v1/' + spec.table + '?' + filters, {
        method: 'delete',
        headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, Prefer: 'return=minimal' },
        muteHttpExceptions: true
      });
      if (res.getResponseCode() >= 300) {
        supabaseLogFailure(tabName, 'delete ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
      }
    } catch (err) {
      supabaseLogFailure(tabName, 'delete ' + String(err));
    }
  }
}

// Failures are recorded rather than thrown - the user's write has already
// succeeded in the Sheet by this point, and failing it now would be worse
// than being briefly out of sync. Kept in Script Properties so it survives
// the execution and is visible without opening the logs.
function supabaseLogFailure(tabName, message) {
  try {
    var p = PropertiesService.getScriptProperties();
    p.setProperty('SUPABASE_LAST_ERROR', nowIso() + ' [' + tabName + '] ' + message);
    var n = Number(p.getProperty('SUPABASE_ERROR_COUNT') || 0) + 1;
    p.setProperty('SUPABASE_ERROR_COUNT', String(n));
  } catch (err) {
    // nothing left to do if even this fails
  }
}

// Push one sheet row by its row index, reading the row back so the mirror
// always carries the FULL row. writeRowUpdates only knows the columns it
// changed, and an upsert built from those alone would blank every other
// column in Supabase.
function supabaseMirrorRowIndex(tabName, rowIndex) {
  if (!SUPABASE_MIRROR_ENABLED || !SUPABASE_TABLES[tabName]) return;
  try {
    var sheet = getSheet(tabName);
    var headers = TAB_HEADERS[tabName];
    var values = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
    var rowObj = {};
    headers.forEach(function (h, i) { rowObj[h] = values[i]; });
    supabasePush(tabName, [rowObj]);
  } catch (err) {
    supabaseLogFailure(tabName, 'mirrorRow ' + String(err));
  }
}

// Repair / initial load: push every row of every mirrored tab. Safe to run
// at any time; upserts mean it converges rather than duplicating. Run it
// from the Apps Script editor after any period where the mirror was off or
// erroring.
function supabaseBackfillAll() {
  var report = {};
  Object.keys(SUPABASE_TABLES).forEach(function (tabName) {
    try {
      var rows = getAllRows(tabName);
      supabasePush(tabName, rows);
      report[tabName] = rows.length;
    } catch (err) {
      report[tabName] = 'ERROR ' + String(err);
    }
  });
  var p = PropertiesService.getScriptProperties();
  report.lastError = p.getProperty('SUPABASE_LAST_ERROR') || 'none';
  report.errorCount = p.getProperty('SUPABASE_ERROR_COUNT') || '0';
  Logger.log(JSON.stringify(report));
  return report;
}

function supabaseMirrorStatus() {
  var p = PropertiesService.getScriptProperties();
  var cfg = supabaseConfig();
  return {
    enabled: SUPABASE_MIRROR_ENABLED,
    configured: !!cfg,
    url: cfg ? cfg.url : null,
    lastError: p.getProperty('SUPABASE_LAST_ERROR') || 'none',
    errorCount: Number(p.getProperty('SUPABASE_ERROR_COUNT') || 0)
  };
}

function supabaseClearErrors() {
  var p = PropertiesService.getScriptProperties();
  p.deleteProperty('SUPABASE_LAST_ERROR');
  p.deleteProperty('SUPABASE_ERROR_COUNT');
  return { cleared: true };
}
