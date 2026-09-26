-- =====================================================================
-- Almirah Production Tracker — Supabase schema (Phase 0, additive)
--
-- Mirrors TAB_HEADERS in google-scripts/src/SheetService.gs as closely as
-- is sensible. Nothing here touches the Apps Script backend or the Sheet;
-- this only stands the new data layer up alongside them.
--
-- DESIGN DECISION — the JSON blobs stay JSON.
-- SheetCompletion / BendingCompletion / MultiYieldDecisions /
-- SheetQtyOverrides / PlanEntryInventoryMoves / *CompletionMeta are all
-- positionally indexed to the order's ACTIVE plan version, and
-- MultiYield.gs, Bending.gs, Orders.gs, PoHistory.gs and the client-side
-- computeSheetPlanClient mirror all assume exactly that shape. Normalising
-- them into real rows means rewriting every one of those - a different
-- project from "make it fast". Keeping them as jsonb makes the port
-- mechanical and makes the Sheets mirror a straight column <-> cell map.
-- Normalise later, once the new path is proven, if it ever earns its cost.
--
-- Run this once in the Supabase SQL Editor. It is idempotent.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- updated_at maintenance
--
-- Every table carries BOTH updated_at (set here, on any write from the
-- app) and last_edited_in_sheet (stamped by the Apps Script onEdit
-- trigger). The sync job compares the two to decide which side is newer.
-- Keeping them in separate columns - rather than one "last modified" -
-- is what makes that comparison possible at all.
-- ---------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Cutting Configuration
-- ---------------------------------------------------------------------

-- parts_per_unit: { "PART NAME": { "qty": 4, "size": "510X890" } }
-- A bare number is the older shape and is still read correctly by the app;
-- stored as-is either way. This map is the order's real per-part
-- requirement (qty x orders.qty) - never re-derive it from sheet yield.
create table if not exists models (
  model_name            text primary key,
  parts_per_unit        jsonb       not null default '{}'::jsonb,
  updated_at            timestamptz not null default now(),
  last_edited_in_sheet  timestamptz
);

-- sheets: [ { width, height, thickness, qty?,
--             outputs: [ { partName, qty, isExtra?, size?,
--                          multiYield?, yieldPerSheet? } ] } ]
-- base_qty is 0 for per-unit plans; for bulk, every output qty means
-- "per base_qty units", not per 1.
create table if not exists cutting_plans (
  model_name            text        not null references models(model_name) on delete cascade,
  plan_name             text        not null,
  sheets                jsonb       not null default '[]'::jsonb,
  plan_type             text        not null default 'per-unit'
                                    check (plan_type in ('per-unit', 'bulk')),
  base_qty              integer     not null default 0,
  updated_at            timestamptz not null default now(),
  last_edited_in_sheet  timestamptz,
  primary key (model_name, plan_name)
);

-- Immutable once written: saving again always creates a NEW version rather
-- than overwriting, so there is deliberately no updated_at here.
create table if not exists plan_versions (
  version_id        text primary key,
  model_name        text        not null references models(model_name) on delete cascade,
  version_number    integer     not null,
  source_plan_name  text        not null,
  sheets            jsonb       not null default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  note              text        not null default '',
  unique (model_name, version_number)
);

