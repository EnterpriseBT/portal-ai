-- #802: add `entity_data_delete` to the `job_type` enum. An entity or
-- connector delete tombstones everything user-visible in its request and
-- enqueues this job to soft-delete the records and drop the `er__<id>` wide
-- tables: at 400K+ records that work took longer than a request may.
--
-- Kept in a migration of its own: no SQL may name a value `ADD VALUE` adds in
-- the same transaction, and a fresh database runs every migration in one.

ALTER TYPE "job_type" ADD VALUE 'entity_data_delete';
