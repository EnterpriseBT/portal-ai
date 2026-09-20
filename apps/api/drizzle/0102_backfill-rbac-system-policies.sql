-- #598: backfill the RBAC system roles + policies onto every organization that
-- already existed when 0101 shipped.
--
-- 0101 added the engine tables but no rows. `SeedService.seedRbacSystemPolicies`
-- only runs at org provisioning (+ reset), so orgs created before #598 would
-- resolve no policy set and the engine would fail closed for every member of
-- them. This mirrors that seed for existing orgs — the paired backfill the
-- #316/#414 rule requires.
--
-- Deterministic ids (`sys{role,pol,stmt,att}:<org>:…`) match the TS seed's id
-- scheme exactly, so a new org (seeded by TS) and an existing org (seeded here)
-- never collide, and re-running is a no-op. Idempotent via ON CONFLICT DO
-- NOTHING (a bare target catches any unique/PK conflict).
--
-- The policy shapes reproduce the #576 switch: owner=FullAccess (allow * *),
-- admin=FullAccess minus billing-manage/org-delete (deny wins), member=own-data
-- read/write + system-row read (the ownership condition).

-- ── System roles (owner / admin / member) ────────────────────────────
INSERT INTO "roles" (
  "id", "created", "created_by", "updated", "updated_by", "deleted", "deleted_by",
  "organization_id", "name", "kind"
)
SELECT
  'sysrole:' || o.id || ':' || r.name,
  (extract(epoch from now()) * 1000)::bigint, 'system', NULL, NULL, NULL, NULL,
  o.id, r.name, 'system'
FROM "organizations" o
CROSS JOIN (VALUES ('owner'), ('admin'), ('member')) AS r(name)
WHERE o.deleted IS NULL
ON CONFLICT DO NOTHING;

-- ── System policies (FullAccess / AdminAccess / MemberAccess) ─────────
INSERT INTO "permission_policies" (
  "id", "created", "created_by", "updated", "updated_by", "deleted", "deleted_by",
  "organization_id", "name", "kind", "description"
)
SELECT
  'syspol:' || o.id || ':' || p.name,
  (extract(epoch from now()) * 1000)::bigint, 'system', NULL, NULL, NULL, NULL,
  o.id, p.name, 'system', p.description
FROM "organizations" o
CROSS JOIN (VALUES
  ('FullAccess', 'Full access to the organization.'),
  ('AdminAccess', 'Everything except billing management and organization deletion.'),
  ('MemberAccess', 'Read and write the objects you create; read system-provisioned defaults.')
) AS p(name, description)
WHERE o.deleted IS NULL
ON CONFLICT DO NOTHING;

-- ── Role → policy attachments ────────────────────────────────────────
INSERT INTO "policy_attachments" (
  "id", "created", "created_by", "updated", "updated_by", "deleted", "deleted_by",
  "organization_id", "policy_id", "principal_type", "principal_id"
)
SELECT
  'sysatt:' || o.id || ':' || a.role,
  (extract(epoch from now()) * 1000)::bigint, 'system', NULL, NULL, NULL, NULL,
  o.id, 'syspol:' || o.id || ':' || a.policy, 'role', 'sysrole:' || o.id || ':' || a.role
FROM "organizations" o
CROSS JOIN (VALUES
  ('owner', 'FullAccess'), ('admin', 'AdminAccess'), ('member', 'MemberAccess')
) AS a(role, policy)
WHERE o.deleted IS NULL
ON CONFLICT DO NOTHING;

-- ── FullAccess statements: allow * * ─────────────────────────────────
INSERT INTO "permission_statements" (
  "id", "created", "created_by", "updated", "updated_by", "deleted", "deleted_by",
  "organization_id", "policy_id", "effect", "verb", "resource_type", "resource_id", "condition"
)
SELECT
  'sysstmt:' || o.id || ':FullAccess:allow:*:*:none',
  (extract(epoch from now()) * 1000)::bigint, 'system', NULL, NULL, NULL, NULL,
  o.id, 'syspol:' || o.id || ':FullAccess', 'allow', '*', '*', NULL, NULL
FROM "organizations" o
WHERE o.deleted IS NULL
ON CONFLICT DO NOTHING;

-- ── AdminAccess statements: allow * * ; deny manage billing ; deny delete org ─
INSERT INTO "permission_statements" (
  "id", "created", "created_by", "updated", "updated_by", "deleted", "deleted_by",
  "organization_id", "policy_id", "effect", "verb", "resource_type", "resource_id", "condition"
)
SELECT
  'sysstmt:' || o.id || ':AdminAccess:' || s.effect || ':' || s.verb || ':' || s.rt || ':none',
  (extract(epoch from now()) * 1000)::bigint, 'system', NULL, NULL, NULL, NULL,
  o.id, 'syspol:' || o.id || ':AdminAccess', s.effect, s.verb, s.rt, NULL, NULL
FROM "organizations" o
CROSS JOIN (VALUES
  ('allow', '*', '*'),
  ('deny', 'manage', 'billing'),
  ('deny', 'delete', 'org')
) AS s(effect, verb, rt)
WHERE o.deleted IS NULL
ON CONFLICT DO NOTHING;

-- ── MemberAccess statements: read/write own + read system, per data type ─
INSERT INTO "permission_statements" (
  "id", "created", "created_by", "updated", "updated_by", "deleted", "deleted_by",
  "organization_id", "policy_id", "effect", "verb", "resource_type", "resource_id", "condition"
)
SELECT
  'sysstmt:' || o.id || ':MemberAccess:allow:' || vc.verb || ':' || dt.rt || ':' || vc.cond,
  (extract(epoch from now()) * 1000)::bigint, 'system', NULL, NULL, NULL, NULL,
  o.id, 'syspol:' || o.id || ':MemberAccess', 'allow', vc.verb, dt.rt, NULL, vc.cond
FROM "organizations" o
CROSS JOIN (VALUES
  ('station'), ('pin'), ('view'), ('portal'),
  ('entity'), ('entity_record'), ('field_mapping'), ('connector_instance')
) AS dt(rt)
CROSS JOIN (VALUES
  ('read', 'created_by_caller'),
  ('write', 'created_by_caller'),
  ('read', 'created_by_system')
) AS vc(verb, cond)
WHERE o.deleted IS NULL
ON CONFLICT DO NOTHING;
