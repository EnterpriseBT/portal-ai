-- #1071: attach the Tags pack (tag_management) to every live org's
-- Administrate station. Provisioning gives it to new orgs
-- (PROVISIONED_STATIONS); nothing re-runs provisioning for an org that
-- already exists, so this carries existing orgs across (#316/#581).
--
-- Administrate is the system-created station carrying rbac_management: no
-- other station is provisioned with that pack (Playground and the demo
-- org's stations aren't), so a rename doesn't hide it. member_management is
-- deliberately not part of the match: #847 added it to provisioning without
-- a backfill, so an org provisioned between #848 and #847 has an
-- Administrate without it. A station a user built isn't system-created and
-- is left alone. Re-running is a no-op: the partial unique index on
-- (station_id, builtin_slug) absorbs a repeat.
INSERT INTO station_toolpacks (id, created, created_by, station_id, builtin_slug)
SELECT gen_random_uuid()::text,
       (extract(epoch FROM now()) * 1000)::bigint,
       portalai_system_id(),
       s.id,
       'tag_management'
FROM stations s
JOIN organizations o ON o.id = s.organization_id AND o.deleted IS NULL
WHERE s.deleted IS NULL
  AND s.created_by = portalai_system_id()
  AND EXISTS (
    SELECT 1 FROM station_toolpacks t
    WHERE t.station_id = s.id
      AND t.builtin_slug = 'rbac_management'
      AND t.deleted IS NULL
  )
ON CONFLICT (station_id, builtin_slug)
  WHERE deleted IS NULL AND builtin_slug IS NOT NULL
DO NOTHING;
--> statement-breakpoint
-- Administrate's description now mentions tags. Only a description still
-- exactly the #847 default is rewritten: one a user edited is theirs, and an
-- older default belongs to an Administrate without the Members pack, which
-- the new text would misdescribe.
UPDATE stations s
SET description = 'Manage members, access and tags through the assistant: invitations, members, shares and tags on any plan, and custom roles, policies and groups where your plan includes them. No data is attached here. You can also ask how Portals works.',
    updated = (extract(epoch FROM now()) * 1000)::bigint,
    updated_by = portalai_system_id()
FROM organizations o
WHERE o.id = s.organization_id
  AND o.deleted IS NULL
  AND s.deleted IS NULL
  AND s.created_by = portalai_system_id()
  AND s.description = 'Manage members and access through the assistant: invitations, members and shares on any plan, and custom roles, policies and groups where your plan includes them. No data is attached here. You can also ask how Portals works.';
