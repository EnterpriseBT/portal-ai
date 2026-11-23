-- #1071: attach the Tags pack (tag_management) to every live org's
-- Administrate station. Provisioning gives it to new orgs
-- (PROVISIONED_STATIONS); nothing re-runs provisioning for an org that
-- already exists, so this carries existing orgs across (#316/#581).
--
-- Administrate is the system-created station carrying both rbac_management
-- and member_management, the pack signature only it is provisioned with, so
-- a rename doesn't hide it. A station a user built with the same packs isn't
-- system-created and is left alone. Re-running is a no-op: the partial
-- unique index on (station_id, builtin_slug) absorbs a repeat.
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
  AND EXISTS (
    SELECT 1 FROM station_toolpacks t
    WHERE t.station_id = s.id
      AND t.builtin_slug = 'member_management'
      AND t.deleted IS NULL
  )
ON CONFLICT (station_id, builtin_slug)
  WHERE deleted IS NULL AND builtin_slug IS NOT NULL
DO NOTHING;
