import { useMemo } from "react";

import type {
  ApiSuccessResponse,
  ConnectorEntityCreateRequestBody,
  ConnectorEntityCreateResponsePayload,
  ConnectorEntityGetResponsePayload,
  ConnectorEntityImpactResponsePayload,
  ConnectorEntityListRequestQuery,
  ConnectorEntityListResponsePayload,
  ConnectorEntityListWithMappingsResponsePayload,
  ConnectorEntityPatchRequestBody,
  ConnectorEntityPatchResponsePayload,
} from "@portalai/core/contracts";
import type { ConnectorEntity } from "@portalai/core/models";
import { useAsyncFilterOptions } from "@portalai/core/ui";
import type { AsyncFilterOptionsConfig } from "@portalai/core/ui";
import { useAuthQuery, useAuthMutation, useAuthFetch } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

const CONNECTOR_ENTITY_SEARCH_BASE = {
  url: "/api/connector-entities",
  getItems: (res: ApiSuccessResponse<ConnectorEntityListResponsePayload>) =>
    res.payload.connectorEntities,
  mapItem: (entity: ConnectorEntity) => ({
    value: entity.id,
    label: entity.label,
  }),
} as const;

export function useConnectorEntitySearch(options?: {
  mapItem?: (entity: ConnectorEntity) => { value: string; label: string };
  defaultParams?: Record<string, string>;
}) {
  const { fetchWithAuth } = useAuthFetch();

  const config = useMemo<
    AsyncFilterOptionsConfig<
      ApiSuccessResponse<ConnectorEntityListResponsePayload>,
      ConnectorEntity
    >
  >(
    () => ({
      ...CONNECTOR_ENTITY_SEARCH_BASE,
      fetcher: fetchWithAuth,
      ...(options?.mapItem && { mapItem: options.mapItem }),
      ...(options?.defaultParams && { defaultParams: options.defaultParams }),
    }),
    [fetchWithAuth, options]
  );

  return useAsyncFilterOptions(config);
}

export const connectorEntities = {
  list: (
    params?: ConnectorEntityListRequestQuery,
    options?: QueryOptions<ConnectorEntityListResponsePayload | ConnectorEntityListWithMappingsResponsePayload>
  ) =>
    useAuthQuery<ConnectorEntityListResponsePayload | ConnectorEntityListWithMappingsResponsePayload>(
      queryKeys.connectorEntities.list(params),
      buildUrl("/api/connector-entities", params),
      undefined,
      options
    ),

  get: (
    id: string,
    options?: QueryOptions<ConnectorEntityGetResponsePayload>
  ) =>
    useAuthQuery<ConnectorEntityGetResponsePayload>(
      queryKeys.connectorEntities.get(id),
      buildUrl(`/api/connector-entities/${encodeURIComponent(id)}`),
      undefined,
      options
    ),

  impact: (
    id: string,
    options?: QueryOptions<ConnectorEntityImpactResponsePayload>
  ) =>
    useAuthQuery<ConnectorEntityImpactResponsePayload>(
      queryKeys.connectorEntities.impact(id),
      buildUrl(`/api/connector-entities/${encodeURIComponent(id)}/impact`),
      undefined,
      options
    ),

  update: (id: string) =>
    useAuthMutation<ConnectorEntityPatchResponsePayload, ConnectorEntityPatchRequestBody>({
      url: `/api/connector-entities/${encodeURIComponent(id)}`,
      method: "PATCH",
    }),

  create: () =>
    useAuthMutation<ConnectorEntityCreateResponsePayload, ConnectorEntityCreateRequestBody>({
      url: "/api/connector-entities",
      method: "POST",
    }),

  delete: (id: string) =>
    useAuthMutation<void, void>({
      url: `/api/connector-entities/${encodeURIComponent(id)}`,
      method: "DELETE",
    }),
};
