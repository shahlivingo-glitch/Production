-- Batch size for Bending Stage: how many almirahs the bender is currently
-- working through. Stored per PO so it survives a reload and is the same
-- for whoever opens the page - it describes the job, not one screen.
--
-- Records nothing about bending; it only scales the quantity each part card
-- displays. Run before relying on the mirror: the mirror pushes all Orders
-- columns in one upsert, so an unknown column rejects the whole row.
alter table orders
  add column if not exists bending_batch_qty integer not null default 0;

select 'bending_batch_qty added' as result;
