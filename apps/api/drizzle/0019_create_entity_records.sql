CREATE TABLE "entity_records" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"organization_id" text NOT NULL,
	"connector_entity_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"normalized_data" jsonb NOT NULL,
	"source_id" text NOT NULL,
	"checksum" text NOT NULL,
	"synced_at" bigint NOT NULL,
	CONSTRAINT "entity_records_entity_source_unique" UNIQUE("connector_entity_id","source_id")
);
--> statement-breakpoint
ALTER TABLE "entity_records" ADD CONSTRAINT "entity_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_records" ADD CONSTRAINT "entity_records_connector_entity_id_connector_entities_id_fk" FOREIGN KEY ("connector_entity_id") REFERENCES "public"."connector_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_records_normalized_data_gin" ON "entity_records" USING gin ("normalized_data");--> statement-breakpoint
CREATE INDEX "entity_records_entity_synced_at_idx" ON "entity_records" USING btree ("connector_entity_id","synced_at");