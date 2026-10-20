-- #832: backfill the member `read column_definition created_by_system`
-- statement into every existing org's MemberAccess policy. Members read the
-- platform-seeded column-definition catalog (as they read other
-- system-provisioned objects), so the agent can map columns on an entity they
-- write. New orgs get it from the seed (seed.service.ts SEED_SYSTEM_POLICIES).
--
-- Deterministic id matches the seed; idempotent via ON CONFLICT DO NOTHING;
-- INSERT-only. The policy filter mirrors the seed's `deleted IS NULL` (#627).
--
-- backfill:member-column-definition-read
INSERT INTO "permission_statements" (
  "id", "created", "created_by", "updated", "updated_by", "deleted", "deleted_by",
  "organization_id", "policy_id", "effect", "verb", "resource_type", "resource_id", "condition"
)
SELECT
  'sysstmt:' || p."organization_id" || ':MemberAccess:allow:read:column_definition:created_by_system',
  (extract(epoch from now()) * 1000)::bigint, 'system', NULL, NULL, NULL, NULL,
  p."organization_id", p."id", 'allow', 'read', 'column_definition', NULL, 'created_by_system'
FROM "permission_policies" p
WHERE p."name" = 'MemberAccess' AND p."kind" = 'system' AND p."deleted" IS NULL
ON CONFLICT DO NOTHING;
