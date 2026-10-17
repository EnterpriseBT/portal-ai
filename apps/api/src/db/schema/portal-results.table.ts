import {
  index,
  integer,
  pgTable,
  text,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { PIN_DEFINER_PRINCIPAL_TYPES } from "@portalai/core/models";

import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { stations } from "./stations.table.js";
import { portals } from "./portals.table.js";

/**
 * Portal result type enum.
 */
export const portalResultTypeEnum = pgEnum("portal_result_type", [
  "text",
  "data-table",
  "d3",
  "geo",
]);

/**
 * Portal results table.
 * Pinned/saved analytics results produced during portal sessions.
 */
export const portalResults = pgTable(
  "portal_results",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    stationId: text("station_id")
      .notNull()
      .references(() => stations.id),
    portalId: text("portal_id").references(() => portals.id),
    messageId: text("message_id"),
    blockIndex: integer("block_index"),
    name: text("name").notNull(),
    type: portalResultTypeEnum("type").notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    /** Whose access the pin's data executes under (#640). Queryable, not
     *  in `content`, so offboarding and revocation can find a definer's
     *  pins. */
    definerPrincipalType: text("definer_principal_type", {
      enum: PIN_DEFINER_PRINCIPAL_TYPES,
    }).notNull(),
    definerPrincipalId: text("definer_principal_id").notNull(),
  },
  (table) => [
    index("portal_results_definer_idx")
      .on(
        table.organizationId,
        table.definerPrincipalType,
        table.definerPrincipalId
      )
      .where(sql`deleted IS NULL`),
  ]
);
