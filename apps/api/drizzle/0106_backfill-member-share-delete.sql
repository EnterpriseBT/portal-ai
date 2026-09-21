-- #621: backfill the member own-object `delete` + `share` statements into every
-- existing org's `MemberAccess` policy.
--
-- Slice 2 adds `{allow delete}` + `{allow share}` on the shareable object types
-- (`station`, `pin`), condition `created_by_caller`, to the seeded MemberAccess
-- policy — so a member can delete and share the station/pin they created once
-- slice 3 wires object enforcement. New orgs get them from the seed; existing
-- orgs (already provisioned with MemberAccess by #598's seed / 0102 backfill)
-- get them here. Without this, existing-org members lose delete/share of their
-- own station/pin the moment the wiring lands.
--
-- Deterministic id matches the seed (seed.service.ts:seedRbacSystemPolicies),
-- so this never collides with a freshly-seeded org and is a safe no-op re-run.
-- Idempotent via ON CONFLICT DO NOTHING. INSERT-only (no destructive DDL).
--
-- backfill:member-share-delete
INSERT INTO "permission_statements" (
  "id", "created", "created_by", "updated", "updated_by", "deleted", "deleted_by",
  "organization_id", "policy_id", "effect", "verb", "resource_type", "resource_id", "condition"
)
SELECT
  'sysstmt:' || p."organization_id" || ':MemberAccess:allow:' || v.verb || ':' || v.rt || ':created_by_caller',
  (extract(epoch from now()) * 1000)::bigint, 'system', NULL, NULL, NULL, NULL,
  p."organization_id", p."id", 'allow', v.verb, v.rt, NULL, 'created_by_caller'
FROM "permission_policies" p
CROSS JOIN (VALUES ('delete', 'station'), ('share', 'station'), ('delete', 'pin'), ('share', 'pin')) AS v(verb, rt)
WHERE p."name" = 'MemberAccess' AND p."kind" = 'system' AND p."deleted" IS NULL
ON CONFLICT DO NOTHING;
