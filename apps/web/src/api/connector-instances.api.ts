import { useMemo } from "react";

import type {
  ApiSuccessResponse,
  ConnectorInstanceApi,
  ConnectorInstanceGetResponsePayload,
  ConnectorInstanceImpact,
  ConnectorInstanceListRequestQuery,
  ConnectorInstanceListResponsePayload,
  ConnectorInstanceListWithDefinitionResponsePayload,
  ConnectorInstancePatchRequestBody,
} from "@portalai/core/contracts";
import { useInfiniteFilterOptions, useAsyncFilterOptions } from "@portalai/core/ui";
import type { InfiniteFilterOptionsConfig, AsyncFilterOptionsConfig } from "@portalai/core/ui";
import { useAuthQuery, useAuthMutation, useAuthFetch } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

const CONNECTOR_INSTANCE_FILTER_BASE = {
  url: "/api/connector-instances",
  getItems: (res: ApiSuccessResponse<ConnectorInstanceListResponsePayload>) => res.payload.connectorInstances,
  getTotal: (res: ApiSuccessResponse<ConnectorInstanceListResponsePayload>) => res.payload.total,
  mapItem: (instance: ConnectorInstanceApi) => ({
    value: instance.id,
    label: instance.name,
  }),
  sortBy: "name",
} as const;

export function useConnectorInstanceSearch() {
  const { fetchWithAuth } = useAuthFetch();

  const config = useMemo<
    AsyncFilterOptionsConfig<
      ApiSuccessResponse<ConnectorInstanceListResponsePayload>,
      ConnectorInstanceApi
    >
  >(
    () => ({
      ...CONNECTOR_INSTANCE_FILTER_BASE,
      fetcher: fetchWithAuth,
    }),
    [fetchWithAuth]
  );

  return useAsyncFilterOptions(config);
}

export function useConnectorInstanceFilter() {
  const { fetchWithAuth } = useAuthFetch();

  const config: InfiniteFilterOptionsConfig<
    ApiSuccessResponse<ConnectorInstanceListResponsePayload>,
    ConnectorInstanceApi
  > = {
    ...CONNECTOR_INSTANCE_FILTER_BASE,
    fetcher: fetchWithAuth,
  };

  return useInfiniteFilterOptions(config);
}

export const connectorInstances = {
  list: (
    params?: ConnectorInstanceListRequestQuery,
    options?: QueryOptions<ConnectorInstanceListResponsePayload>
  ) =>
    useAuthQuery<ConnectorInstanceListResponsePayload>(
      queryKeys.connectorInstances.list(params),
      buildUrl("/api/connector-instances", params),
      undefined,
      options
    ),

  listWithDefinition: (
    params?: ConnectorInstanceListRequestQuery,
    options?: QueryOptions<ConnectorInstanceListWithDefinitionResponsePayload>
  ) =>
    useAuthQuery<ConnectorInstanceListWithDefinitionResponsePayload>(
      queryKeys.connectorInstances.list(params),
      buildUrl("/api/connector-instances", { ...params, include: "connectorDefinition" }),
      undefined,
      options
    ),

  get: (
    id: string,
    options?: QueryOptions<ConnectorInstanceGetResponsePayload>
  ) =>
    useAuthQuery<ConnectorInstanceGetResponsePayload>(
      queryKeys.connectorInstances.get(id),
      buildUrl(`/api/connector-instances/${encodeURIComponent(id)}`),
      undefined,
      options
    ),

  impact: (
    id: string,
    options?: QueryOptions<ConnectorInstanceImpact>
  ) =>
    useAuthQuery<ConnectorInstanceImpact>(
      queryKeys.connectorInstances.impact(id),
      buildUrl(`/api/connector-instances/${encodeURIComponent(id)}/impact`),
      undefined,
      options
    ),

  delete: (id: string) =>
    useAuthMutation<void, void>({
      url: `/api/connector-instances/${encodeURIComponent(id)}`,
      method: "DELETE",
    }),

  rename: (id: string) =>
    useAuthMutation<ConnectorInstanceGetResponsePayload, { name: string }>({
      url: `/api/connector-instances/${encodeURIComponent(id)}`,
      method: "PATCH",
    }),

  update: (id: string) =>
    useAuthMutation<ConnectorInstanceGetResponsePayload, ConnectorInstancePatchRequestBody>({
      url: `/api/connector-instances/${encodeURIComponent(id)}`,
      method: "PATCH",
    }),
};