-- ---------------------------------------------------------------------
-- Orders
--
-- delivery_deadline stays TEXT rather than becoming a date: the Sheet
-- holds free-form strings including '' for "not set", and a real date
-- column would reject those on import. Convert later if it earns it.
-- ---------------------------------------------------------------------
create table if not exists orders (
  po_number                     text primary key,
  model_name                    text        not null references models(model_name),
  plan_name                     text        not null,
  qty                           integer     not null default 0,
  dxf_ref_no                    text        not null default '',
  colour_plan                   text        not null default '',
  delivery_deadline             text        not null default '',
  party_name                    text        not null default '',

  -- empty until a version is explicitly saved for this PO
  plan_version_id               text        references plan_versions(version_id),

  -- positional, indexed to the active version's sheets / flattened outputs
  sheet_completion              jsonb       not null default '[]'::jsonb,
  bending_completion            jsonb       not null default '[]'::jsonb,

  total_sheets_required         integer     not null default 0,
  cutting_status                text        not null default 'pending',
  bending_status                text        not null default 'pending',
  created_at                    timestamptz not null default now(),

  multi_yield_decisions         jsonb       not null default '{}'::jsonb,
  sheet_stock_consumed          jsonb       not null default '{}'::jsonb,

  -- snapshotted from the plan AT CREATION; qty above is always the real
  -- total unit count either way
  plan_type                     text        not null default 'per-unit',
  bulk_base_qty                 integer     not null default 0,
  bulk_multiplier               integer     not null default 0,

  sheet_qty_overrides           jsonb       not null default '{}'::jsonb,
  bending_leftover_consumed     jsonb       not null default '{}'::jsonb,

  -- string-keyed, NOT a positional array: extras can be logged at any time
  -- after the plan's shape is fixed
  extra_bending_completion      jsonb       not null default '{}'::jsonb,

  plan_entry_inventory_moves    jsonb       not null default '{}'::jsonb,

  -- { "<index-or-key>": { "at": iso, "by": name } }
  sheet_completion_meta         jsonb       not null default '{}'::jsonb,
  bending_completion_meta       jsonb       not null default '{}'::jsonb,
  extra_bending_completion_meta jsonb       not null default '{}'::jsonb,

  updated_at                    timestamptz not null default now(),
  last_edited_in_sheet          timestamptz
);

create index if not exists orders_model_idx  on orders (model_name);
create index if not exists orders_cutting_idx on orders (cutting_status);
create index if not exists orders_bending_idx on orders (bending_status);

-- PO numbers: a real sequence, replacing generatePoNumber()'s max()+1 scan.
-- That scan is race-prone - it simply never raced at one order a week. The
-- sequence is seeded from existing data at the bottom of this file.
create sequence if not exists po_number_seq;

create or replace function next_po_number()
returns text
language sql
as $$
  select 'PO-' || lpad(nextval('po_number_seq')::text, 4, '0');
$$;

-- ---------------------------------------------------------------------
-- Extras / Leftover Ledger
-- ---------------------------------------------------------------------

-- type:
--   extra-sheet     details: { width,height,thickness, partsProduced:{name:qty}, ... }
--   extra-part      details: { partName, qty, size, isExtra, isUniversal?, modelName? }
--   inventory-pull  details: { partName, qty, size, sourceModel }
-- added_to_inventory: { "<partName>|main": true } - the single source of
-- truth for "already posted to the ledger", shared by the logging-time
-- checkbox and Bending's second-chance button so neither can double-post.
-- EVERY row here also becomes a Bending task (getExtraBendingEntries).
create table if not exists cutting_extras (
  extra_id            text primary key,
  po_number           text        not null references orders(po_number) on delete cascade,
  type                text        not null
                                  check (type in ('extra-sheet', 'extra-part', 'inventory-pull')),
  details             jsonb       not null default '{}'::jsonb,
  timestamp           timestamptz not null default now(),
  added_to_inventory  jsonb       not null default '{}'::jsonb
);

create index if not exists cutting_extras_po_idx on cutting_extras (po_number);

-- model_name may be the literal 'Universal' (UNIVERSAL_MODEL_TAG) rather
-- than a real model, so this deliberately does NOT reference models.
-- Matching is exact on all three key parts - no fuzzy matching, same rule
-- addToExtraPartInventory enforces today.
create table if not exists extra_part_inventory (
  model_name            text        not null,
  part_name             text        not null,
  size                  text        not null default '',
  qty                   integer     not null default 0,
  updated_at            timestamptz not null default now(),
  last_edited_in_sheet  timestamptz,
  primary key (model_name, part_name, size)
);

-- Append-only. extra_part_inventory holds only running totals, so this is
-- the only record of who moved ledger stock and why.
create table if not exists extra_inventory_log (
  log_id      text primary key,
  model_name  text        not null,
  part_name   text        not null,
  size        text        not null default '',
  delta       integer     not null,
  reason      text        not null default '',
  po_number   text        not null default '',
  actor       text        not null default '',
  timestamp   timestamptz not null default now(),
  note        text        not null default ''
);

create index if not exists extra_inventory_log_po_idx on extra_inventory_log (po_number);

