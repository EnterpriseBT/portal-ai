import type { ColumnDefinitionListRequestQuery } from "@portalai/core/contracts";
import type { ConnectorDefinitionListRequestQuery } from "@portalai/core/contracts";
import type { ConnectorEntityListRequestQuery } from "@portalai/core/contracts";
import type { ConnectorInstanceListRequestQuery } from "@portalai/core/contracts";
import type { EntityRecordListRequestQuery } from "@portalai/core/contracts";
import type { FieldMappingListRequestQuery } from "@portalai/core/contracts";
import type { EntityGroupListRequestQuery } from "@portalai/core/contracts";
import type { EntityGroupMemberOverlapRequestQuery } from "@portalai/core/contracts";
import type { EntityGroupResolveRequestQuery } from "@portalai/core/contracts";
import type { EntityTagListRequestQuery } from "@portalai/core/contracts";
import type { JobListRequestQuery } from "@portalai/core/contracts";
import type { StationListRequestQuery } from "@portalai/core/contracts";
import type { PortalListRequestQuery } from "@portalai/core/contracts";
import type { ToolpackListRequestQuery } from "@portalai/core/contracts";

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
    usage: () => [...queryKeys.organizations.root, "usage"] as const,
    memberships: () =>
      [...queryKeys.organizations.root, "memberships"] as const,
  },
  billing: {
    root: ["billing"] as const,
    tiers: () => [...queryKeys.billing.root, "tiers"] as const,
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
    impact: (id: string) =>
      [...queryKeys.connectorEntities.root, "impact", id] as const,
  },
  connectorInstances: {
    root: ["connectorInstances"] as const,
    list: (params?: ConnectorInstanceListRequestQuery) =>
      [...queryKeys.connectorInstances.root, "list", params] as const,
    get: (id: string) =>
      [...queryKeys.connectorInstances.root, "get", id] as const,
    impact: (id: string) =>
      [...queryKeys.connectorInstances.root, "impact", id] as const,
    runningJobs: (id: string) =>
      [...queryKeys.connectorInstances.root, "running-jobs", id] as const,
  },
  columnDefinitions: {
    root: ["columnDefinitions"] as const,
    list: (params?: ColumnDefinitionListRequestQuery) =>
      [...queryKeys.columnDefinitions.root, "list", params] as const,
    get: (id: string) =>
      [...queryKeys.columnDefinitions.root, "get", id] as const,
    impact: (id: string) =>
      [...queryKeys.columnDefinitions.root, "impact", id] as const,
  },
  fieldMappings: {
    root: ["fieldMappings"] as const,
    list: (params?: FieldMappingListRequestQuery) =>
      [...queryKeys.fieldMappings.root, "list", params] as const,
    validateBidirectional: (id: string) =>
      [...queryKeys.fieldMappings.root, "validateBidirectional", id] as const,
    impact: (id: string) =>
      [...queryKeys.fieldMappings.root, "impact", id] as const,
  },
  apiEndpoints: {
    root: ["apiEndpoints"] as const,
    byInstance: (instanceId: string) =>
      [...queryKeys.apiEndpoints.root, "byInstance", instanceId] as const,
    byEntity: (instanceId: string, entityId: string) =>
      [
        ...queryKeys.apiEndpoints.root,
        "byEntity",
        instanceId,
        entityId,
      ] as const,
  },
  entityRecords: {
    root: ["entityRecords"] as const,
    list: (connectorEntityId: string, params?: EntityRecordListRequestQuery) =>
      [
        ...queryKeys.entityRecords.root,
        "list",
        connectorEntityId,
        params,
      ] as const,
    count: (connectorEntityId: string) =>
      [...queryKeys.entityRecords.root, "count", connectorEntityId] as const,
    get: (connectorEntityId: string, recordId: string) =>
      [
        ...queryKeys.entityRecords.root,
        "get",
        connectorEntityId,
        recordId,
      ] as const,
  },
  entityGroups: {
    root: ["entityGroups"] as const,
    list: (params?: EntityGroupListRequestQuery) =>
      [...queryKeys.entityGroups.root, "list", params] as const,
    listByEntity: (connectorEntityId: string) =>
      [
        ...queryKeys.entityGroups.root,
        "listByEntity",
        connectorEntityId,
      ] as const,
    get: (id: string) => [...queryKeys.entityGroups.root, "get", id] as const,
    impact: (id: string) =>
      [...queryKeys.entityGroups.root, "impact", id] as const,
    memberOverlap: (
      id: string,
      params?: EntityGroupMemberOverlapRequestQuery
    ) => [...queryKeys.entityGroups.root, "memberOverlap", id, params] as const,
    resolve: (id: string, params?: EntityGroupResolveRequestQuery) =>
      [...queryKeys.entityGroups.root, "resolve", id, params] as const,
  },
  entityTags: {
    root: ["entityTags"] as const,
    list: (params?: EntityTagListRequestQuery) =>
      [...queryKeys.entityTags.root, "list", params] as const,
    get: (id: string) => [...queryKeys.entityTags.root, "get", id] as const,
  },
  entityTagAssignments: {
    root: ["entityTagAssignments"] as const,
    listByEntity: (connectorEntityId: string) =>
      [
        ...queryKeys.entityTagAssignments.root,
        "listByEntity",
        connectorEntityId,
      ] as const,
  },
  jobs: {
    root: ["jobs"] as const,
    list: (params?: JobListRequestQuery) =>
      [...queryKeys.jobs.root, "list", params] as const,
    get: (id: string) => [...queryKeys.jobs.root, "get", id] as const,
  },
  stations: {
    root: ["stations"] as const,
    list: (params?: StationListRequestQuery) =>
      [...queryKeys.stations.root, "list", params] as const,
    get: (id: string) => [...queryKeys.stations.root, "get", id] as const,
  },
  portals: {
    root: ["portals"] as const,
    list: (params?: PortalListRequestQuery) =>
      [...queryKeys.portals.root, "list", params] as const,
    get: (id: string, params?: Record<string, unknown>) =>
      [...queryKeys.portals.root, "get", id, params] as const,
    runningJobs: (id: string) =>
      [...queryKeys.portals.root, "running-jobs", id] as const,
  },
  portalResults: {
    root: ["portalResults"] as const,
    list: (params?: Record<string, unknown>) =>
      [...queryKeys.portalResults.root, "list", params] as const,
    get: (id: string) => [...queryKeys.portalResults.root, "get", id] as const,
  },
  portalSql: {
    root: ["portalSql"] as const,
    handleSnapshot: (
      handleId: string,
      params?: { offset?: number; limit?: number }
    ) =>
      [
        ...queryKeys.portalSql.root,
        "handleSnapshot",
        handleId,
        params,
      ] as const,
  },
  toolpacks: {
    root: ["toolpacks"] as const,
    list: (params?: ToolpackListRequestQuery) =>
      [...queryKeys.toolpacks.root, "list", params] as const,
    get: (id: string) => [...queryKeys.toolpacks.root, "get", id] as const,
  },
  connectorInstanceLayoutPlans: {
    root: ["connectorInstanceLayoutPlans"] as const,
    detail: (connectorInstanceId: string) =>
      [
        ...queryKeys.connectorInstanceLayoutPlans.root,
        "detail",
        connectorInstanceId,
      ] as const,
    editContext: (connectorInstanceId: string) =>
      [
        ...queryKeys.connectorInstanceLayoutPlans.root,
        "editContext",
        connectorInstanceId,
      ] as const,
  },
  layoutPlans: {
    root: ["layoutPlans"] as const,
  },
  fileUploads: {
    root: ["fileUploads"] as const,
    sheetSlice: (
      uploadSessionId: string,
      sheetId: string,
      rowStart: number,
      rowEnd: number,
      colStart: number,
      colEnd: number
    ) =>
      [
        ...queryKeys.fileUploads.root,
        "sheetSlice",
        uploadSessionId,
        sheetId,
        rowStart,
        rowEnd,
        colStart,
        colEnd,
      ] as const,
  },
  googleSheets: {
    root: ["googleSheets"] as const,
  },
  microsoftExcel: {
    root: ["microsoftExcel"] as const,
  },
};
