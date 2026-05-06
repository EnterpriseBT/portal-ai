import { auth } from "./auth.api";
import { columnDefinitions } from "./column-definitions.api";
import { connectorDefinitions } from "./connector-definitions.api";
import { connectorEntities } from "./connector-entities.api";
import { connectorInstances } from "./connector-instances.api";
import { connectorInstanceLayoutPlans } from "./connector-instance-layout-plans.api";
import { entityRecords } from "./entity-records.api";
import { entityGroups } from "./entity-groups.api";
import { entityTags } from "./entity-tags.api";
import { entityTagAssignments } from "./entity-tag-assignments.api";
import { fieldMappings } from "./field-mappings.api";
import { fileUploads } from "./file-uploads.api";
import { googleSheets } from "./google-sheets.api";
import { microsoftExcel } from "./microsoft-excel.api";
import { health } from "./health.api";
import { layoutPlans } from "./layout-plans.api";
import { jobs } from "./jobs.api";
import { organizations } from "./organizations.api";
import { portalResults } from "./portal-results.api";
import { portals } from "./portals.api";
import { sse } from "./sse.api";
import { stations } from "./stations.api";
import { toolpacks } from "./toolpacks.api";

export { queryKeys } from "./keys";

export const sdk = {
  auth,
  columnDefinitions,
  connectorDefinitions,
  connectorEntities,
  connectorInstances,
  connectorInstanceLayoutPlans,
  entityGroups,
  entityRecords,
  entityTags,
  entityTagAssignments,
  fieldMappings,
  fileUploads,
  googleSheets,
  microsoftExcel,
  health,
  layoutPlans,
  jobs,
  organizations,
  portalResults,
  portals,
  sse,
  stations,
  toolpacks,
} as const;
