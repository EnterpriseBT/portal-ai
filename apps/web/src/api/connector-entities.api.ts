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
import type { SelectOption } from "@portalai/core/ui";
import { useAuthQuery, useAuthMutation, useAuthFetch } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions, SearchHookOptions } from "./types";

const CONNECTOR_ENTITIES_URL = "/api/connector-entities";

const defaultMapItem = (entity: ConnectorEntity): SelectOption => ({
  value: entity.id,
  label: entity.label,
});

export const connectorEntities = {
  list: (
    params?: ConnectorEntityListRequestQuery,
    options?: QueryOptions<ConnectorEntityListResponsePayload | ConnectorEntityListWithMappingsResponsePayload>
  ) =>
    useAuthQuery<ConnectorEntityListResponsePayload | ConnectorEntityListWithMappingsResponsePayload>(
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
    useAuthMutation<ConnectorEntityPatchResponsePayload, ConnectorEntityPatchRequestBody>({
      url: `${CONNECTOR_ENTITIES_URL}/${encodeURIComponent(id)}`,
      method: "PATCH",
    }),

  create: () =>
    useAuthMutation<ConnectorEntityCreateResponsePayload, ConnectorEntityCreateRequestBody>({
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
  ) => {
    const { fetchWithAuth } = useAuthFetch();
    const mapFn = (options?.mapItem ?? defaultMapItem) as (item: ConnectorEntity) => TOption;

    const config = useMemo(
      () => ({
        url: CONNECTOR_ENTITIES_URL,
        fetcher: fetchWithAuth,
        getItems: (res: ApiSuccessResponse<ConnectorEntityListResponsePayload>) =>
          res.payload.connectorEntities,
        mapItem: mapFn,
        defaultParams: options?.defaultParams,
        loadSelectedOption: async (id: string): Promise<TOption | null> => {
          const res = (await fetchWithAuth(
            `${CONNECTOR_ENTITIES_URL}/${encodeURIComponent(id)}`
          )) as ApiSuccessResponse<ConnectorEntityGetResponsePayload>;
          return mapFn(res.payload.connectorEntity);
        },
      }),
      [fetchWithAuth, mapFn, options?.defaultParams]
    );

    const { loadSelectedOption, ...rest } = useAsyncFilterOptions<
      ApiSuccessResponse<ConnectorEntityListResponsePayload>,
      ConnectorEntity,
      TOption
    >(config);
    return { ...rest, getById: loadSelectedOption };
  },
};
