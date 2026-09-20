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
-- backfill:user-role
INSERT INTO "user_role" (
  "id", "created", "created_by", "updated", "updated_by", "deleted", "deleted_by",
  "user_id", "organization_id", "role_id"
)
SELECT
  'sysur:' || ou.user_id || ':' || ou.organization_id || ':' || ou.role,
  (extract(epoch from now()) * 1000)::bigint, 'system', NULL, NULL, NULL, NULL,
  ou.user_id, ou.organization_id,
  'sysrole:' || ou.organization_id || ':' || ou.role
FROM "organization_users" ou
WHERE ou.deleted IS NULL
ON CONFLICT DO NOTHING;
