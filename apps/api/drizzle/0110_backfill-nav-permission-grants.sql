-- #630: backfill the member nav-view + job-read statements into every existing
-- org's MemberAccess policy.
--
-- Slice 1 adds to the seeded MemberAccess policy: an unconditional `read job`
-- (the Jobs list is readable by everyone) and `view page:<id>` for the member
-- pages (`stations`, `pinned`, `jobs`; Dashboard is un-gated, the admin pages
-- carry no member grant — Decision A). New orgs get them from the seed; existing
-- orgs (already provisioned with MemberAccess by #598's seed / 0102 backfill)
-- get them here. Without this, existing-org members would get an empty nav and
-- an empty Jobs list the moment the slice 2/4 wiring lands.
--
-- Deterministic ids match the seed (seed.service.ts SEED_SYSTEM_POLICIES): the
-- instance grants append `:<resourceId>`, the unconditional class grant keeps the
-- historical `:none` suffix — so this never collides with a freshly-seeded org
-- and is a safe no-op re-run. Idempotent via ON CONFLICT DO NOTHING; INSERT-only
-- (no destructive DDL). The org filter mirrors the seed's `deleted IS NULL`
-- (#627) so a live membership on a soft-deleted org is not FK-violated.
--
-- backfill:nav-permission-grants
INSERT INTO "permission_statements" (
  "id", "created", "created_by", "updated", "updated_by", "deleted", "deleted_by",
  "organization_id", "policy_id", "effect", "verb", "resource_type", "resource_id", "condition"
)
SELECT
  'sysstmt:' || p."organization_id" || ':MemberAccess:allow:' || v.verb || ':' || v.rt || ':none'
    || CASE WHEN v.resource_id IS NULL THEN '' ELSE ':' || v.resource_id END,
  (extract(epoch from now()) * 1000)::bigint, 'system', NULL, NULL, NULL, NULL,
  p."organization_id", p."id", 'allow', v.verb, v.rt, v.resource_id, NULL
FROM "permission_policies" p
CROSS JOIN (VALUES
  ('read', 'job', NULL::text),
  ('view', 'page', 'stations'),
  ('view', 'page', 'pinned'),
  ('view', 'page', 'jobs')
) AS v(verb, rt, resource_id)
WHERE p."name" = 'MemberAccess' AND p."kind" = 'system' AND p."deleted" IS NULL
ON CONFLICT DO NOTHING;
