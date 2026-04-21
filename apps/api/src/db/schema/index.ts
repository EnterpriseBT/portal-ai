export { baseColumns } from "./base.columns.js";
export { users } from "./users.table.js";
export { organizations } from "./organizations.table.js";
export { organizationUsers } from "./organization-users.table.js";
export { connectorDefinitions } from "./connector-definitions.table.js";
export { connectorInstances } from "./connector-instances.table.js";
export {
  columnDefinitions,
  columnDataTypeEnum,
} from "./column-definitions.table.js";
export { connectorEntities } from "./connector-entities.table.js";
export { fieldMappings } from "./field-mappings.table.js";
export { entityRecords } from "./entity-records.table.js";
export { jobs, jobStatusEnum, jobTypeEnum } from "./jobs.table.js";
export { entityTags } from "./entity-tags.table.js";
export { entityTagAssignments } from "./entity-tag-assignments.table.js";
export { entityGroups } from "./entity-groups.table.js";
export { entityGroupMembers } from "./entity-group-members.table.js";
export { stations } from "./stations.table.js";
export { stationInstances } from "./station-instances.table.js";
export { portals } from "./portals.table.js";
export {
  portalMessages,
  portalMessageRoleEnum,
} from "./portal-messages.table.js";
export { portalResults, portalResultTypeEnum } from "./portal-results.table.js";
export { organizationTools } from "./organization-tools.table.js";
export { stationTools } from "./station-tools.table.js";
export { connectorInstanceLayoutPlans } from "./connector-instance-layout-plans.table.js";
export { fileUploads } from "./file-uploads.table.js";

/** Drizzle-zod derived schemas for runtime validation */
export * from "./zod.js";

/**
 * Type-checks — importing this module is a no-op at runtime but
 * causes a compile error if Drizzle schemas drift from @portalai/core.
 */
import "./type-checks.js";
