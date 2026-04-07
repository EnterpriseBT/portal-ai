import React, { useMemo } from "react";

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
import type { AsyncFilterOptionsConfig } from "@portalai/core/ui";
import { useAuthQuery, useAuthMutation, useAuthFetch } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

const COLUMN_DEFINITION_SEARCH_BASE = {
  url: "/api/column-definitions",
  getItems: (res: ApiSuccessResponse<ColumnDefinitionListResponsePayload>) =>
    res.payload.columnDefinitions,
  mapItem: (cd: ColumnDefinition) => ({
    value: cd.id,
    label: cd.label,
  }),
} as const;

export function useColumnDefinitionSearch(options?: {
  defaultParams?: Record<string, string>;
}) {
  const { fetchWithAuth } = useAuthFetch();

  const config = useMemo<
    AsyncFilterOptionsConfig<
      ApiSuccessResponse<ColumnDefinitionListResponsePayload>,
      ColumnDefinition
    >
  >(
    () => ({
      ...COLUMN_DEFINITION_SEARCH_BASE,
      fetcher: fetchWithAuth,
      ...(options?.defaultParams && { defaultParams: options.defaultParams }),
    }),
    [fetchWithAuth, options]
  );

  return useAsyncFilterOptions(config);
}

/**
 * Search hook that returns options keyed by `key` (not `id`) and exposes a
 * lookup map of full column definitions so callers can pre-fill fields.
 */
export function useColumnDefinitionKeySearch() {
  const { fetchWithAuth } = useAuthFetch();
  const [defsByKey, setDefsByKey] = React.useState<Record<string, ColumnDefinition>>({});

  const onSearch = React.useCallback(
    async (query: string) => {
      const params: Record<string, string> = {};
      if (query) params.search = query;
      const url = `/api/column-definitions?${new URLSearchParams(params).toString()}`;
      const data = (await fetchWithAuth(url)) as ApiSuccessResponse<ColumnDefinitionListResponsePayload>;
      const defs = data.payload.columnDefinitions;

      setDefsByKey((prev) => {
        const next = { ...prev };
        for (const cd of defs) {
          next[cd.key] = cd;
        }
        return next;
      });

      return defs.map((cd) => ({
        value: cd.key,
        label: `${cd.label} (${cd.key}) — ${cd.type}${cd.description ? ` · ${cd.description}` : ""}`,
      }));
    },
    [fetchWithAuth],
  );

  return { onSearch, defsByKey };
}

export const columnDefinitions = {
  list: (
    params?: ColumnDefinitionListRequestQuery,
    options?: QueryOptions<ColumnDefinitionListResponsePayload>
  ) =>
    useAuthQuery<ColumnDefinitionListResponsePayload>(
      queryKeys.columnDefinitions.list(params),
      buildUrl("/api/column-definitions", params),
      undefined,
      options
    ),

  get: (
    id: string,
    options?: QueryOptions<ColumnDefinitionGetResponsePayload>
  ) =>
    useAuthQuery<ColumnDefinitionGetResponsePayload>(
      queryKeys.columnDefinitions.get(id),
      buildUrl(`/api/column-definitions/${encodeURIComponent(id)}`),
      undefined,
      options
    ),

  impact: (
    id: string,
    options?: QueryOptions<ColumnDefinitionImpactResponsePayload>
  ) =>
    useAuthQuery<ColumnDefinitionImpactResponsePayload>(
      queryKeys.columnDefinitions.impact(id),
      buildUrl(`/api/column-definitions/${encodeURIComponent(id)}/impact`),
      undefined,
      options
    ),

  create: () =>
    useAuthMutation<ColumnDefinitionCreateResponsePayload, ColumnDefinitionCreateRequestBody>({
      url: "/api/column-definitions",
      method: "POST",
    }),

  update: (id: string) =>
    useAuthMutation<ColumnDefinitionUpdateResponsePayload, ColumnDefinitionUpdateRequestBody>({
      url: `/api/column-definitions/${encodeURIComponent(id)}`,
      method: "PATCH",
    }),

  delete: (id: string) =>
    useAuthMutation<void, void>({
      url: `/api/column-definitions/${encodeURIComponent(id)}`,
      method: "DELETE",
    }),
};
