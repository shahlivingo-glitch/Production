-- =====================================================================
-- All outstanding Bending Stage columns, in one go.
--
-- bending_batch_qty was never applied (Postgres still reports it missing),
-- so order writes are currently not reaching Supabase at all: the mirror
-- pushes every Orders column in one upsert, and one unknown column
-- rejects the whole row. This file is safe to run even if part of it was
-- applied before - every statement is IF NOT EXISTS.
-- =====================================================================

alter table orders
  add column if not exists bending_batch_qty integer not null default 0;

-- Pieces an operator declared bent without them having been cut here.
-- { "<partName>": { "qty": n, "at": iso, "by": "name" } } - the who/when is
-- kept because this is an override of what the system can actually see.
alter table orders
  add column if not exists force_bent_parts jsonb not null default '{}'::jsonb;

-- Per-PO gate for that override, admin-controlled. Text rather than boolean
-- to match how the Sheet stores it; blank means allowed.
alter table orders
  add column if not exists allow_force_bend text not null default '';

select 'bending columns added' as result;
