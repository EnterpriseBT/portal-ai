-- Create the `station_toolpacks` join table.
--
-- Phase 1 of the toolpack work promotes "tool packs" from a string
-- array on `stations.tool_packs` to a first-class join table. Each
-- row attaches one toolpack — built-in (`builtin_slug` set) or
-- custom (`organization_toolpack_id` set) — to a station.
--
-- The XOR CHECK guarantees exactly one of the two reference columns
-- is non-null per row. Phase 1 only writes built-in rows; the
-- `organization_toolpacks` table is added in phase 2 and starts
-- backing the second column at that point. The FK constraint on
-- `organization_toolpack_id` is added then, not now (the target
-- table doesn't exist yet).
--
-- Two partial unique indexes prevent duplicate live attachments —
-- one for each reference flavor — while leaving soft-deleted rows
-- alone so the same pack can be re-attached after removal.

CREATE TABLE IF NOT EXISTS "station_toolpacks" (
  "id" text PRIMARY KEY NOT NULL,
  "created" bigint NOT NULL,
  "created_by" text NOT NULL,
  "updated" bigint,
  "updated_by" text,
  "deleted" bigint,
  "deleted_by" text,
  "station_id" text NOT NULL,
  "builtin_slug" text,
  "organization_toolpack_id" text,
  CONSTRAINT "station_toolpacks_kind_xor"
    CHECK (("builtin_slug" IS NULL) <> ("organization_toolpack_id" IS NULL))
);

DO $$ BEGIN
  ALTER TABLE "station_toolpacks"
    ADD CONSTRAINT "station_toolpacks_station_id_stations_id_fk"
    FOREIGN KEY ("station_id") REFERENCES "stations"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "station_toolpacks_station_slug_unique"
  ON "station_toolpacks" ("station_id", "builtin_slug")
  WHERE "deleted" IS NULL AND "builtin_slug" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "station_toolpacks_station_orgtp_unique"
  ON "station_toolpacks" ("station_id", "organization_toolpack_id")
  WHERE "deleted" IS NULL AND "organization_toolpack_id" IS NOT NULL;
