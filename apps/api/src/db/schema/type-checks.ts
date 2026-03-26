/**
 * Compile-time assertions that guarantee the Drizzle table schemas
 * (source of truth) stay in sync with the hand-written Zod model
 * schemas exported from `@portalai/core`.
 *
 * If a column is added/removed/changed in a Drizzle table but the
 * corresponding Zod model in core is not updated (or vice-versa),
 * TypeScript will produce a compile error here — failing CI before
 * the mismatch can reach production.
 *
 * This file produces NO runtime code; it exists purely for the
 * type-checker.
 */

import type { User, Organization, OrganizationUser, ConnectorDefinition, ConnectorInstance, Job, ColumnDefinition, ConnectorEntity, FieldMapping, EntityRecord, EntityTag, EntityTagAssignment, EntityGroup, EntityGroupMember, Core, Station, StationInstance, Portal, PortalMessage, PortalResult, OrganizationTool, StationTool } from "@portalai/core/models";
import type { UserSelect, OrganizationSelect, OrganizationUserSelect, ConnectorDefinitionSelect, ConnectorInstanceSelect, JobSelect, ColumnDefinitionSelect, ConnectorEntitySelect, FieldMappingSelect, EntityRecordSelect, EntityTagSelect, EntityTagAssignmentSelect, EntityGroupSelect, EntityGroupMemberSelect, StationSelect, StationInstanceSelect, PortalSelect, PortalMessageSelect, PortalResultSelect, OrganizationToolSelect, StationToolSelect } from "./zod.js";
import type { InferSelectModel } from "drizzle-orm";
import type { users } from "./users.table.js";
import type { organizations } from "./organizations.table.js";
import type { organizationUsers } from "./organization-users.table.js";
import type { connectorDefinitions } from "./connector-definitions.table.js";
import type { connectorInstances } from "./connector-instances.table.js";
import type { jobs } from "./jobs.table.js";
import type { columnDefinitions } from "./column-definitions.table.js";
import type { connectorEntities } from "./connector-entities.table.js";
import type { fieldMappings } from "./field-mappings.table.js";
import type { entityRecords } from "./entity-records.table.js";
import type { entityTags } from "./entity-tags.table.js";
import type { entityTagAssignments } from "./entity-tag-assignments.table.js";
import type { entityGroups } from "./entity-groups.table.js";
import type { entityGroupMembers } from "./entity-group-members.table.js";
import type { stations } from "./stations.table.js";
import type { stationInstances } from "./station-instances.table.js";
import type { portals } from "./portals.table.js";
import type { portalMessages } from "./portal-messages.table.js";
import type { portalResults } from "./portal-results.table.js";
import type { organizationTools } from "./organization-tools.table.js";
import type { stationTools } from "./station-tools.table.js";

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Evaluates to `true` if A is assignable to B, otherwise `never`.
 * Use in both directions for structural equality.
 */
type IsAssignable<A, B> = A extends B ? true : never;

// ── User ────────────────────────────────────────────────────

// Drizzle select row → core Zod model (every DB row must satisfy the model)
type _DrizzleToModel = IsAssignable<UserSelect, User>;
const _drizzleToModel: _DrizzleToModel = true;

// Core Zod model → Drizzle select row (every model value must be a valid row)
type _ModelToDrizzle = IsAssignable<User, UserSelect>;
const _modelToDrizzle: _ModelToDrizzle = true;

// Also verify the raw InferSelectModel matches
type _InferredRow = InferSelectModel<typeof users>;
type _InferredToModel = IsAssignable<_InferredRow, User>;
const _inferredToModel: _InferredToModel = true;

// ── Organization ────────────────────────────────────────────────

// Drizzle select row → core Zod model (every DB row must satisfy the model)
type _OrgDrizzleToModel = IsAssignable<OrganizationSelect, Organization>;
const _orgDrizzleToModel: _OrgDrizzleToModel = true;

// Core Zod model → Drizzle select row (every model value must be a valid row)
type _OrgModelToDrizzle = IsAssignable<Organization, OrganizationSelect>;
const _orgModelToDrizzle: _OrgModelToDrizzle = true;

