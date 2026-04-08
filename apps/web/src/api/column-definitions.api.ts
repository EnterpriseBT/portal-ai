import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
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
import type { SelectOption } from "@portalai/core/ui";
import { useAuthQuery, useAuthMutation, useAuthFetch, type ApiError } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions, SearchHookOptions, SearchResult } from "./types";

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
  ): SearchResult<TOption> => {
    const { fetchWithAuth } = useAuthFetch();
    const mapFn = (options?.mapItem ?? defaultMapItem) as (item: ColumnDefinition) => TOption;
    const [labelMap, setLabelMap] = useState<Record<string, string>>({});

    const searchMutation = useMutation<TOption[], ApiError, string>({
      mutationFn: async (query: string) => {
        const params: Record<string, string> = { ...options?.defaultParams };
        if (query) params.search = query;
        const res = await fetchWithAuth<ApiSuccessResponse<ColumnDefinitionListResponsePayload>>(
          buildUrl(COLUMN_DEFINITIONS_URL, params)
        );
        const mapped = res.payload.columnDefinitions.map(mapFn);
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
        const res = await fetchWithAuth<ApiSuccessResponse<ColumnDefinitionGetResponsePayload>>(
          `${COLUMN_DEFINITIONS_URL}/${encodeURIComponent(id)}`
        );
        const option = mapFn(res.payload.columnDefinition);
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
};
