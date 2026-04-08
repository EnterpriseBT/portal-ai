import { useMemo } from "react";

import type {
  ApiSuccessResponse,
  ColumnDefinitionCreateRequestBody,
  ColumnDefinitionCreateResponsePayload,
  ColumnDefinitionGetResponsePayload,
  ColumnDefinitionImpactResponsePayload,
  ColumnDefinitionListRequestQuery,
  ColumnDefinitionListResponsePayload,
  ColumnDefinitionUpdateRequestBody,
  ColumnDefinitionUpdateResponsePayload,
} from "@portalai/core/contracts";
import type { ColumnDefinition } from "@portalai/core/models";
import { useAsyncFilterOptions } from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";
import { useAuthQuery, useAuthMutation, useAuthFetch } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions, SearchHookOptions } from "./types";

const COLUMN_DEFINITIONS_URL = "/api/column-definitions";

const defaultMapItem = (cd: ColumnDefinition): SelectOption => ({
  value: cd.id,
  label: cd.label,
});

export const columnDefinitions = {
  list: (
    params?: ColumnDefinitionListRequestQuery,
    options?: QueryOptions<ColumnDefinitionListResponsePayload>
  ) =>
    useAuthQuery<ColumnDefinitionListResponsePayload>(
      queryKeys.columnDefinitions.list(params),
      buildUrl(COLUMN_DEFINITIONS_URL, params),
      undefined,
      options
    ),

  get: (
    id: string,
    options?: QueryOptions<ColumnDefinitionGetResponsePayload>
  ) =>
    useAuthQuery<ColumnDefinitionGetResponsePayload>(
      queryKeys.columnDefinitions.get(id),
      buildUrl(`${COLUMN_DEFINITIONS_URL}/${encodeURIComponent(id)}`),
      undefined,
      options
    ),

  impact: (
    id: string,
    options?: QueryOptions<ColumnDefinitionImpactResponsePayload>
  ) =>
    useAuthQuery<ColumnDefinitionImpactResponsePayload>(
      queryKeys.columnDefinitions.impact(id),
      buildUrl(`${COLUMN_DEFINITIONS_URL}/${encodeURIComponent(id)}/impact`),
      undefined,
      options
    ),

  create: () =>
    useAuthMutation<ColumnDefinitionCreateResponsePayload, ColumnDefinitionCreateRequestBody>({
      url: COLUMN_DEFINITIONS_URL,
      method: "POST",
    }),

  update: (id: string) =>
    useAuthMutation<ColumnDefinitionUpdateResponsePayload, ColumnDefinitionUpdateRequestBody>({
      url: `${COLUMN_DEFINITIONS_URL}/${encodeURIComponent(id)}`,
      method: "PATCH",
    }),

  delete: (id: string) =>
    useAuthMutation<void, void>({
      url: `${COLUMN_DEFINITIONS_URL}/${encodeURIComponent(id)}`,
      method: "DELETE",
    }),

  search: <TOption extends SelectOption = SelectOption>(
    options?: SearchHookOptions<ColumnDefinition, TOption>
  ) => {
    const { fetchWithAuth } = useAuthFetch();
    const mapFn = (options?.mapItem ?? defaultMapItem) as (item: ColumnDefinition) => TOption;

    const config = useMemo(
      () => ({
        url: COLUMN_DEFINITIONS_URL,
        fetcher: fetchWithAuth,
        getItems: (res: ApiSuccessResponse<ColumnDefinitionListResponsePayload>) =>
          res.payload.columnDefinitions,
        mapItem: mapFn,
        defaultParams: options?.defaultParams,
        loadSelectedOption: async (id: string): Promise<TOption | null> => {
          const res = (await fetchWithAuth(
            `${COLUMN_DEFINITIONS_URL}/${encodeURIComponent(id)}`
          )) as ApiSuccessResponse<ColumnDefinitionGetResponsePayload>;
          return mapFn(res.payload.columnDefinition);
        },
      }),
      [fetchWithAuth, mapFn, options?.defaultParams]
    );

    const { loadSelectedOption, ...rest } = useAsyncFilterOptions<
      ApiSuccessResponse<ColumnDefinitionListResponsePayload>,
      ColumnDefinition,
      TOption
    >(config);
    return { ...rest, getById: loadSelectedOption };
  },
};
