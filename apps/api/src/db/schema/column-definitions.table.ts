import { pgTable, text, boolean, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
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
]);

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
  },
  (table) => [
    uniqueIndex("column_definitions_org_key_unique")
      .on(table.organizationId, table.key)
      .where(sql`deleted IS NULL`),
  ],
);
