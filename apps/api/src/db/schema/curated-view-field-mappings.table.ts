import { pgTable, text, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { curatedViews } from "./curated-views.table.js";
import { fieldMappings } from "./field-mappings.table.js";

/**
 * Curated-view ↔ field-mapping projection join (#599). Each row places one
 * field mapping (a column) into a curated view's projection, and is what the
 * `in_curated_view` FK grant condition expands against.
 */
export const curatedViewFieldMappings = pgTable(
  "curated_view_field_mappings",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    curatedViewId: text("curated_view_id")
      .notNull()
      .references(() => curatedViews.id),
    fieldMappingId: text("field_mapping_id")
      .notNull()
      .references(() => fieldMappings.id),
  },
  (table) => [
    uniqueIndex("curated_view_field_mappings_view_fm_unique")
      .on(table.curatedViewId, table.fieldMappingId)
      .where(sql`deleted IS NULL`),
    // The FK-condition subquery + projection resolution read by curated view.
    index("curated_view_field_mappings_view_idx")
      .on(table.curatedViewId)
      .where(sql`deleted IS NULL`),
  ]
);