-- ---------------------------------------------------------------------
-- Raw sheet stock
-- ---------------------------------------------------------------------

-- size is the canonical "<w>x<h>x<t>" key from sheetSizeKey(). qty MAY go
-- negative - a PO short on stock still gets created, it just warns - so
-- there is deliberately no check constraint here.
-- NOTE: two rows in live data ('CR Sheet Mix', 'HR Sheet 2.0mm 5FT') are
-- placeholder buckets with no real dimensions and 0/0/0 for w/h/t.
create table if not exists sheet_stock (
  size                  text primary key,
  width                 numeric     not null default 0,
  height                numeric     not null default 0,
  thickness             numeric     not null default 0,
  qty                   integer     not null default 0,
  updated_at            timestamptz not null default now(),
  last_edited_in_sheet  timestamptz
);

create table if not exists sheet_stock_log (
  log_id     text primary key,
  size       text        not null,
  delta      integer     not null,
  reason     text        not null default '',
  po_number  text        not null default '',
  timestamp  timestamptz not null default now(),
  note       text        not null default ''
);

create index if not exists sheet_stock_log_po_idx on sheet_stock_log (po_number);

-- ---------------------------------------------------------------------
-- Users
--
-- profiles extends Supabase Auth's auth.users rather than replacing it.
-- permissions keeps the EXACT shape the app uses today
--   { menuKey: 'none' | 'view' | 'edit' }  over Auth.gs's MENU_KEYS
-- so canView/canEdit in app.js port across unchanged. Admins bypass it.
--
-- Usernames are not emails, so each user gets a synthetic
-- <username>@almirah.local address in auth.users; username is kept here
-- as the thing people actually type and the thing shown in the UI.
-- ---------------------------------------------------------------------
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text        not null unique,
  role         text        not null default 'user' check (role in ('admin', 'user')),
  permissions  jsonb       not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  created_by   text        not null default '',
  updated_at   timestamptz not null default now()
);

-- Helpers for policies / RPC guards. SECURITY DEFINER + a pinned
-- search_path so they can read profiles regardless of the caller's own
-- access, without becoming an injection surface.
create or replace function current_role_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'admin' from profiles where id = auth.uid()), false);
$$;

-- menu_key: one of Auth.gs's MENU_KEYS. needed: 'view' | 'edit'.
-- 'edit' satisfies a 'view' requirement; admins satisfy everything.
create or replace function has_menu_access(menu_key text, needed text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce((select role = 'admin' from profiles where id = auth.uid()), false)
      then true
    when needed = 'view'
      then coalesce((select permissions ->> menu_key from profiles where id = auth.uid()), 'none')
           in ('view', 'edit')
    else
      coalesce((select permissions ->> menu_key from profiles where id = auth.uid()), 'none')
           = 'edit'
  end;
$$;

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'models', 'cutting_plans', 'orders',
    'extra_part_inventory', 'sheet_stock', 'profiles'
  ] loop
    execute format('drop trigger if exists %I_set_updated_at on %I', t, t);
    execute format(
      'create trigger %I_set_updated_at before update on %I
         for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security
--
-- Enabled on every table with NO policies yet, which means deny-all to the
-- anon and authenticated keys. That is the intended state at the end of
-- Phase 0: the anon key is public by design (it ships in the frontend), so
-- the tables must be unreachable with it until access is designed
-- deliberately. The SQL Editor and the service_role key bypass RLS, so
-- seeding still works.
--
-- Access policies come in Phase 1 - see the note in the migration plan
-- about permissions being action-scoped rather than table-scoped.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'models', 'cutting_plans', 'plan_versions', 'orders',
    'cutting_extras', 'extra_part_inventory', 'extra_inventory_log',
    'sheet_stock', 'sheet_stock_log', 'profiles'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Seed the PO sequence past whatever already exists, so the first PO
-- created here can never collide with one already in the Sheet.
-- Safe to re-run: setval is absolute, not relative.
-- ---------------------------------------------------------------------
select setval(
  'po_number_seq',
  greatest(
    coalesce((
      select max((regexp_replace(po_number, '\D', '', 'g'))::bigint)
      from orders
      where po_number ~ '^PO-\d+$'
    ), 0),
    1
  )
);
