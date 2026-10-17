-- #640: a pin's data executes as its definer. Every existing pin's definer is
-- the user who pinned it; add nullable, backfill, then enforce NOT NULL.
ALTER TABLE "portal_results" ADD COLUMN "definer_principal_type" text;--> statement-breakpoint
ALTER TABLE "portal_results" ADD COLUMN "definer_principal_id" text;--> statement-breakpoint
UPDATE "portal_results" SET "definer_principal_type" = 'user', "definer_principal_id" = "created_by";--> statement-breakpoint
ALTER TABLE "portal_results" ALTER COLUMN "definer_principal_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_results" ALTER COLUMN "definer_principal_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "portal_results_definer_idx" ON "portal_results" USING btree ("organization_id","definer_principal_type","definer_principal_id") WHERE deleted IS NULL;
