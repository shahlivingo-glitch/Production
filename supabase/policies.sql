-- =====================================================================
-- Phase 1 — READ access.
--
-- THE SHAPE OF THIS, AND WHY
--
-- The app's permissions are action-scoped, not table-scoped. ABHISHEK has
-- cuttingStage:edit but orders:none - yet Cutting Stage reads and writes
-- orders rows constantly. So "grant the orders table to whoever has the
-- orders menu" is simply wrong: it would lock him out of his own job.
--
-- Reads therefore grant a table to the OR of every menu whose screens
-- legitimately display that table. That is faithful to what each user can
-- already see on screen today, and it is expressible in RLS - which means
-- reads can go straight to PostgREST at ~60ms.
--
-- WRITES ARE NOT DONE HERE, deliberately. A write like "mark a sheet cut"
-- touches orders + sheet_stock + extra_part_inventory + sheet_stock_log
-- together, and is only legitimate as that whole operation - not as
-- permission to write those tables individually. Those become SECURITY
-- DEFINER functions in the next step, one per action, which also makes
-- them atomic (today applyCutStockAndLedger is several best-effort writes
-- with swallowed errors).
--
-- Dashboard and PO History are "any signed-in user" by design (see
-- CLAUDE.md - they are deliberately absent from ACTION_MENUS). Those stay
-- out of RLS too and become SECURITY DEFINER read functions, so they can
-- serve everyone without opening the underlying tables to everyone.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Cutting Configuration data.
-- Read by its own page, by the PO form (model + plan pickers), by Cutting
-- Stage (modelParts in the bundle) and by Bending (buildStillToCut needs
-- parts_per_unit to know the requirement).
-- ---------------------------------------------------------------------
drop policy if exists models_read on models;
create policy models_read on models for select to authenticated
using (
  has_menu_access('cuttingConfig', 'view')
  or has_menu_access('orders', 'view')
  or has_menu_access('cuttingStage', 'view')
  or has_menu_access('bendingStage', 'view')
);

drop policy if exists cutting_plans_read on cutting_plans;
create policy cutting_plans_read on cutting_plans for select to authenticated
using (
  has_menu_access('cuttingConfig', 'view')
  or has_menu_access('orders', 'view')
  or has_menu_access('cuttingStage', 'view')
  or has_menu_access('bendingStage', 'view')
);

-- Bending resolves an order's active sheets through here too.
drop policy if exists plan_versions_read on plan_versions;
create policy plan_versions_read on plan_versions for select to authenticated
using (
  has_menu_access('cuttingConfig', 'view')
  or has_menu_access('orders', 'view')
  or has_menu_access('cuttingStage', 'view')
  or has_menu_access('bendingStage', 'view')
);

-- ---------------------------------------------------------------------
-- Orders and the work derived from them.
-- ---------------------------------------------------------------------
drop policy if exists orders_read on orders;
create policy orders_read on orders for select to authenticated
using (
  has_menu_access('orders', 'view')
  or has_menu_access('cuttingStage', 'view')
  or has_menu_access('bendingStage', 'view')
);

drop policy if exists cutting_extras_read on cutting_extras;
create policy cutting_extras_read on cutting_extras for select to authenticated
using (
  has_menu_access('cuttingStage', 'view')
  or has_menu_access('bendingStage', 'view')
);

-- ---------------------------------------------------------------------
-- Leftover Ledger. Its own page, plus Cutting (the "already available"
-- note) and Bending (leftoverAvailable / pull-from-inventory).
-- ---------------------------------------------------------------------
drop policy if exists extra_part_inventory_read on extra_part_inventory;
create policy extra_part_inventory_read on extra_part_inventory for select to authenticated
using (
  has_menu_access('extraInventory', 'view')
  or has_menu_access('cuttingStage', 'view')
  or has_menu_access('bendingStage', 'view')
);

drop policy if exists extra_inventory_log_read on extra_inventory_log;
create policy extra_inventory_log_read on extra_inventory_log for select to authenticated
using (
  has_menu_access('extraInventory', 'view')
  or has_menu_access('cuttingStage', 'view')
  or has_menu_access('bendingStage', 'view')
);

-- ---------------------------------------------------------------------
-- Raw sheet stock. Its own page, plus the PO form's shortage warning and
-- Cutting Stage's deduction display.
-- ---------------------------------------------------------------------
drop policy if exists sheet_stock_read on sheet_stock;
create policy sheet_stock_read on sheet_stock for select to authenticated
using (
  has_menu_access('sheetStock', 'view')
  or has_menu_access('orders', 'view')
  or has_menu_access('cuttingStage', 'view')
);

-- Movement history is only ever shown on the Raw Sheet Stock page itself.
drop policy if exists sheet_stock_log_read on sheet_stock_log;
create policy sheet_stock_log_read on sheet_stock_log for select to authenticated
using (has_menu_access('sheetStock', 'view'));

-- ---------------------------------------------------------------------
-- Profiles: your own row, or anything if you are an admin (User
-- Management). Note is_admin() is SECURITY DEFINER precisely so this
-- policy does not recurse into itself while reading profiles.
-- ---------------------------------------------------------------------
drop policy if exists profiles_read_self on profiles;
create policy profiles_read_self on profiles for select to authenticated
using (id = auth.uid() or is_admin());

-- =====================================================================
-- Test account for verification.
--
-- Deliberately given EXACTLY ABHISHEK's permissions rather than admin, so
-- the checks below prove menu-gating actually gates something instead of
-- passing because the caller could see everything anyway.
--
-- Delete at cutover:
--   delete from profiles where username = 'claudetest';
--   -- then remove the auth user from the dashboard
-- =====================================================================
insert into profiles (id, username, role, permissions, created_by)
select u.id, 'claudetest', 'user',
       '{"cuttingConfig":"none","orders":"none","cuttingStage":"edit",
         "bendingStage":"edit","extraInventory":"view","sheetStock":"view"}'::jsonb,
       'migration-verification'
from auth.users u
where u.email = 'claudetest@almirah.local'
on conflict (id) do update set
  permissions = excluded.permissions,
  role = excluded.role;

select 'policies applied; claudetest profile rows: ' ||
       (select count(*) from profiles where username = 'claudetest')::text as result;
