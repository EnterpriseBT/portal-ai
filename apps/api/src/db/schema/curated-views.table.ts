import { pgTable, text, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { connectorEntities } from "./connector-entities.table.js";

/**
 * Curated views (#599) — per-entity curated slices (row filter + column
 * projection) that are the member data-read path. The column projection is
 * the `curated_view_field_mappings` join table (no rows = all of the
 * entity's current columns); `whereClause` is a validated SQL boolean
 * expression (null = all rows). No `isPassthrough` flag — an unrestricted
 * view is one with no projection rows and a null `whereClause`.
 */
export const curatedViews = pgTable(
  "curated_views",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    connectorEntityId: text("connector_entity_id")
      .notNull()
      .references(() => connectorEntities.id),
    /** Per-org-unique; the session/queryable view name. */
    key: text("key").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    /** Validated SQL boolean expression; null = no row filter. */
    whereClause: text("where_clause"),
  },
  (table) => [
    uniqueIndex("curated_views_org_key_unique")
      .on(table.organizationId, table.key)
      .where(sql`deleted IS NULL`),
    // #433: scope + sort key + tiebreaker, partial on the soft-delete guard.
    index("curated_views_org_created_idx")
      .on(table.organizationId, table.created, table.id)
      .where(sql`deleted IS NULL`),
    index("curated_views_entity_idx")
      .on(table.connectorEntityId)
      .where(sql`deleted IS NULL`),
  ]
);
