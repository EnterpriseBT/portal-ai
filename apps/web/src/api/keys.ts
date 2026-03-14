import type { ConnectorDefinitionListRequestQuery } from "@portalai/core/contracts";
import type { JobListRequestQuery } from "@portalai/core/contracts";

export const queryKeys = {
  health: {
    root: ["health"] as const,
    check: () => [...queryKeys.health.root, "check"] as const,
  },
  auth: {
    root: ["auth"] as const,
    profile: () => [...queryKeys.auth.root, "profile"] as const,
  },
  organizations: {
    root: ["organizations"] as const,
    current: () => [...queryKeys.organizations.root, "current"] as const,
  },
  connectorDefinitions: {
    root: ["connectorDefinitions"] as const,
    list: (params?: ConnectorDefinitionListRequestQuery) =>
      [...queryKeys.connectorDefinitions.root, "list", params] as const,
    get: (id: string) =>
      [...queryKeys.connectorDefinitions.root, "get", id] as const,
  },
  jobs: {
    root: ["jobs"] as const,
    list: (params?: JobListRequestQuery) =>
      [...queryKeys.jobs.root, "list", params] as const,
    get: (id: string) =>
      [...queryKeys.jobs.root, "get", id] as const,
  },
};
