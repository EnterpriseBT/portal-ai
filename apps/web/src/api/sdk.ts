import { auth } from "./auth.api";
import { columnDefinitions } from "./column-definitions.api";
import { connectorDefinitions } from "./connector-definitions.api";
import { connectorEntities } from "./connector-entities.api";
import { connectorInstances } from "./connector-instances.api";
import { entityRecords } from "./entity-records.api";
import { entityGroups } from "./entity-groups.api";
import { entityTags } from "./entity-tags.api";
import { entityTagAssignments } from "./entity-tag-assignments.api";
import { fieldMappings } from "./field-mappings.api";
import { health } from "./health.api";
import { jobs } from "./jobs.api";
import { organizationTools } from "./organization-tools.api";
import { organizations } from "./organizations.api";
import { portalResults } from "./portal-results.api";
import { portals } from "./portals.api";
import { sse } from "./sse.api";
import { stationTools } from "./station-tools.api";
import { stations } from "./stations.api";
import { uploads } from "./uploads.api";

export { queryKeys } from "./keys";

export const sdk = {
  auth,
  columnDefinitions,
  connectorDefinitions,
  connectorEntities,
  connectorInstances,
  entityGroups,
  entityRecords,
  entityTags,
  entityTagAssignments,
  fieldMappings,
  health,
  jobs,
  organizationTools,
  organizations,
  portalResults,
  portals,
  sse,
  stationTools,
  stations,
  uploads,
} as const;
