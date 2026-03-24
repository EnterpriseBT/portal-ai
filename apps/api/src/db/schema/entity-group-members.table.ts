import { boolean, pgTable, text, unique } from "drizzle-orm/pg-core";

import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { entityGroups } from "./entity-groups.table.js";
import { connectorEntities } from "./connector-entities.table.js";
import { fieldMappings } from "./field-mappings.table.js";

export const entityGroupMembers = pgTable(
  "entity_group_members",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    entityGroupId: text("entity_group_id")
      .notNull()
      .references(() => entityGroups.id),
    connectorEntityId: text("connector_entity_id")
      .notNull()
      .references(() => connectorEntities.id),
    linkFieldMappingId: text("link_field_mapping_id")
      .notNull()
      .references(() => fieldMappings.id),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (table) => [
    unique("entity_group_members_group_entity_unique").on(
      table.entityGroupId,
      table.connectorEntityId,
    ),
  ],
);
