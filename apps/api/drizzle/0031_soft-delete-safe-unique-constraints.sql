ALTER TABLE "column_definitions" DROP CONSTRAINT "column_definitions_org_key_unique";--> statement-breakpoint
ALTER TABLE "connector_definitions" DROP CONSTRAINT "connector_definitions_slug_unique";--> statement-breakpoint
ALTER TABLE "connector_entities" DROP CONSTRAINT "connector_entities_instance_key_unique";--> statement-breakpoint
ALTER TABLE "entity_group_members" DROP CONSTRAINT "entity_group_members_group_entity_unique";--> statement-breakpoint
ALTER TABLE "entity_records" DROP CONSTRAINT "entity_records_entity_source_unique";--> statement-breakpoint
ALTER TABLE "entity_tag_assignments" DROP CONSTRAINT "entity_tag_assignments_entity_tag_unique";--> statement-breakpoint
ALTER TABLE "field_mappings" DROP CONSTRAINT "field_mappings_entity_column_unique";--> statement-breakpoint
ALTER TABLE "station_instances" DROP CONSTRAINT "station_instances_station_connector_unique";--> statement-breakpoint
ALTER TABLE "station_tools" DROP CONSTRAINT "station_tools_station_tool_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "column_definitions_org_key_unique" ON "column_definitions" USING btree ("organization_id","key") WHERE deleted IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "connector_definitions_slug_unique" ON "connector_definitions" USING btree ("slug") WHERE deleted IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "connector_entities_instance_key_unique" ON "connector_entities" USING btree ("connector_instance_id","key") WHERE deleted IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_group_members_group_entity_unique" ON "entity_group_members" USING btree ("entity_group_id","connector_entity_id") WHERE deleted IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_records_entity_source_unique" ON "entity_records" USING btree ("connector_entity_id","source_id") WHERE deleted IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_tag_assignments_entity_tag_unique" ON "entity_tag_assignments" USING btree ("connector_entity_id","entity_tag_id") WHERE deleted IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "field_mappings_entity_column_unique" ON "field_mappings" USING btree ("connector_entity_id","column_definition_id") WHERE deleted IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "station_instances_station_connector_unique" ON "station_instances" USING btree ("station_id","connector_instance_id") WHERE deleted IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "station_tools_station_tool_unique" ON "station_tools" USING btree ("station_id","organization_tool_id") WHERE deleted IS NULL;