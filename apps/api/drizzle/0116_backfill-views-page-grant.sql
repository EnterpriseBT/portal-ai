-- #599: backfill the member `view page:views` nav grant into every existing
-- org's MemberAccess policy.
--
-- Slice 7a adds `views` to MEMBER_VIEW_PAGE_IDS, so newly-seeded orgs get the
-- `view page:views` statement from the seed. Existing orgs (already provisioned
-- with MemberAccess) get it here — without it, existing-org members would not
-- see the Views nav page once the slice-7a wiring lands. Mirrors the #630 `0110`
-- member-page backfill exactly.
--
-- Deterministic id matches the seed (seed.service.ts): the instance page grant
-- appends `:<resourceId>` after the `:none` condition placeholder — so this is a
-- safe no-op on a freshly-seeded org. Idempotent via ON CONFLICT DO NOTHING;
-- INSERT-only (no destructive DDL). The org filter mirrors the seed's
-- `deleted IS NULL` (#627).
--
-- backfill:views-page-grant
INSERT INTO "permission_statements" (
  "id", "created", "created_by", "updated", "updated_by", "deleted", "deleted_by",
  "organization_id", "policy_id", "effect", "verb", "resource_type", "resource_id", "condition"
)
SELECT
  'sysstmt:' || p."organization_id" || ':MemberAccess:allow:view:page:none:views',
  (extract(epoch from now()) * 1000)::bigint, 'system', NULL, NULL, NULL, NULL,
  p."organization_id", p."id", 'allow', 'view', 'page', 'views', NULL
FROM "permission_policies" p
WHERE p."name" = 'MemberAccess' AND p."kind" = 'system' AND p."deleted" IS NULL
ON CONFLICT DO NOTHING;
