import type { ColumnDefinitionListRequestQuery } from "@portalai/core/contracts";
import type { ConnectorDefinitionListRequestQuery } from "@portalai/core/contracts";
import type { ConnectorEntityListRequestQuery } from "@portalai/core/contracts";
import type { ConnectorInstanceListRequestQuery } from "@portalai/core/contracts";
import type { EntityRecordListRequestQuery } from "@portalai/core/contracts";
import type { FieldMappingListRequestQuery } from "@portalai/core/contracts";
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
  connectorEntities: {
    root: ["connectorEntities"] as const,
    list: (params?: ConnectorEntityListRequestQuery) =>
      [...queryKeys.connectorEntities.root, "list", params] as const,
    get: (id: string) =>
      [...queryKeys.connectorEntities.root, "get", id] as const,
  },
  connectorInstances: {
    root: ["connectorInstances"] as const,
    list: (params?: ConnectorInstanceListRequestQuery) =>
      [...queryKeys.connectorInstances.root, "list", params] as const,
    get: (id: string) =>
      [...queryKeys.connectorInstances.root, "get", id] as const,
  },
  columnDefinitions: {
    root: ["columnDefinitions"] as const,
    list: (params?: ColumnDefinitionListRequestQuery) =>
      [...queryKeys.columnDefinitions.root, "list", params] as const,
    get: (id: string) =>
      [...queryKeys.columnDefinitions.root, "get", id] as const,
  },
  fieldMappings: {
    root: ["fieldMappings"] as const,
    list: (params?: FieldMappingListRequestQuery) =>
      [...queryKeys.fieldMappings.root, "list", params] as const,
  },
  entityRecords: {
    root: ["entityRecords"] as const,
    list: (connectorEntityId: string, params?: EntityRecordListRequestQuery) =>
      [...queryKeys.entityRecords.root, "list", connectorEntityId, params] as const,
    count: (connectorEntityId: string) =>
      [...queryKeys.entityRecords.root, "count", connectorEntityId] as const,
  },
  jobs: {
    root: ["jobs"] as const,
    list: (params?: JobListRequestQuery) =>
      [...queryKeys.jobs.root, "list", params] as const,
    get: (id: string) =>
      [...queryKeys.jobs.root, "get", id] as const,
  },
};
