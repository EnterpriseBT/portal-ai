import { auditLog } from "./audit-log.api";
import { auth } from "./auth.api";
import { billing } from "./billing.api";
import { connectorConfig } from "./connector-config.api";
import { columnDefinitions } from "./column-definitions.api";
import { connectorDefinitions } from "./connector-definitions.api";
import { connectorEntities } from "./connector-entities.api";
import { connectorInstances } from "./connector-instances.api";
import { connectorInstanceLayoutPlans } from "./connector-instance-layout-plans.api";
import { entityRecords } from "./entity-records.api";
import { entityGroups } from "./entity-groups.api";
import { entityTags } from "./entity-tags.api";
import { curatedViews } from "./curated-views.api";
import { entityTagAssignments } from "./entity-tag-assignments.api";
import { fieldMappings } from "./field-mappings.api";
import { fileUploads } from "./file-uploads.api";
import { googleSheets } from "./google-sheets.api";
import { microsoftExcel } from "./microsoft-excel.api";
import { health } from "./health.api";
import { layoutPlans } from "./layout-plans.api";
import { jobs } from "./jobs.api";
import { organizations } from "./organizations.api";
import { members } from "./members.api";
import { grants } from "./grants.api";
import { policies } from "./policies.api";
import { roles } from "./roles.api";
import { groups } from "./groups.api";
import { invitations } from "./invitations.api";
import { portalResults } from "./portal-results.api";
import { portalSql } from "./portal-sql.api";
import { portals } from "./portals.api";
import { sse } from "./sse.api";
import { stations } from "./stations.api";
import { toolpacks } from "./toolpacks.api";
import { apiConnector } from "./api-connector.api";

export { queryKeys } from "./keys";

/**
 * The SDK's shape, named per module so TypeScript serializes it by reference.
 * Inferring it from the object literal expands every hook's return type inline,
 * which outgrew the compiler's serialization limit (TS7056).
 */
export interface Sdk {
  readonly auditLog: typeof auditLog;
  readonly auth: typeof auth;
  readonly billing: typeof billing;
  readonly connectorConfig: typeof connectorConfig;
  readonly columnDefinitions: typeof columnDefinitions;
  readonly connectorDefinitions: typeof connectorDefinitions;
  readonly connectorEntities: typeof connectorEntities;
  readonly connectorInstances: typeof connectorInstances;
  readonly connectorInstanceLayoutPlans: typeof connectorInstanceLayoutPlans;
  readonly entityGroups: typeof entityGroups;
  readonly entityRecords: typeof entityRecords;
  readonly entityTags: typeof entityTags;
  readonly curatedViews: typeof curatedViews;
  readonly entityTagAssignments: typeof entityTagAssignments;
  readonly fieldMappings: typeof fieldMappings;
  readonly fileUploads: typeof fileUploads;
  readonly googleSheets: typeof googleSheets;
  readonly microsoftExcel: typeof microsoftExcel;
  readonly health: typeof health;
  readonly layoutPlans: typeof layoutPlans;
  readonly jobs: typeof jobs;
  readonly organizations: typeof organizations;
  readonly members: typeof members;
  readonly grants: typeof grants;
  readonly policies: typeof policies;
  readonly roles: typeof roles;
  readonly groups: typeof groups;
  readonly invitations: typeof invitations;
  readonly portalResults: typeof portalResults;
  readonly portalSql: typeof portalSql;
  readonly portals: typeof portals;
  readonly sse: typeof sse;
  readonly stations: typeof stations;
  readonly toolpacks: typeof toolpacks;
  readonly apiConnector: typeof apiConnector;
}

export const sdk: Sdk = {
  auditLog,
  auth,
  billing,
  connectorConfig,
  columnDefinitions,
  connectorDefinitions,
  connectorEntities,
  connectorInstances,
  connectorInstanceLayoutPlans,
  entityGroups,
  entityRecords,
  entityTags,
  curatedViews,
  entityTagAssignments,
  fieldMappings,
  fileUploads,
  googleSheets,
  microsoftExcel,
  health,
  layoutPlans,
  jobs,
  organizations,
  members,
  grants,
  policies,
  roles,
  groups,
  invitations,
  portalResults,
  portalSql,
  portals,
  sse,
  stations,
  toolpacks,
  apiConnector,
};
