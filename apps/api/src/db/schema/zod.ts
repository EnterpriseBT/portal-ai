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
import { stations } from "./stations.table.js";
import { stationInstances } from "./station-instances.table.js";
import { portals } from "./portals.table.js";
import { portalMessages } from "./portal-messages.table.js";
import { portalResults } from "./portal-results.table.js";
import { organizationTools } from "./organization-tools.table.js";
import { stationTools } from "./station-tools.table.js";
import { connectorInstanceLayoutPlans } from "./connector-instance-layout-plans.table.js";
import { fileUploads } from "./file-uploads.table.js";

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
export type ConnectorEntitySelect = z.infer<typeof ConnectorEntitySelectSchema>;
export type ConnectorEntityInsert = z.infer<typeof ConnectorEntityInsertSchema>;

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

// ── Stations ───────────────────────────────────────────────────────────

/** Zod schema for a `stations` row returned by SELECT. */
export const StationSelectSchema = createSelectSchema(stations);

/** Zod schema for inserting into `stations`. */
export const StationInsertSchema = createInsertSchema(stations);

/** Inferred types */
export type StationSelect = z.infer<typeof StationSelectSchema>;
export type StationInsert = z.infer<typeof StationInsertSchema>;

// ── Station Instances ──────────────────────────────────────────────────

/** Zod schema for a `station_instances` row returned by SELECT. */
export const StationInstanceSelectSchema = createSelectSchema(stationInstances);

/** Zod schema for inserting into `station_instances`. */
export const StationInstanceInsertSchema = createInsertSchema(stationInstances);

/** Inferred types */
export type StationInstanceSelect = z.infer<typeof StationInstanceSelectSchema>;
export type StationInstanceInsert = z.infer<typeof StationInstanceInsertSchema>;

// ── Portals ────────────────────────────────────────────────────────────

/** Zod schema for a `portals` row returned by SELECT. */
export const PortalSelectSchema = createSelectSchema(portals);

/** Zod schema for inserting into `portals`. */
export const PortalInsertSchema = createInsertSchema(portals);

/** Inferred types */
export type PortalSelect = z.infer<typeof PortalSelectSchema>;
export type PortalInsert = z.infer<typeof PortalInsertSchema>;

// ── Portal Messages ──────────────────────────────────────────────────

/** Zod schema for a `portal_messages` row returned by SELECT. */
export const PortalMessageSelectSchema = createSelectSchema(portalMessages);

/** Zod schema for inserting into `portal_messages`. */
export const PortalMessageInsertSchema = createInsertSchema(portalMessages);

/** Inferred types */
export type PortalMessageSelect = z.infer<typeof PortalMessageSelectSchema>;
export type PortalMessageInsert = z.infer<typeof PortalMessageInsertSchema>;

// ── Portal Results ───────────────────────────────────────────────────

/** Zod schema for a `portal_results` row returned by SELECT. */
export const PortalResultSelectSchema = createSelectSchema(portalResults);

/** Zod schema for inserting into `portal_results`. */
export const PortalResultInsertSchema = createInsertSchema(portalResults);

/** Inferred types */
export type PortalResultSelect = z.infer<typeof PortalResultSelectSchema>;
export type PortalResultInsert = z.infer<typeof PortalResultInsertSchema>;

// ── Organization Tools ───────────────────────────────────────────────

/** Zod schema for an `organization_tools` row returned by SELECT. */
export const OrganizationToolSelectSchema =
  createSelectSchema(organizationTools);

/** Zod schema for inserting into `organization_tools`. */
export const OrganizationToolInsertSchema =
  createInsertSchema(organizationTools);

/** Inferred types */
export type OrganizationToolSelect = z.infer<
  typeof OrganizationToolSelectSchema
>;
export type OrganizationToolInsert = z.infer<
  typeof OrganizationToolInsertSchema
>;

// ── Station Tools ────────────────────────────────────────────────────

/** Zod schema for a `station_tools` row returned by SELECT. */
export const StationToolSelectSchema = createSelectSchema(stationTools);

/** Zod schema for inserting into `station_tools`. */
export const StationToolInsertSchema = createInsertSchema(stationTools);

/** Inferred types */
export type StationToolSelect = z.infer<typeof StationToolSelectSchema>;
export type StationToolInsert = z.infer<typeof StationToolInsertSchema>;

// ── Connector Instance Layout Plans ──────────────────────────────────

/** Zod schema for a `connector_instance_layout_plans` row returned by SELECT. */
export const ConnectorInstanceLayoutPlanSelectSchema = createSelectSchema(
  connectorInstanceLayoutPlans
);

/** Zod schema for inserting into `connector_instance_layout_plans`. */
export const ConnectorInstanceLayoutPlanInsertSchema = createInsertSchema(
  connectorInstanceLayoutPlans
);

/** Inferred types */
export type ConnectorInstanceLayoutPlanSelect = z.infer<
  typeof ConnectorInstanceLayoutPlanSelectSchema
>;
export type ConnectorInstanceLayoutPlanInsert = z.infer<
  typeof ConnectorInstanceLayoutPlanInsertSchema
>;

// ── File Uploads ──────────────────────────────────────────────────────

/** Zod schema for a `file_uploads` row returned by SELECT. */
export const FileUploadSelectSchema = createSelectSchema(fileUploads);

/** Zod schema for inserting into `file_uploads`. */
export const FileUploadInsertSchema = createInsertSchema(fileUploads);

/** Inferred types */
export type FileUploadSelect = z.infer<typeof FileUploadSelectSchema>;
export type FileUploadInsert = z.infer<typeof FileUploadInsertSchema>;
