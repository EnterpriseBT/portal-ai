-- #622: add roles.slug — a stable, per-org assignment key decoupled from the
-- display name. Backfilled from the existing name (system role names are already
-- slugs; custom names are slugified the same way `contentEntrySlug` does) so the
-- NOT NULL + unique index apply cleanly to every existing row. Add-only, no drop.
ALTER TABLE "roles" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "roles" SET "slug" = trim(both '-' from lower(regexp_replace("name", '[^a-zA-Z0-9]+', '-', 'g'))) WHERE "slug" IS NULL;--> statement-breakpoint
ALTER TABLE "roles" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_org_slug_unique" ON "roles" USING btree ("organization_id","slug") WHERE "roles"."deleted" IS NULL;
