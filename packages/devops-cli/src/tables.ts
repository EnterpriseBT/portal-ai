/**
 * The CLI's own minimal drizzle table defs (#218; the admin-cli #190
 * pattern). Runtime imports of apps/api are forbidden (module-load side
 * effects, inverted package graph), so the columns `tier apply` converges
 * are declared here — and `__tests__/tables-parity.test.ts` pins every one
 * against the API's real schema (name, dataType, notNull). Source of
 * truth: `apps/api/src/db/schema/tiers.table.ts`. FK/unique/check
 * constraints are deliberately omitted: the database enforces them; these
 * defs exist for query building only.
 */

import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
} from "drizzle-orm/pg-core";

/** Mirrors apps/api/src/db/schema/base.columns.ts (parity-pinned). */
const base = {
  id: text("id").primaryKey(),
  created: bigint("created", { mode: "number" }).notNull(),
  createdBy: text("created_by").notNull(),
  updated: bigint("updated", { mode: "number" }),
  updatedBy: text("updated_by"),
  deleted: bigint("deleted", { mode: "number" }),
  deletedBy: text("deleted_by"),
};

/** Full column set — apply converges every catalog-owned field. */
export const tiers = pgTable("tiers", {
  ...base,
  slug: text("slug").notNull(),
  displayName: text("display_name").notNull(),
  periodKind: text("period_kind").notNull(),
  periodAnchorDay: integer("period_anchor_day").notNull(),
  overage: text("overage").notNull(),
  freeUnitsPerPeriod: integer("free_units_per_period"),
  freeRatePerMin: integer("free_rate_per_min"),
  meteredUnitsPerPeriod: integer("metered_units_per_period"),
  meteredRatePerMin: integer("metered_rate_per_min"),
  expensiveUnitsPerPeriod: integer("expensive_units_per_period"),
  expensiveRatePerMin: integer("expensive_rate_per_min"),
  perToolCaps:
    jsonb("per_tool_caps").$type<Record<string, { unitsPerPeriod: number }>>(),
  stripePriceId: text("stripe_price_id"),
  selectable: boolean("selectable").notNull(),
  builtinToolpacks: jsonb("builtin_toolpacks").$type<string[]>().notNull(),
  customToolpacks: boolean("custom_toolpacks").notNull(),
  // #241: cta is converged from the catalog; description + visibility are
  // operator/per-client state the tier create/update commands write directly.
  cta: text("cta").notNull(),
  description: text("description"),
  visibleToOrganizationId: text("visible_to_organization_id"),
});
