import { pgTable, text } from "drizzle-orm/pg-core";

import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";

export const entityGroups = pgTable("entity_groups", {
  ...baseColumns,
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  description: text("description"),
});
