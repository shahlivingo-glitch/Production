-- =====================================================================
-- Migration verification hook — TEMPORARY, drop at cutover.
--
-- The tables are deny-all to the anon key (correct), which also means
-- nobody can confirm from outside that a migration step actually landed.
-- This exposes ROW COUNTS ONLY - no row contents, no column values - so
-- the migration can be checked against the Sheet without opening the data
-- up or hand-copying numbers out of the SQL Editor each time.
--
-- It becomes a drift detector later too: run it against Supabase, compare
-- with the same counts from the Sheet, and any divergence shows up before
-- it turns into a support question.
--
-- Drop it once the migration is done:
--   revoke execute on function migration_counts() from anon, authenticated;
--   drop function migration_counts();
-- =====================================================================

create or replace function migration_counts()
returns table (table_name text, row_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select 'models',               count(*) from models
  union all select 'cutting_plans',        count(*) from cutting_plans
  union all select 'plan_versions',        count(*) from plan_versions
  union all select 'orders',               count(*) from orders
  union all select 'cutting_extras',       count(*) from cutting_extras
  union all select 'extra_part_inventory', count(*) from extra_part_inventory
  union all select 'extra_inventory_log',  count(*) from extra_inventory_log
  union all select 'sheet_stock',          count(*) from sheet_stock
  union all select 'sheet_stock_log',      count(*) from sheet_stock_log
  union all select 'profiles',             count(*) from profiles
  order by 1;
$$;

grant execute on function migration_counts() to anon, authenticated;

-- A second, equally narrow check: confirm each profile actually resolved
-- to an auth user, and that permissions survived. Returns no password
-- material and no email - just the username, role, and which menu grants
-- are set, so a broken link is visible without exposing anything.
create or replace function migration_profile_check()
returns table (username text, role text, menus_granted int, linked_to_auth boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.username,
         p.role,
         (select count(*)::int from jsonb_each_text(p.permissions)
           where value in ('view', 'edit')),
         exists (select 1 from auth.users u where u.id = p.id)
  from profiles p
  order by p.username;
$$;

grant execute on function migration_profile_check() to anon, authenticated;

select * from migration_counts();