// Also verify the raw InferSelectModel matches
type _OrgInferredRow = InferSelectModel<typeof organizations>;
type _OrgInferredToModel = IsAssignable<_OrgInferredRow, Organization>;
const _orgInferredToModel: _OrgInferredToModel = true;

// ── OrganizationUser ─────────────────────────────────────────────

// Drizzle select row → core Zod model (every DB row must satisfy the model)
type _OrgUserDrizzleToModel = IsAssignable<OrganizationUserSelect, OrganizationUser>;
const _orgUserDrizzleToModel: _OrgUserDrizzleToModel = true;

// Core Zod model → Drizzle select row (every model value must be a valid row)
type _OrgUserModelToDrizzle = IsAssignable<OrganizationUser, OrganizationUserSelect>;
const _orgUserModelToDrizzle: _OrgUserModelToDrizzle = true;

// Also verify the raw InferSelectModel matches
type _OrgUserInferredRow = InferSelectModel<typeof organizationUsers>;
type _OrgUserInferredToModel = IsAssignable<_OrgUserInferredRow, OrganizationUser>;
const _orgUserInferredToModel: _OrgUserInferredToModel = true;

// ── Base Model ──────────────────────────────────────────────────────

// Ensure the base audit fields in the Drizzle row satisfy Core.
// We pick only the base keys to avoid failing on entity-specific columns.
type BaseKeys = keyof Core;
type DrizzleBaseFields = Pick<UserSelect, BaseKeys>;

type _DrizzleBaseToModel = IsAssignable<DrizzleBaseFields, Core>;
const _drizzleBaseToModel: _DrizzleBaseToModel = true;

type _ModelToBase = IsAssignable<Core, DrizzleBaseFields>;
const _modelToBase: _ModelToBase = true;

// ── ConnectorDefinition ─────────────────────────────────────────

// Drizzle select row → core Zod model (every DB row must satisfy the model)
type _ConnDefDrizzleToModel = IsAssignable<ConnectorDefinitionSelect, ConnectorDefinition>;
const _connDefDrizzleToModel: _ConnDefDrizzleToModel = true;

// Core Zod model → Drizzle select row (every model value must be a valid row)
// Core Zod model → Drizzle select row (every model value must be a valid row)
type _ConnDefModelToDrizzle = IsAssignable<ConnectorDefinition, ConnectorDefinitionSelect>;
const _connDefModelToDrizzle: _ConnDefModelToDrizzle = true;

// Also verify the raw InferSelectModel matches
type _ConnDefInferredRow = InferSelectModel<typeof connectorDefinitions>;
type _ConnDefInferredToModel = IsAssignable<_ConnDefInferredRow, ConnectorDefinition>;
const _connDefInferredToModel: _ConnDefInferredToModel = true;

// ── ConnectorInstance ──────────────────────────────────────────────

// Drizzle select row → core Zod model (every DB row must satisfy the model)
type _ConnInstDrizzleToModel = IsAssignable<ConnectorInstanceSelect, ConnectorInstance>;
const _connInstDrizzleToModel: _ConnInstDrizzleToModel = true;

// Core Zod model → Drizzle select row (every model value must be a valid row)
type _ConnInstModelToDrizzle = IsAssignable<ConnectorInstance, ConnectorInstanceSelect>;
const _connInstModelToDrizzle: _ConnInstModelToDrizzle = true;

// Also verify the raw InferSelectModel matches
type _ConnInstInferredRow = InferSelectModel<typeof connectorInstances>;
type _ConnInstInferredToModel = IsAssignable<_ConnInstInferredRow, ConnectorInstance>;
const _connInstInferredToModel: _ConnInstInferredToModel = true;

// ── Job ─────────────────────────────────────────────────────────────

// Drizzle select row → core Zod model (every DB row must satisfy the model)
type _JobDrizzleToModel = IsAssignable<JobSelect, Job>;
const _jobDrizzleToModel: _JobDrizzleToModel = true;

// Core Zod model → Drizzle select row (every model value must be a valid row)
type _JobModelToDrizzle = IsAssignable<Job, JobSelect>;
const _jobModelToDrizzle: _JobModelToDrizzle = true;

