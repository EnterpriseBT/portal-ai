/**
 * Zod schemas derived from Drizzle table definitions via drizzle-zod.
 *
 * These are the single source of truth for database-layer validation.
 * Compile-time assertions in `./type-checks.ts` ensure that the
 * hand-written Zod schemas in `@portalai/core` stay in sync with these.
 */
import { createSelectSchema, createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./users.table.js";
import { organizations } from "./organizations.table.js";
import { organizationUsers } from "./organization-users.table.js";
import { connectorDefinitions } from "./connector-definitions.table.js";
import { connectorInstances } from "./connector-instances.table.js";
import { jobs } from "./jobs.table.js";
import { columnDefinitions } from "./column-definitions.table.js";
import { connectorEntities } from "./connector-entities.table.js";
import { fieldMappings } from "./field-mappings.table.js";
import { entityRecords } from "./entity-records.table.js";
import { entityTags } from "./entity-tags.table.js";
import { entityTagAssignments } from "./entity-tag-assignments.table.js";
import { entityGroups } from "./entity-groups.table.js";
import { entityGroupMembers } from "./entity-group-members.table.js";

// ── Users ─────────────────────────────────────────────────────────────

/** Zod schema for a `users` row returned by SELECT. */
export const UserSelectSchema = createSelectSchema(users);

/** Zod schema for inserting into `users`. */
export const UserInsertSchema = createInsertSchema(users);

/** Inferred types */
export type UserSelect = z.infer<typeof UserSelectSchema>;
export type UserInsert = z.infer<typeof UserInsertSchema>;

// ── Organizations ─────────────────────────────────────────────────────

/** Zod schema for an `organizations` row returned by SELECT. */
export const OrganizationSelectSchema = createSelectSchema(organizations);

/** Zod schema for inserting into `organizations`. */
export const OrganizationInsertSchema = createInsertSchema(organizations);

/** Inferred types */
export type OrganizationSelect = z.infer<typeof OrganizationSelectSchema>;
export type OrganizationInsert = z.infer<typeof OrganizationInsertSchema>;

// ── Organization Users ────────────────────────────────────────────────

/** Zod schema for an `organization_users` row returned by SELECT. */
export const OrganizationUserSelectSchema =
  createSelectSchema(organizationUsers);

/** Zod schema for inserting into `organization_users`. */
export const OrganizationUserInsertSchema =
  createInsertSchema(organizationUsers);

/** Inferred types */
export type OrganizationUserSelect = z.infer<
  typeof OrganizationUserSelectSchema
>;
export type OrganizationUserInsert = z.infer<
  typeof OrganizationUserInsertSchema
>;

// ── Connector Definitions ────────────────────────────────────────────

/** Zod schema for a `connector_definitions` row returned by SELECT. */
export const ConnectorDefinitionSelectSchema =
  createSelectSchema(connectorDefinitions);

/** Zod schema for inserting into `connector_definitions`. */
export const ConnectorDefinitionsInsertSchema =
  createInsertSchema(connectorDefinitions);

/** Inferred types */
export type ConnectorDefinitionSelect = z.infer<
  typeof ConnectorDefinitionSelectSchema
>;
export type ConnectorDefinitionInsert = z.infer<
  typeof ConnectorDefinitionsInsertSchema
>;

// ── Connector Instances ─────────────────────────────────────────────

/** Zod schema for a `connector_instances` row returned by SELECT. */
export const ConnectorInstanceSelectSchema =
  createSelectSchema(connectorInstances);

/** Zod schema for inserting into `connector_instances`. */
export const ConnectorInstanceInsertSchema =
  createInsertSchema(connectorInstances);

/** Inferred types */
export type ConnectorInstanceSelect = z.infer<
  typeof ConnectorInstanceSelectSchema
>;
export type ConnectorInstanceInsert = z.infer<
  typeof ConnectorInstanceInsertSchema
>;

// ── Jobs ──────────────────────────────────────────────────────────────

/** Zod schema for a `jobs` row returned by SELECT. */
export const JobSelectSchema = createSelectSchema(jobs);

/** Zod schema for inserting into `jobs`. */
export const JobInsertSchema = createInsertSchema(jobs);

/** Inferred types */
export type JobSelect = z.infer<typeof JobSelectSchema>;
export type JobInsert = z.infer<typeof JobInsertSchema>;

// ── Column Definitions ───────────────────────────────────────────────

/** Zod schema for a `column_definitions` row returned by SELECT. */
export const ColumnDefinitionSelectSchema =
  createSelectSchema(columnDefinitions);

/** Zod schema for inserting into `column_definitions`. */
export const ColumnDefinitionInsertSchema =
  createInsertSchema(columnDefinitions);

/** Inferred types */
export type ColumnDefinitionSelect = z.infer<
  typeof ColumnDefinitionSelectSchema
>;
export type ColumnDefinitionInsert = z.infer<
  typeof ColumnDefinitionInsertSchema
>;

// ── Connector Entities ───────────────────────────────────────────────

/** Zod schema for a `connector_entities` row returned by SELECT. */
export const ConnectorEntitySelectSchema =
  createSelectSchema(connectorEntities);

/** Zod schema for inserting into `connector_entities`. */
export const ConnectorEntityInsertSchema =
  createInsertSchema(connectorEntities);

/** Inferred types */
export type ConnectorEntitySelect = z.infer<
  typeof ConnectorEntitySelectSchema
>;
export type ConnectorEntityInsert = z.infer<
  typeof ConnectorEntityInsertSchema
>;

// ── Field Mappings ───────────────────────────────────────────────────

/** Zod schema for a `field_mappings` row returned by SELECT. */
export const FieldMappingSelectSchema = createSelectSchema(fieldMappings);

/** Zod schema for inserting into `field_mappings`. */
export const FieldMappingInsertSchema = createInsertSchema(fieldMappings);

/** Inferred types */
export type FieldMappingSelect = z.infer<typeof FieldMappingSelectSchema>;
export type FieldMappingInsert = z.infer<typeof FieldMappingInsertSchema>;

// ── Entity Records ──────────────────────────────────────────────────

/** Zod schema for an `entity_records` row returned by SELECT. */
export const EntityRecordSelectSchema = createSelectSchema(entityRecords);

/** Zod schema for inserting into `entity_records`. */
export const EntityRecordInsertSchema = createInsertSchema(entityRecords);

/** Inferred types */
export type EntityRecordSelect = z.infer<typeof EntityRecordSelectSchema>;
export type EntityRecordInsert = z.infer<typeof EntityRecordInsertSchema>;

// ── Entity Tags ─────────────────────────────────────────────────────

/** Zod schema for an `entity_tags` row returned by SELECT. */
export const EntityTagSelectSchema = createSelectSchema(entityTags);

/** Zod schema for inserting into `entity_tags`. */
export const EntityTagInsertSchema = createInsertSchema(entityTags);

/** Inferred types */
export type EntityTagSelect = z.infer<typeof EntityTagSelectSchema>;
export type EntityTagInsert = z.infer<typeof EntityTagInsertSchema>;

// ── Entity Tag Assignments ───────────────────────────────────────────

/** Zod schema for an `entity_tag_assignments` row returned by SELECT. */
export const EntityTagAssignmentSelectSchema =
  createSelectSchema(entityTagAssignments);

/** Zod schema for inserting into `entity_tag_assignments`. */
export const EntityTagAssignmentInsertSchema =
  createInsertSchema(entityTagAssignments);

/** Inferred types */
export type EntityTagAssignmentSelect = z.infer<
  typeof EntityTagAssignmentSelectSchema
>;
export type EntityTagAssignmentInsert = z.infer<
  typeof EntityTagAssignmentInsertSchema
>;

// ── Entity Groups ───────────────────────────────────────────────────

/** Zod schema for an `entity_groups` row returned by SELECT. */
export const EntityGroupSelectSchema = createSelectSchema(entityGroups);

/** Zod schema for inserting into `entity_groups`. */
export const EntityGroupInsertSchema = createInsertSchema(entityGroups);

/** Inferred types */
export type EntityGroupSelect = z.infer<typeof EntityGroupSelectSchema>;
export type EntityGroupInsert = z.infer<typeof EntityGroupInsertSchema>;

// ── Entity Group Members ────────────────────────────────────────────

/** Zod schema for an `entity_group_members` row returned by SELECT. */
export const EntityGroupMemberSelectSchema =
  createSelectSchema(entityGroupMembers);

/** Zod schema for inserting into `entity_group_members`. */
export const EntityGroupMemberInsertSchema =
  createInsertSchema(entityGroupMembers);

/** Inferred types */
export type EntityGroupMemberSelect = z.infer<
  typeof EntityGroupMemberSelectSchema
>;
export type EntityGroupMemberInsert = z.infer<
  typeof EntityGroupMemberInsertSchema
>;
