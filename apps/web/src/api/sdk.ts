import { auth } from "./auth.api";
import { columnDefinitions } from "./column-definitions.api";
import { connectorDefinitions } from "./connector-definitions.api";
import { connectorEntities } from "./connector-entities.api";
import { connectorInstances } from "./connector-instances.api";
import { fieldMappings } from "./field-mappings.api";
import { health } from "./health.api";
import { jobs } from "./jobs.api";
import { organizations } from "./organizations.api";
import { uploads } from "./uploads.api";

export { queryKeys } from "./keys";

export const sdk = {
  auth,
  columnDefinitions,
  connectorDefinitions,
  connectorEntities,
  connectorInstances,
  fieldMappings,
  health,
  jobs,
  organizations,
  uploads,
} as const;
