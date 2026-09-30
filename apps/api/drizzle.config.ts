import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema/*.table.ts",
  dialect: "postgresql",
  dbCredentials: {
    // #660: the migration-only user, when set (see .env.example).
    url: process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL!,
  },
  // Exclude the dynamic per-entity wide tables (`er__<connector_entity_id>`).
  // They are created at runtime by the wide-table reconciler and intentionally
  // not modelled in static Drizzle schema; without this filter, both
  // `introspect` and `generate` try to drop them. See
  // docs/ENTITY_RECORDS_WIDE_TABLE_PHASE_1.spec.md.
  tablesFilter: ["!er__*"],
});
