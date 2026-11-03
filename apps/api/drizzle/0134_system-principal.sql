-- #956: record the system principal this database was provisioned with.
-- SYSTEM_ID is write-once: every platform row carries it as created_by, and
-- created_by_system grants match only the current value, so a changed
-- SYSTEM_ID would strand every one of them. db-migrate refuses to migrate, and
-- the API refuses to boot, under a SYSTEM_ID other than this row's
-- (db/system-principal.util.ts). One row by construction: `singleton` is the
-- primary key and can only be true.
--
-- Recorded from portalai_system_id() (0133), so an existing environment
-- records the principal it migrates with on this release, the one 0133 just
-- relabeled its literal rows to.
CREATE TABLE IF NOT EXISTS "system_principal" (
	"singleton" boolean PRIMARY KEY DEFAULT true CHECK ("singleton"),
	"id" text NOT NULL,
	"created" bigint NOT NULL
);
--> statement-breakpoint
-- Before recording, check the principal against the platform rows already
-- here (#956 review): the release that adds this guard has nothing else to
-- compare with, and recording a changed SYSTEM_ID would make the guard protect
-- the wrong one. Connector definitions are seeded by the global seed under the
-- principal, and nothing else writes them. A fresh database has none yet.
DO $$
DECLARE
  principal text := portalai_system_id();
  found text;
BEGIN
  IF EXISTS (SELECT 1 FROM "connector_definitions")
     AND NOT EXISTS (SELECT 1 FROM "connector_definitions" WHERE "created_by" = principal)
  THEN
    SELECT "created_by" INTO found FROM "connector_definitions" LIMIT 1;
    RAISE EXCEPTION 'SYSTEM_ID % doesn''t match this database''s platform rows (connector definitions carry %): SYSTEM_ID is write-once (#956)', principal, found;
  END IF;
END;
$$;
--> statement-breakpoint
INSERT INTO "system_principal" ("singleton", "id", "created")
VALUES (true, portalai_system_id(), (extract(epoch from now()) * 1000)::bigint)
ON CONFLICT ("singleton") DO NOTHING;
