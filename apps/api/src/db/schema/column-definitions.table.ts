import {
  pgTable,
  text,
  boolean,
  pgEnum,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";

export const columnDataTypeEnum = pgEnum("column_data_type", [
  "string",
  "number",
  "boolean",
  "date",
  "datetime",
  "enum",
  "json",
  "array",
  "reference",
  "reference-array",
  // #316: PostGIS-backed geometry — kept in lockstep with core's
  // ColumnDataTypeEnum (the dual-schema type-check enforces it).
  "geometry",
]);

/**
 * Coordinate-pair role (#316). A pg enum rather than plain text so the
 * drizzle-zod select schema infers the same narrow union as core's
 * `GeoRoleSchema` — a `text` column would infer `string`, breaking the
 * bidirectional dual-schema assignability guard in `type-checks.ts`.
 */
export const geoRoleEnum = pgEnum("geo_role", ["lat", "lng"]);

/**
 * Column definitions table.
 * Shared, organization-level catalog of normalized fields that
 * connector entities map their source data into.
 */
export const columnDefinitions = pgTable(
  "column_definitions",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: columnDataTypeEnum("type").notNull(),
    description: text("description"),
    validationPattern: text("validation_pattern"),
    validationMessage: text("validation_message"),
    canonicalFormat: text("canonical_format"),
    system: boolean("system").notNull().default(false),
    // #316: null for every non-coordinate column (including geometry).
    geoRole: geoRoleEnum("geo_role"),
  },
  (table) => [
    uniqueIndex("column_definitions_org_key_unique")
      .on(table.organizationId, table.key)
      .where(sql`deleted IS NULL`),
  ]
);
