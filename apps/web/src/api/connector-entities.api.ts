import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import type {
  ApiSuccessResponse,
  ConnectorEntityCreateRequestBody,
  ConnectorEntityCreateResponsePayload,
  ConnectorEntityGetResponsePayload,
  ConnectorEntityImpactResponsePayload,
  ConnectorEntityListRequestQuery,
  ConnectorEntityListResponsePayload,
  ConnectorEntityListWithInstanceResponsePayload,
  ConnectorEntityListWithMappingsResponsePayload,
  ConnectorEntityPatchRequestBody,
  ConnectorEntityPatchResponsePayload,
} from "@portalai/core/contracts";
import type { ConnectorEntity } from "@portalai/core/models";
import type { SelectOption } from "@portalai/core/ui";
import {
  useAuthQuery,
  useAuthMutation,
  useAuthFetch,
  type ApiError,
} from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions, SearchHookOptions, SearchResult } from "./types";

const CONNECTOR_ENTITIES_URL = "/api/connector-entities";

const defaultMapItem = (entity: ConnectorEntity): SelectOption => ({
  value: entity.id,
  label: entity.label,
});

export const connectorEntities = {
  list: (
    params?: ConnectorEntityListRequestQuery,
    options?: QueryOptions<
      | ConnectorEntityListResponsePayload
      | ConnectorEntityListWithMappingsResponsePayload
    >
  ) =>
    useAuthQuery<
      | ConnectorEntityListResponsePayload
      | ConnectorEntityListWithMappingsResponsePayload
    >(
      queryKeys.connectorEntities.list(params),
      buildUrl(CONNECTOR_ENTITIES_URL, params),
      undefined,
      options
    ),

  get: (
    id: string,
    options?: QueryOptions<ConnectorEntityGetResponsePayload>
  ) =>
    useAuthQuery<ConnectorEntityGetResponsePayload>(
      queryKeys.connectorEntities.get(id),
      buildUrl(`${CONNECTOR_ENTITIES_URL}/${encodeURIComponent(id)}`),
      undefined,
      options
    ),

  impact: (
    id: string,
    options?: QueryOptions<ConnectorEntityImpactResponsePayload>
  ) =>
    useAuthQuery<ConnectorEntityImpactResponsePayload>(
      queryKeys.connectorEntities.impact(id),
      buildUrl(`${CONNECTOR_ENTITIES_URL}/${encodeURIComponent(id)}/impact`),
      undefined,
      options
    ),

  update: (id: string) =>
    useAuthMutation<
      ConnectorEntityPatchResponsePayload,
      ConnectorEntityPatchRequestBody
    >({
      url: `${CONNECTOR_ENTITIES_URL}/${encodeURIComponent(id)}`,
      method: "PATCH",
    }),

  create: () =>
    useAuthMutation<
      ConnectorEntityCreateResponsePayload,
      ConnectorEntityCreateRequestBody
    >({
      url: CONNECTOR_ENTITIES_URL,
      method: "POST",
    }),

  delete: (id: string) =>
    useAuthMutation<void, void>({
      url: `${CONNECTOR_ENTITIES_URL}/${encodeURIComponent(id)}`,
      method: "DELETE",
    }),

  search: <TOption extends SelectOption = SelectOption>(
    options?: SearchHookOptions<ConnectorEntity, TOption>
  ): SearchResult<TOption> => {
    const { fetchWithAuth } = useAuthFetch();
    const mapFn = (options?.mapItem ?? defaultMapItem) as (
      item: ConnectorEntity
    ) => TOption;
    const [labelMap, setLabelMap] = useState<Record<string, string>>({});
    // C2: track the owning connectorInstance name per entity id so callers
    // can render it in pickers without re-fetching.
    const [metaMap, setMetaMap] = useState<
      Record<string, Record<string, string>>
    >({});

    const searchMutation = useMutation<TOption[], ApiError, string>({
      mutationFn: async (query: string) => {
        const params: Record<string, string> = {
          include: "connectorInstance",
          ...options?.defaultParams,
        };
        if (query) params.search = query;
        const res = await fetchWithAuth<
          ApiSuccessResponse<ConnectorEntityListWithInstanceResponsePayload>
        >(buildUrl(CONNECTOR_ENTITIES_URL, params));
        const mapped = res.payload.connectorEntities.map((e) =>
          mapFn(e as ConnectorEntity)
        );
        setLabelMap((prev) => {
          const next = { ...prev };
          for (const opt of mapped) next[String(opt.value)] = opt.label;
          return next;
        });
        setMetaMap((prev) => {
          const next = { ...prev };
          for (const e of res.payload.connectorEntities) {
            const name = e.connectorInstance?.name;
            if (name) {
              next[e.id] = {
                ...(next[e.id] ?? {}),
                connectorInstanceName: name,
              };
            }
          }
          return next;
        });
        return mapped;
      },
    });

    const getByIdMutation = useMutation<TOption | null, ApiError, string>({
      mutationFn: async (id: string) => {
        const res = await fetchWithAuth<
          ApiSuccessResponse<ConnectorEntityGetResponsePayload>
        >(`${CONNECTOR_ENTITIES_URL}/${encodeURIComponent(id)}`);
        const option = mapFn(res.payload.connectorEntity);
        setLabelMap((prev) => ({
          ...prev,
          [String(option.value)]: option.label,
        }));
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
      metaMap,
    };
  },
};