// Also verify the raw InferSelectModel matches
type _JobInferredRow = InferSelectModel<typeof jobs>;
type _JobInferredToModel = IsAssignable<_JobInferredRow, Job>;
const _jobInferredToModel: _JobInferredToModel = true;

// ── ColumnDefinition ─────────────────────────────────────────────

// Drizzle select row → core Zod model (every DB row must satisfy the model)
type _ColDefDrizzleToModel = IsAssignable<ColumnDefinitionSelect, ColumnDefinition>;
const _colDefDrizzleToModel: _ColDefDrizzleToModel = true;

// Core Zod model → Drizzle select row (every model value must be a valid row)
type _ColDefModelToDrizzle = IsAssignable<ColumnDefinition, ColumnDefinitionSelect>;
const _colDefModelToDrizzle: _ColDefModelToDrizzle = true;

// Also verify the raw InferSelectModel matches
type _ColDefInferredRow = InferSelectModel<typeof columnDefinitions>;
type _ColDefInferredToModel = IsAssignable<_ColDefInferredRow, ColumnDefinition>;
const _colDefInferredToModel: _ColDefInferredToModel = true;

// ── ConnectorEntity ──────────────────────────────────────────────

// Drizzle select row → core Zod model (every DB row must satisfy the model)
type _ConnEntDrizzleToModel = IsAssignable<ConnectorEntitySelect, ConnectorEntity>;
const _connEntDrizzleToModel: _ConnEntDrizzleToModel = true;

// Core Zod model → Drizzle select row (every model value must be a valid row)
type _ConnEntModelToDrizzle = IsAssignable<ConnectorEntity, ConnectorEntitySelect>;
const _connEntModelToDrizzle: _ConnEntModelToDrizzle = true;

// Also verify the raw InferSelectModel matches
type _ConnEntInferredRow = InferSelectModel<typeof connectorEntities>;
type _ConnEntInferredToModel = IsAssignable<_ConnEntInferredRow, ConnectorEntity>;
const _connEntInferredToModel: _ConnEntInferredToModel = true;

// ── FieldMapping ─────────────────────────────────────────────────

// Drizzle select row → core Zod model (every DB row must satisfy the model)
type _FieldMapDrizzleToModel = IsAssignable<FieldMappingSelect, FieldMapping>;
const _fieldMapDrizzleToModel: _FieldMapDrizzleToModel = true;

// Core Zod model → Drizzle select row (every model value must be a valid row)
type _FieldMapModelToDrizzle = IsAssignable<FieldMapping, FieldMappingSelect>;
const _fieldMapModelToDrizzle: _FieldMapModelToDrizzle = true;

// Also verify the raw InferSelectModel matches
type _FieldMapInferredRow = InferSelectModel<typeof fieldMappings>;
type _FieldMapInferredToModel = IsAssignable<_FieldMapInferredRow, FieldMapping>;
const _fieldMapInferredToModel: _FieldMapInferredToModel = true;

// ── EntityRecord ────────────────────────────────────────────────────

// Drizzle select row → core Zod model (every DB row must satisfy the model)
type _EntRecDrizzleToModel = IsAssignable<EntityRecordSelect, EntityRecord>;
const _entRecDrizzleToModel: _EntRecDrizzleToModel = true;

// Core Zod model → Drizzle select row (every model value must be a valid row)
type _EntRecModelToDrizzle = IsAssignable<EntityRecord, EntityRecordSelect>;
const _entRecModelToDrizzle: _EntRecModelToDrizzle = true;

// Also verify the raw InferSelectModel matches
type _EntRecInferredRow = InferSelectModel<typeof entityRecords>;
type _EntRecInferredToModel = IsAssignable<_EntRecInferredRow, EntityRecord>;
const _entRecInferredToModel: _EntRecInferredToModel = true;

// ── EntityTag ────────────────────────────────────────────────────────

// Drizzle select row → core Zod model (every DB row must satisfy the model)
type _EntTagDrizzleToModel = IsAssignable<EntityTagSelect, EntityTag>;
const _entTagDrizzleToModel: _EntTagDrizzleToModel = true;

