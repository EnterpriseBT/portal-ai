import { auth } from "./auth.api";
import { connectorDefinitions } from "./connector-definitions.api";
import { health } from "./health.api";
import { jobs } from "./jobs.api";
import { organizations } from "./organizations.api";

export { queryKeys } from "./keys";

export const sdk = {
  auth,
  connectorDefinitions,
  health,
  jobs,
  organizations,
} as const;
