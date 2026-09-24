-- #630: backfill the member `delete created_by_caller` statements for the
-- non-shareable data types into every existing org's MemberAccess policy.
--
-- Slice 3 amendment (user-approved): a member fully controls the data objects
-- they create — read + write + **delete** their own. Delete was previously only
-- on the shareable subset (station/pin, seeded + 0106-backfilled). This adds it
-- for the remaining data types: view, portal, entity, entity_record,
-- field_mapping, connector_instance. New orgs get them from the seed; existing
-- orgs get them here. Without this, existing-org members could edit but not
-- delete their own connectors/entities the moment the object gate landed.
--
-- Deterministic ids match the seed (seed.service.ts SEED_SYSTEM_POLICIES) and
-- do NOT include station/pin (those already exist from 0106) — so this never
-- collides. Idempotent via ON CONFLICT DO NOTHING; INSERT-only. The org filter
-- mirrors the seed's `deleted IS NULL` (#627).
--
-- backfill:member-data-delete
INSERT INTO "permission_statements" (
  "id", "created", "created_by", "updated", "updated_by", "deleted", "deleted_by",
  "organization_id", "policy_id", "effect", "verb", "resource_type", "resource_id", "condition"
)
SELECT
  'sysstmt:' || p."organization_id" || ':MemberAccess:allow:delete:' || v.rt || ':created_by_caller',
  (extract(epoch from now()) * 1000)::bigint, 'system', NULL, NULL, NULL, NULL,
  p."organization_id", p."id", 'allow', 'delete', v.rt, NULL, 'created_by_caller'
FROM "permission_policies" p
CROSS JOIN (VALUES
  ('view'),
  ('portal'),
  ('entity'),
  ('entity_record'),
  ('field_mapping'),
  ('connector_instance')
) AS v(rt)
WHERE p."name" = 'MemberAccess' AND p."kind" = 'system' AND p."deleted" IS NULL
ON CONFLICT DO NOTHING;
