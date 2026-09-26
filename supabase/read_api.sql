-- =====================================================================
-- Phase 2 — fast reads, served straight from Postgres.
--
-- WHY THESE TAKE A TOKEN INSTEAD OF USING auth.uid()
--
-- The app's users sign in against Apps Script (AppUsers/AppSessions in the
-- Sheet), not against Supabase Auth. Making the browser hold BOTH sessions
-- would mean keeping two password stores in sync - the kind of thing that
-- works until it silently doesn't.
--
-- So these functions take the app's own session token and resolve it the
-- same way Auth.gs does. The Supabase Auth work already done is still the
-- destination (see profiles/policies.sql); this is the bridge that lets
-- reads get fast NOW without touching how anyone logs in.
--
-- Passing a token as an argument is exactly today's security model - every
-- Apps Script call already does it - and the tokens are unguessable UUIDs.
-- The tables stay deny-all under RLS; only these SECURITY DEFINER
-- functions can read them, and each one checks the caller's menu grant
-- before returning anything.
-- =====================================================================

-- Mirrored from the Sheet so a token can be resolved without a round trip
-- back to Apps Script - which is the entire point of this exercise.
create table if not exists app_users (
  user_id       text primary key,
  username      text not null,
  password_hash text not null default '',
  password_salt text not null default '',
  role          text not null default 'user',
  permissions   jsonb not null default '{}'::jsonb,
  created_at    timestamptz,
  created_by    text not null default ''
);

create table if not exists app_sessions (
  token      text primary key,
  user_id    text not null,
  created_at timestamptz,
  expires_at timestamptz
);

create index if not exists app_sessions_user_idx on app_sessions (user_id);

alter table app_users enable row level security;
alter table app_sessions enable row level security;
-- deliberately no policies: unreachable with the anon key, reachable only
-- through the SECURITY DEFINER functions below.

-- Resolves a session token to its user, honouring expiry. Returns no row
-- for an unknown or expired token, which makes every caller below fail
-- closed by default.
create or replace function api_session_user(p_token text)
returns app_users
language sql
stable
security definer
set search_path = public
as $$
  select u.*
  from app_sessions s
  join app_users u on u.user_id = s.user_id
  where s.token = p_token
    and (s.expires_at is null or s.expires_at > now())
  limit 1;
$$;

-- Mirrors checkAccess in Code.gs: admins bypass, 'edit' satisfies 'view'.
create or replace function api_can(p_token text, p_menu text, p_needed text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare u app_users;
begin
  select * into u from api_session_user(p_token);
  if u.user_id is null then return false; end if;
  if u.role = 'admin' then return true; end if;
  if p_needed = 'view' then
    return coalesce(u.permissions ->> p_menu, 'none') in ('view', 'edit');
  end if;
  return coalesce(u.permissions ->> p_menu, 'none') = 'edit';
end;
$$;

create or replace function api_require(p_token text, p_menu text, p_needed text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not api_can(p_token, p_menu, p_needed) then
    raise exception 'You do not have access to this section. Ask an admin to grant it.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Raw Sheet Stock — shapes match getSheetStockBundle exactly, so the page
-- renders from either source without a branch.
-- ---------------------------------------------------------------------
create or replace function api_sheet_stock_bundle(p_token text, p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare result jsonb;
begin
  perform api_require(p_token, 'sheetStock', 'view');
  select jsonb_build_object(
    'stock', coalesce((
      select jsonb_agg(jsonb_build_object(
        'size', size, 'width', width, 'height', height,
        'thickness', thickness, 'qty', qty, 'updatedAt', updated_at
      ) order by size) from sheet_stock), '[]'::jsonb),
    'log', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object(
          'logId', log_id, 'size', size, 'delta', delta, 'reason', reason,
          'poNumber', po_number, 'timestamp', timestamp, 'note', note
        ) x, timestamp
        from sheet_stock_log order by timestamp desc limit p_limit
      ) s), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

-- ---------------------------------------------------------------------
-- Extra Part Inventory (the Leftover Ledger page)
-- ---------------------------------------------------------------------
create or replace function api_extra_part_inventory(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform api_require(p_token, 'extraInventory', 'view');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'modelName', model_name, 'partName', part_name, 'size', size,
      'qty', qty, 'updatedAt', updated_at
    ) order by model_name, part_name)
    from extra_part_inventory), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- Cutting Configuration model list.
-- Left at "just signed in" to match ACTION_MENUS, where
-- cuttingConfigModels is deliberately absent because the PO form's model
-- dropdown needs it without granting Cutting Configuration access.
-- ---------------------------------------------------------------------
create or replace function api_cutting_config_models(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select user_id from api_session_user(p_token)) is null then
    raise exception 'Not signed in.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'modelName', model_name, 'partsPerUnit', parts_per_unit, 'updatedAt', updated_at
    ) order by model_name) from models), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- Dashboard. Available to every signed-in user regardless of menus,
