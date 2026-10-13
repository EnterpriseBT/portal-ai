-- #769: the scopes each job locks while non-terminal, as lockScopeKey strings
-- ("entity:<id>" / "instance:<id>"), written at creation from core's
-- jobLockScopes. Lock checks overlap-match this column instead of reading
-- per-type metadata keys.
--
-- Expand-only: a new column with a default, a backfill for jobs that are
-- live right now (terminal jobs lock nothing, so '{}' is correct for them),
-- and a partial GIN index over live rows. Hand-written, like 0117-0119: the
-- 0116 snapshot duplicates 0115's id, so drizzle-kit generate can't run.
--
-- No enum literal added by ALTER TYPE ... ADD VALUE appears here: on a fresh
-- database drizzle runs every migration in one transaction, where Postgres
-- refuses such a value ("unsafe use of new value"). So "type" compares as
-- text, and "live" is spelled as NOT IN the terminal statuses, which 0012
-- created with the type.

ALTER TABLE "jobs" ADD COLUMN "lock_scopes" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
UPDATE "jobs"
SET "lock_scopes" = CASE
  WHEN "type"::text IN ('connector_sync', 'layout_plan_commit', 'entity_record_clear')
    AND coalesce("metadata"->>'connectorInstanceId', '') <> ''
    THEN ARRAY['instance:' || ("metadata"->>'connectorInstanceId')]
  WHEN "type"::text IN ('revalidation', 'bulk_geocode')
    AND coalesce("metadata"->>'connectorEntityId', '') <> ''
    THEN ARRAY['entity:' || ("metadata"->>'connectorEntityId')]
  WHEN "type"::text = 'bulk_transform'
    THEN ARRAY(
      SELECT DISTINCT 'entity:' || id
      FROM (
        SELECT jsonb_array_elements_text(
          CASE WHEN jsonb_typeof("metadata"->'targetConnectorEntityIds') = 'array'
            THEN "metadata"->'targetConnectorEntityIds' ELSE '[]'::jsonb END
        ) AS id
        UNION
        SELECT "metadata"->>'sourceConnectorEntityId'
      ) ids
      WHERE coalesce(id, '') <> ''
    )
  ELSE '{}'::text[]
END
WHERE "status" NOT IN ('completed', 'failed', 'cancelled');
--> statement-breakpoint
CREATE INDEX "jobs_lock_scopes_live_idx" ON "jobs" USING gin ("lock_scopes")
  WHERE "jobs"."status" NOT IN ('completed', 'failed', 'cancelled');
