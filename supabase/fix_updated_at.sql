-- =====================================================================
-- Fix: stop updated_at being overwritten on mirrored tables.
--
-- THE BUG
-- set_updated_at() stamped now() on every update. While the Sheet is the
-- source of truth the mirror supplies the Sheet's real UpdatedAt, so that
-- value was thrown away and replaced with "when the mirror last ran" - all
-- 25 Raw Sheet Stock rows were displaying the backfill time instead of
-- when the stock actually changed. It would also have broken the planned
-- two-way sync, which decides who wins by comparing updated_at against
-- last_edited_in_sheet: if updated_at refreshes on every mirror pass,
-- Supabase always looks newer and a genuine Sheet correction can never win.
--
-- WHY NOT JUST "ONLY STAMP IF THE CALLER DIDN'T SUPPLY ONE"
-- Tried and rejected: the mirror re-pushes unchanged rows with the SAME
-- timestamp, so new.updated_at equals old.updated_at and that test reads
-- as "not supplied" - clobbering it anyway. There is no reliable way for
-- the trigger to tell an explicit value from an unchanged one.
--
-- THE FIX
-- Drop the trigger on every mirrored table. Those rows only ever change
-- via the mirror, which always carries the authoritative timestamp from
-- the Sheet. profiles keeps its trigger: it is Supabase-native, never
-- mirrored, and has nothing else to set the value.
--
-- When Supabase becomes the source of truth, the write RPCs must set
-- updated_at = now() explicitly. That is better than a hidden trigger
-- anyway - it keeps the timestamp visible at the point of the write.
-- =====================================================================

drop trigger if exists models_set_updated_at               on models;
drop trigger if exists cutting_plans_set_updated_at        on cutting_plans;
drop trigger if exists orders_set_updated_at               on orders;
drop trigger if exists extra_part_inventory_set_updated_at on extra_part_inventory;
drop trigger if exists sheet_stock_set_updated_at          on sheet_stock;

-- profiles is Supabase-native and keeps its trigger.

select 'triggers dropped on mirrored tables — re-run the backfill to restore real timestamps' as result;