-- matching getDashboardSummary.
--
-- pendingBendingCount reproduces listPendingBendingOrders' own filter
-- rather than its full computation: an order counts when bending is not
-- complete AND either some sheet is already cut or it has logged extras
-- (which are bendable immediately). The expensive per-part queue building
-- in that function does not affect the count.
-- ---------------------------------------------------------------------
create or replace function api_dashboard_summary(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare result jsonb;
begin
  if (select user_id from api_session_user(p_token)) is null then
    raise exception 'Not signed in.';
  end if;

  select jsonb_build_object(
    'pendingPOsCount', (select count(*) from orders where cutting_status is distinct from 'complete'),

    'pendingBendingCount', (
      select count(*) from orders o
      where o.bending_status is distinct from 'complete'
        and (
          exists (select 1 from jsonb_array_elements(o.sheet_completion) e where e::text = 'true')
          or exists (select 1 from cutting_extras ce where ce.po_number = o.po_number)
        )
    ),

    -- hasPendingMultiYield: any decision recorded with a null/absent choice
    'pendingMultiYieldDecisions', coalesce((
      select jsonb_agg(jsonb_build_object('poNumber', po_number, 'modelName', model_name))
      from orders o
      where exists (
        select 1 from jsonb_each(o.multi_yield_decisions) d
        where d.value ->> 'choice' is null
      )), '[]'::jsonb),

    'stockShort', coalesce((
      select jsonb_agg(jsonb_build_object(
        'size', size, 'width', width, 'height', height,
        'thickness', thickness, 'qty', qty, 'updatedAt', updated_at
      ) order by size) from sheet_stock where qty < 0), '[]'::jsonb),

    'recentActivity', coalesce((
      select jsonb_agg(a order by a ->> 'timestamp' desc)
      from (
        select jsonb_build_object(
          'type', 'extra', 'poNumber', po_number,
          'timestamp', timestamp,
          'detail', case when type = 'extra-sheet' then 'Extra Sheet Cut' else 'Extra Part' end
        ) a, timestamp
        from cutting_extras order by timestamp desc limit 5
      ) e_rows
      where true
    ), '[]'::jsonb)
  ) into result;

  -- Recent activity is the union of the last 5 extras and last 5 orders,
  -- trimmed to 8 - assembled here rather than inline because jsonb_agg
  -- cannot order across two sources in one pass.
  select jsonb_set(result, '{recentActivity}', coalesce((
    select jsonb_agg(a order by ts desc)
    from (
      (select jsonb_build_object(
         'type', 'extra', 'poNumber', po_number, 'timestamp', timestamp,
         'detail', case when type = 'extra-sheet' then 'Extra Sheet Cut' else 'Extra Part' end) a,
         timestamp ts
       from cutting_extras order by timestamp desc limit 5)
      union all
      (select jsonb_build_object(
         'type', 'order', 'poNumber', po_number, 'timestamp', created_at,
         'detail', model_name || ' × ' || qty) a,
         created_at ts
       from orders order by created_at desc limit 5)
      order by ts desc limit 8
    ) merged), '[]'::jsonb))
  into result;

  return result;
end;
$$;

-- ---------------------------------------------------------------------
-- Orders list (PO form's table, and anything else listing orders).
-- ---------------------------------------------------------------------
create or replace function api_orders(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform api_require(p_token, 'orders', 'view');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'poNumber', po_number, 'modelName', model_name, 'planName', plan_name,
      'qty', qty, 'dxfRefNo', dxf_ref_no, 'colourPlan', colour_plan,
      'deliveryDeadline', delivery_deadline, 'partyName', party_name,
      'planVersionId', plan_version_id,
      'sheetCompletion', sheet_completion, 'bendingCompletion', bending_completion,
      'totalSheetsRequired', total_sheets_required,
      'cuttingStatus', cutting_status, 'bendingStatus', bending_status,
      'createdAt', created_at,
      'multiYieldDecisions', multi_yield_decisions,
      'sheetStockConsumed', sheet_stock_consumed,
      'sheetQtyOverrides', sheet_qty_overrides,
      'planType', plan_type, 'bulkBaseQty', bulk_base_qty, 'bulkMultiplier', bulk_multiplier
    ) order by po_number) from orders), '[]'::jsonb);
end;
$$;

grant execute on function api_sheet_stock_bundle(text, int)   to anon, authenticated;
grant execute on function api_extra_part_inventory(text)      to anon, authenticated;
grant execute on function api_cutting_config_models(text)     to anon, authenticated;
grant execute on function api_dashboard_summary(text)         to anon, authenticated;
grant execute on function api_orders(text)                    to anon, authenticated;

-- api_session_user / api_can / api_require are internal: they are called by
-- the functions above (which run as definer), never by the browser.
revoke execute on function api_session_user(text)        from anon, authenticated;
revoke execute on function api_can(text, text, text)     from anon, authenticated;
revoke execute on function api_require(text, text, text) from anon, authenticated;

select 'read api installed' as result;