// Core Zod model → Drizzle select row (every model value must be a valid row)
type _EntTagModelToDrizzle = IsAssignable<EntityTag, EntityTagSelect>;
const _entTagModelToDrizzle: _EntTagModelToDrizzle = true;

// Also verify the raw InferSelectModel matches
type _EntTagInferredRow = InferSelectModel<typeof entityTags>;
type _EntTagInferredToModel = IsAssignable<_EntTagInferredRow, EntityTag>;
const _entTagInferredToModel: _EntTagInferredToModel = true;

// ── EntityTagAssignment ──────────────────────────────────────────────

// Drizzle select row → core Zod model (every DB row must satisfy the model)
type _EntTagAssignDrizzleToModel = IsAssignable<EntityTagAssignmentSelect, EntityTagAssignment>;
const _entTagAssignDrizzleToModel: _EntTagAssignDrizzleToModel = true;

// Core Zod model → Drizzle select row (every model value must be a valid row)
type _EntTagAssignModelToDrizzle = IsAssignable<EntityTagAssignment, EntityTagAssignmentSelect>;
const _entTagAssignModelToDrizzle: _EntTagAssignModelToDrizzle = true;

// Also verify the raw InferSelectModel matches
type _EntTagAssignInferredRow = InferSelectModel<typeof entityTagAssignments>;
type _EntTagAssignInferredToModel = IsAssignable<_EntTagAssignInferredRow, EntityTagAssignment>;
const _entTagAssignInferredToModel: _EntTagAssignInferredToModel = true;

// ── EntityGroup ─────────────────────────────────────────────────────

// Drizzle select row → core Zod model (every DB row must satisfy the model)
type _EntGrpDrizzleToModel = IsAssignable<EntityGroupSelect, EntityGroup>;
const _entGrpDrizzleToModel: _EntGrpDrizzleToModel = true;

// Core Zod model → Drizzle select row (every model value must be a valid row)
type _EntGrpModelToDrizzle = IsAssignable<EntityGroup, EntityGroupSelect>;
const _entGrpModelToDrizzle: _EntGrpModelToDrizzle = true;

// Also verify the raw InferSelectModel matches
type _EntGrpInferredRow = InferSelectModel<typeof entityGroups>;
type _EntGrpInferredToModel = IsAssignable<_EntGrpInferredRow, EntityGroup>;
const _entGrpInferredToModel: _EntGrpInferredToModel = true;

// ── EntityGroupMember ───────────────────────────────────────────────

// Drizzle select row → core Zod model (every DB row must satisfy the model)
type _EntGrpMemDrizzleToModel = IsAssignable<EntityGroupMemberSelect, EntityGroupMember>;
const _entGrpMemDrizzleToModel: _EntGrpMemDrizzleToModel = true;

// Core Zod model → Drizzle select row (every model value must be a valid row)
type _EntGrpMemModelToDrizzle = IsAssignable<EntityGroupMember, EntityGroupMemberSelect>;
const _entGrpMemModelToDrizzle: _EntGrpMemModelToDrizzle = true;

// Also verify the raw InferSelectModel matches
type _EntGrpMemInferredRow = InferSelectModel<typeof entityGroupMembers>;
type _EntGrpMemInferredToModel = IsAssignable<_EntGrpMemInferredRow, EntityGroupMember>;
const _entGrpMemInferredToModel: _EntGrpMemInferredToModel = true;

// ── Station ───────────────────────────────────────────────────────────

type _StaDrizzleToModel = IsAssignable<StationSelect, Station>;
const _staDrizzleToModel: _StaDrizzleToModel = true;

// Omit toolPacks because drizzle-zod widens jsonb to a JSON union type
// that string[] is not directly assignable to. The other two checks
// (DrizzleToModel, InferredToModel) still validate schema alignment.
type _StaModelToDrizzle = IsAssignable<
  Omit<Station, "toolPacks">,
  Omit<StationSelect, "toolPacks">
>;
const _staModelToDrizzle: _StaModelToDrizzle = true;

