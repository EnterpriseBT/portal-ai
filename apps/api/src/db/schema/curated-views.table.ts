import {
  pgTable,
  text,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import type { FilterGroup } from "@portalai/core/contracts";

import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { connectorEntities } from "./connector-entities.table.js";

/**
 * Curated views (#599) — per-entity curated slices (row filter + column
 * projection) that are the member data-read path. The column projection is
 * the `curated_view_field_mappings` join table (no rows = all of the
 * entity's current columns); `filter` is a structured `FilterGroup`
 * (null = all rows). No `isPassthrough` flag — an unrestricted view is
 * one with no projection rows and a null `filter`. `filter_sql` (#644) is the
 * advanced alternative to `filter`: at most one of the two is set.
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
    /** Structured row filter (a `FilterGroup`, #599); null = no filter. */
    filter: jsonb("filter").$type<FilterGroup>(),
    /** #644: advanced row filter — a validated SQL boolean fragment over the
     *  entity's column keys, as typed. Mutually exclusive with `filter`. */
    filterSql: text("filter_sql"),
    /** #644: the column keys `filter_sql` references, extracted by the
     *  validator at write. Derived — never written independently. Empty when
     *  there is no SQL filter. */
    filterSqlKeys: text("filter_sql_keys")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
  },
  (table) => [
    // #644: the row filter is a FilterGroup or SQL, never both.
    check(
      "curated_views_filter_mode_exclusive",
      sql`${table.filter} IS NULL OR ${table.filterSql} IS NULL`
    ),
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
