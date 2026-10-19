ALTER TABLE "connector_entities" ADD COLUMN "source_portal_id" text;--> statement-breakpoint
ALTER TABLE "entity_records" ADD COLUMN "source_portal_id" text;--> statement-breakpoint
ALTER TABLE "field_mappings" ADD COLUMN "source_portal_id" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "source_portal_id" text;--> statement-breakpoint
ALTER TABLE "permission_policies" ADD COLUMN "source_portal_id" text;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "source_portal_id" text;