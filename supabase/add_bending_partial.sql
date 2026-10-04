-- =====================================================================
-- Partial bending progress.
--
-- Run this BEFORE the matching Apps Script deploy. The mirror pushes every
-- Orders column it knows about in one upsert, so if it sends
-- bending_partial before the column exists, PostgREST rejects the whole
-- row - and every order write would stop mirroring, silently, until this
-- ran. Adding the column first makes the two deploys order-independent.
--
-- One namespaced map rather than separate columns for plan entries and
-- extras: a plain index ("3") for a plan entry, "extra:<extraKey>" for an
-- extra - the same namespacing bending_leftover_consumed already uses.
-- =====================================================================

alter table orders
  add column if not exists bending_partial jsonb not null default '{}'::jsonb;

select 'bending_partial added' as result;