type _StaInferredRow = InferSelectModel<typeof stations>;
type _StaInferredToModel = IsAssignable<_StaInferredRow, Station>;
const _staInferredToModel: _StaInferredToModel = true;

// ── StationInstance ───────────────────────────────────────────────────

type _StaInstDrizzleToModel = IsAssignable<StationInstanceSelect, StationInstance>;
const _staInstDrizzleToModel: _StaInstDrizzleToModel = true;

type _StaInstModelToDrizzle = IsAssignable<StationInstance, StationInstanceSelect>;
const _staInstModelToDrizzle: _StaInstModelToDrizzle = true;

type _StaInstInferredRow = InferSelectModel<typeof stationInstances>;
type _StaInstInferredToModel = IsAssignable<_StaInstInferredRow, StationInstance>;
const _staInstInferredToModel: _StaInstInferredToModel = true;

// ── Portal ────────────────────────────────────────────────────────────

type _PortalDrizzleToModel = IsAssignable<PortalSelect, Portal>;
const _portalDrizzleToModel: _PortalDrizzleToModel = true;

type _PortalModelToDrizzle = IsAssignable<Portal, PortalSelect>;
const _portalModelToDrizzle: _PortalModelToDrizzle = true;

type _PortalInferredRow = InferSelectModel<typeof portals>;
type _PortalInferredToModel = IsAssignable<_PortalInferredRow, Portal>;
const _portalInferredToModel: _PortalInferredToModel = true;

// ── PortalMessage ─────────────────────────────────────────────────────

type _PortalMsgDrizzleToModel = IsAssignable<PortalMessageSelect, PortalMessage>;
const _portalMsgDrizzleToModel: _PortalMsgDrizzleToModel = true;

type _PortalMsgModelToDrizzle = IsAssignable<PortalMessage, PortalMessageSelect>;
const _portalMsgModelToDrizzle: _PortalMsgModelToDrizzle = true;

type _PortalMsgInferredRow = InferSelectModel<typeof portalMessages>;
type _PortalMsgInferredToModel = IsAssignable<_PortalMsgInferredRow, PortalMessage>;
const _portalMsgInferredToModel: _PortalMsgInferredToModel = true;

// ── PortalResult ──────────────────────────────────────────────────────

type _PortalResDrizzleToModel = IsAssignable<PortalResultSelect, PortalResult>;
const _portalResDrizzleToModel: _PortalResDrizzleToModel = true;

type _PortalResModelToDrizzle = IsAssignable<PortalResult, PortalResultSelect>;
const _portalResModelToDrizzle: _PortalResModelToDrizzle = true;

type _PortalResInferredRow = InferSelectModel<typeof portalResults>;
type _PortalResInferredToModel = IsAssignable<_PortalResInferredRow, PortalResult>;
const _portalResInferredToModel: _PortalResInferredToModel = true;

// ── OrganizationTool ──────────────────────────────────────────────────

type _OrgToolDrizzleToModel = IsAssignable<OrganizationToolSelect, OrganizationTool>;
const _orgToolDrizzleToModel: _OrgToolDrizzleToModel = true;

type _OrgToolModelToDrizzle = IsAssignable<OrganizationTool, OrganizationToolSelect>;
const _orgToolModelToDrizzle: _OrgToolModelToDrizzle = true;

type _OrgToolInferredRow = InferSelectModel<typeof organizationTools>;
type _OrgToolInferredToModel = IsAssignable<_OrgToolInferredRow, OrganizationTool>;
const _orgToolInferredToModel: _OrgToolInferredToModel = true;

// ── StationTool ───────────────────────────────────────────────────────

type _StaToolDrizzleToModel = IsAssignable<StationToolSelect, StationTool>;
const _staToolDrizzleToModel: _StaToolDrizzleToModel = true;

type _StaToolModelToDrizzle = IsAssignable<StationTool, StationToolSelect>;
const _staToolModelToDrizzle: _StaToolModelToDrizzle = true;

type _StaToolInferredRow = InferSelectModel<typeof stationTools>;
type _StaToolInferredToModel = IsAssignable<_StaToolInferredRow, StationTool>;
const _staToolInferredToModel: _StaToolInferredToModel = true;
