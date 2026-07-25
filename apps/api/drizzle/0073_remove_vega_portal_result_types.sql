-- #272: the Vega visualization tools are removed, so the portal_result_type
-- enum drops its "vega-lite" and "vega" members. Postgres has no
-- `ALTER TYPE ... DROP VALUE`, so the type is recreated: widen the column to
-- text, drop the old type, recreate it with the two surviving members, then
-- narrow the column back. Any pinned rows still carrying a retired type are
-- deleted first so the final cast can't fail (clean cut — no backfill; no
-- production data carries these values).
ALTER TABLE "portal_results" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
DELETE FROM "portal_results" WHERE "type" IN ('vega-lite', 'vega');--> statement-breakpoint
DROP TYPE "public"."portal_result_type";--> statement-breakpoint
CREATE TYPE "public"."portal_result_type" AS ENUM('text', 'data-table');--> statement-breakpoint
ALTER TABLE "portal_results" ALTER COLUMN "type" SET DATA TYPE "public"."portal_result_type" USING "type"::"public"."portal_result_type";
