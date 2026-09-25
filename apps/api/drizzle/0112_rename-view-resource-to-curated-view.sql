-- #630: rename the `view` resource TYPE to `curated_view` to remove the collision
-- with the `view` verb (the action of viewing a `page`). The `view` type is the
-- #599 curated-data-view object — not built yet, so the only rows carrying it are
-- the inert MemberAccess seed grants (`read/write/delete view created_by_caller`,
-- `read view created_by_system`). Rename them in place so the enum stays exhaustive
-- (a stale `view` row would fail the widened drizzle-zod enum on read).
--
-- Data UPDATE, not DDL — resource_type is a plain text column (no CHECK). Applies
-- to both system and custom statements/grants across all orgs. Idempotent.
--
-- rename:view-to-curated-view
UPDATE "permission_statements" SET "resource_type" = 'curated_view'
WHERE "resource_type" = 'view';

UPDATE "permission_grants" SET "resource_type" = 'curated_view'
WHERE "resource_type" = 'view';
