DROP INDEX "column_definitions_org_key_unique";--> statement-breakpoint
ALTER TABLE "column_definitions" ADD CONSTRAINT "column_definitions_org_key_unique" UNIQUE("organization_id","key");