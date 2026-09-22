-- #620: backfill `user_role` from the existing `organization_users.role` enum.
--
-- 0103 added the `user_role` join but no rows. Every existing membership carries
-- its role in the enum; this remaps each into a `user_role` row pointing at that
-- org's seeded role (`sysrole:<org>:<role>`, minted by #598's seed / 0102
-- backfill). Without it, after the reads cutover every member would resolve zero
-- roles → fail-closed lockout. Identical effective access is preserved: one
-- user_role row per membership, same role.
--
-- Deterministic id `sysur:<userId>:<org>:<role>` matches the provisioning insert
-- (application.service), so a new org's owner (seeded at provisioning) and an
-- existing membership (seeded here) never collide, and re-running is a no-op.
-- Idempotent via ON CONFLICT DO NOTHING.
--
-- The `JOIN roles` (not a bare computed FK) is load-bearing: 0102 seeds
-- `sysrole:<org>:<role>` only `WHERE o.deleted IS NULL`, but a live membership
-- can outlive its org's soft-delete (a pre-tombstone or partial org delete
-- leaves `organization_users.deleted` NULL while `organizations.deleted` is
-- set). Selecting such a row would target a role that was never seeded and the
-- `role_id` FK throws 23503 (which `ON CONFLICT DO NOTHING` does NOT catch),
-- aborting the whole migration. The join backfills exactly the memberships whose
-- role exists and skips the orphans — correct, since a member of a deleted org
-- resolves zero roles anyway. (#627)
--
-- backfill:user-role
INSERT INTO "user_role" (
  "id", "created", "created_by", "updated", "updated_by", "deleted", "deleted_by",
  "user_id", "organization_id", "role_id"
)
SELECT
  'sysur:' || ou.user_id || ':' || ou.organization_id || ':' || ou.role,
  (extract(epoch from now()) * 1000)::bigint, 'system', NULL, NULL, NULL, NULL,
  ou.user_id, ou.organization_id,
  r.id
FROM "organization_users" ou
JOIN "roles" r
  ON r.id = 'sysrole:' || ou.organization_id || ':' || ou.role
 AND r.deleted IS NULL
WHERE ou.deleted IS NULL
ON CONFLICT DO NOTHING;
