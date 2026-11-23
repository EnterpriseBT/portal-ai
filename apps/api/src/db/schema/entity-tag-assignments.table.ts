import { check, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { connectorEntities } from "./connector-entities.table.js";
import { connectorInstances } from "./connector-instances.table.js";
import { curatedViews } from "./curated-views.table.js";
import { entityTags } from "./entity-tags.table.js";
import { portalResults } from "./portal-results.table.js";
import { stations } from "./stations.table.js";

/**
 * Tag assignments: one tag on one object.
 *
 * #1070 widened this from entities to stations, pins (`portal_results`),
 * connector instances and curated views. Each type has its own nullable FK
 * column and exactly one is set (`entity_tag_assignments_one_target`). The
 * `entity_` name predates the other types and is kept so the migration stays
 * expand-only (a rename would break tasks still running the old code).
 */
export const entityTagAssignments = pgTable(
  "entity_tag_assignments",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    connectorEntityId: text("connector_entity_id").references(
      () => connectorEntities.id
    ),
    stationId: text("station_id").references(() => stations.id),
    portalResultId: text("portal_result_id").references(() => portalResults.id),
    connectorInstanceId: text("connector_instance_id").references(
      () => connectorInstances.id
    ),
    curatedViewId: text("curated_view_id").references(() => curatedViews.id),
    entityTagId: text("entity_tag_id")
      .notNull()
      .references(() => entityTags.id),
  },
  (table) => [
    check(
      "entity_tag_assignments_one_target",
      sql`num_nonnulls(${table.connectorEntityId}, ${table.stationId}, ${table.portalResultId}, ${table.connectorInstanceId}, ${table.curatedViewId}) = 1`
    ),
    uniqueIndex("entity_tag_assignments_entity_tag_unique")
      .on(table.connectorEntityId, table.entityTagId)
      .where(sql`deleted IS NULL`),
    uniqueIndex("entity_tag_assignments_station_tag_unique")
      .on(table.stationId, table.entityTagId)
      .where(sql`deleted IS NULL`),
    uniqueIndex("entity_tag_assignments_portal_result_tag_unique")
      .on(table.portalResultId, table.entityTagId)
      .where(sql`deleted IS NULL`),
    uniqueIndex("entity_tag_assignments_connector_instance_tag_unique")
      .on(table.connectorInstanceId, table.entityTagId)
      .where(sql`deleted IS NULL`),
    uniqueIndex("entity_tag_assignments_curated_view_tag_unique")
      .on(table.curatedViewId, table.entityTagId)
      .where(sql`deleted IS NULL`),
    // The tag filter and usage counts look rows up by tag.
    index("entity_tag_assignments_tag_idx")
      .on(table.entityTagId)
      .where(sql`deleted IS NULL`),
  ]
);
