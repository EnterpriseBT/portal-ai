import { auth } from "./auth.api";
import { connectorDefinitions } from "./connector-definitions.api";
import { connectorEntities } from "./connector-entities.api";
import { connectorInstances } from "./connector-instances.api";
import { health } from "./health.api";
import { jobs } from "./jobs.api";
import { organizations } from "./organizations.api";
import { uploads } from "./uploads.api";

export { queryKeys } from "./keys";

export const sdk = {
  auth,
  connectorDefinitions,
  connectorEntities,
  connectorInstances,
  health,
  jobs,
  organizations,
  uploads,
} as const;
