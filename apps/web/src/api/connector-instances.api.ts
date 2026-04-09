import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import type {
  ApiSuccessResponse,
  ConnectorInstanceApi,
  ConnectorInstanceCreateRequestBody,
  ConnectorInstanceCreateResponsePayload,
  ConnectorInstanceGetResponsePayload,
  ConnectorInstanceImpact,
  ConnectorInstanceListRequestQuery,
  ConnectorInstanceListResponsePayload,
  ConnectorInstanceListWithDefinitionResponsePayload,
  ConnectorInstancePatchRequestBody,
} from "@portalai/core/contracts";
import { useInfiniteFilterOptions } from "@portalai/core/ui";
import type { InfiniteFilterOptionsConfig, SelectOption } from "@portalai/core/ui";
import { useAuthQuery, useAuthMutation, useAuthFetch, type ApiError } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions, SearchHookOptions, SearchResult } from "./types";

const CONNECTOR_INSTANCES_URL = "/api/connector-instances";

const defaultMapItem = (instance: ConnectorInstanceApi): SelectOption => ({
  value: instance.id,
  label: instance.name,
});

const CONNECTOR_INSTANCE_FILTER_BASE = {
  url: CONNECTOR_INSTANCES_URL,
  getItems: (res: ApiSuccessResponse<ConnectorInstanceListResponsePayload>) => res.payload.connectorInstances,
  getTotal: (res: ApiSuccessResponse<ConnectorInstanceListResponsePayload>) => res.payload.total,
  mapItem: (instance: ConnectorInstanceApi) => ({ value: instance.id, label: instance.name }),
  sortBy: "name",
} as const;

export const connectorInstances = {
  list: (
    params?: ConnectorInstanceListRequestQuery,
    options?: QueryOptions<ConnectorInstanceListResponsePayload>
  ) =>
    useAuthQuery<ConnectorInstanceListResponsePayload>(
      queryKeys.connectorInstances.list(params),
      buildUrl(CONNECTOR_INSTANCES_URL, params),
      undefined,
      options
    ),

  listWithDefinition: (
    params?: ConnectorInstanceListRequestQuery,
    options?: QueryOptions<ConnectorInstanceListWithDefinitionResponsePayload>
  ) =>
    useAuthQuery<ConnectorInstanceListWithDefinitionResponsePayload>(
      queryKeys.connectorInstances.list(params),
      buildUrl(CONNECTOR_INSTANCES_URL, { ...params, include: "connectorDefinition" }),
      undefined,
      options
    ),

  get: (
    id: string,
    options?: QueryOptions<ConnectorInstanceGetResponsePayload>
  ) =>
    useAuthQuery<ConnectorInstanceGetResponsePayload>(
      queryKeys.connectorInstances.get(id),
      buildUrl(`${CONNECTOR_INSTANCES_URL}/${encodeURIComponent(id)}`),
      undefined,
      options
    ),

  impact: (
    id: string,
    options?: QueryOptions<ConnectorInstanceImpact>
  ) =>
    useAuthQuery<ConnectorInstanceImpact>(
      queryKeys.connectorInstances.impact(id),
      buildUrl(`${CONNECTOR_INSTANCES_URL}/${encodeURIComponent(id)}/impact`),
      undefined,
      options
    ),

  create: () =>
    useAuthMutation<ConnectorInstanceCreateResponsePayload, ConnectorInstanceCreateRequestBody>({
      url: CONNECTOR_INSTANCES_URL,
      method: "POST",
    }),

  delete: (id: string) =>
    useAuthMutation<void, void>({
      url: `${CONNECTOR_INSTANCES_URL}/${encodeURIComponent(id)}`,
      method: "DELETE",
    }),

  rename: (id: string) =>
    useAuthMutation<ConnectorInstanceGetResponsePayload, { name: string }>({
      url: `${CONNECTOR_INSTANCES_URL}/${encodeURIComponent(id)}`,
      method: "PATCH",
    }),

  update: (id: string) =>
    useAuthMutation<ConnectorInstanceGetResponsePayload, ConnectorInstancePatchRequestBody>({
      url: `${CONNECTOR_INSTANCES_URL}/${encodeURIComponent(id)}`,
      method: "PATCH",
    }),

  search: <TOption extends SelectOption = SelectOption>(
    options?: SearchHookOptions<ConnectorInstanceApi, TOption>
  ): SearchResult<TOption> => {
    const { fetchWithAuth } = useAuthFetch();
    const mapFn = (options?.mapItem ?? defaultMapItem) as (item: ConnectorInstanceApi) => TOption;
    const [labelMap, setLabelMap] = useState<Record<string, string>>({});

    const searchMutation = useMutation<TOption[], ApiError, string>({
      mutationFn: async (query: string) => {
        const params: Record<string, string> = { ...options?.defaultParams };
        if (query) params.search = query;
        const res = await fetchWithAuth<ApiSuccessResponse<ConnectorInstanceListResponsePayload>>(
          buildUrl(CONNECTOR_INSTANCES_URL, params)
        );
        const mapped = res.payload.connectorInstances.map(mapFn);
        setLabelMap((prev) => {
          const next = { ...prev };
          for (const opt of mapped) next[String(opt.value)] = opt.label;
          return next;
        });
        return mapped;
      },
    });

    const getByIdMutation = useMutation<TOption | null, ApiError, string>({
      mutationFn: async (id: string) => {
        const res = await fetchWithAuth<ApiSuccessResponse<ConnectorInstanceGetResponsePayload>>(
          `${CONNECTOR_INSTANCES_URL}/${encodeURIComponent(id)}`
        );
        const option = mapFn(res.payload.connectorInstance as unknown as ConnectorInstanceApi);
        setLabelMap((prev) => ({ ...prev, [String(option.value)]: option.label }));
        return option;
      },
    });

    return {
      onSearch: searchMutation.mutateAsync,
      onSearchPending: searchMutation.isPending,
      onSearchError: searchMutation.error,
      getById: getByIdMutation.mutateAsync,
      getByIdPending: getByIdMutation.isPending,
      getByIdError: getByIdMutation.error,
      labelMap,
    };
  },

  filter: () => {
    const { fetchWithAuth } = useAuthFetch();

    const config: InfiniteFilterOptionsConfig<
      ApiSuccessResponse<ConnectorInstanceListResponsePayload>,
      ConnectorInstanceApi
    > = {
      ...CONNECTOR_INSTANCE_FILTER_BASE,
      fetcher: fetchWithAuth,
    };

    return useInfiniteFilterOptions(config);
  },
};
