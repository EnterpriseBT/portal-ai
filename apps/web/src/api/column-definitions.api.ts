import { useState } from "react";

import {
  useMutation,
  useQuery,
  type QueryKey,
  type UseQueryResult,
} from "@tanstack/react-query";
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
import {
  useAuthQuery,
  useAuthMutation,
  useAuthFetch,
  type ApiError,
} from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions, SearchHookOptions, SearchResult } from "./types";

const COLUMN_DEFINITIONS_URL = "/api/column-definitions";

/**
 * #414: the catalog's natural order for a human picking from it.
 *
 * The pagination contract defaults to `sortBy: created` (`pagination.contract.ts`),
 * which ordered every picker chronologically — so the #316 geospatial definitions,
 * appended last to `SYSTEM_COLUMN_DEFINITIONS`, fell outside the default 20-row
 * window and read as missing. Alphabetical makes the window predictable instead of
 * an accident of insertion order. Overridable via `defaultParams`.
 */
const CATALOG_ORDER = { sortBy: "label", sortOrder: "asc" } as const;

/**
 * The server clamps `limit` to 100 (`PaginationRequestQuerySchema`), so a caller
 * asking for more is silently answered with less. `listAll` pages instead of
 * guessing; this is the per-request page size it uses.
 */
const CATALOG_PAGE_SIZE = 100;

/** Guard against an unbounded loop if `total` and the returned rows disagree. */
const CATALOG_MAX_PAGES = 50;

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

  /**
   * #414: the org's entire column-definition catalog, label-ordered.
   *
   * For the `columnDefinitionId → label` maps that render binding chips. Those
   * callers previously asked for `limit: 1000` and were silently answered with
   * 100, so a binding whose definition sorted past the cap rendered with no
   * label — and unlike a picker there is no user typing to recover the miss.
   *
   * Pages to exhaustion against the response's `total` rather than guessing a
   * limit. `useAuthQuery` takes a fixed URL and cannot loop, hence the local
   * `useQuery`; every request still goes through `fetchWithAuth`.
   */
  listAll: (
    options?: QueryOptions<ColumnDefinitionListResponsePayload>
  ): UseQueryResult<ColumnDefinitionListResponsePayload, ApiError> => {
    const { fetchWithAuth } = useAuthFetch();

    return useQuery<
      ColumnDefinitionListResponsePayload,
      ApiError,
      ColumnDefinitionListResponsePayload,
      QueryKey
    >({
      queryKey: queryKeys.columnDefinitions.listAll(),
      queryFn: async () => {
        const collected: ColumnDefinition[] = [];
        let total = 0;
        let limit = CATALOG_PAGE_SIZE;
        let offset = 0;

        for (let page = 0; page < CATALOG_MAX_PAGES; page++) {
          const res = await fetchWithAuth<
            ApiSuccessResponse<ColumnDefinitionListResponsePayload>
          >(
            buildUrl(COLUMN_DEFINITIONS_URL, {
              ...CATALOG_ORDER,
              limit: CATALOG_PAGE_SIZE,
              offset,
            })
          );

          collected.push(...res.payload.columnDefinitions);
          total = res.payload.total;
          // Echoed back post-clamp, so this is the page size actually served.
          limit = res.payload.limit;

          // Stop on a short page as well as on the count: a page shorter than
          // the served limit means the server has nothing left, and trusting
          // that too is what keeps a stale `total` from spinning the loop.
          if (
            collected.length >= total ||
            res.payload.columnDefinitions.length < limit
          ) {
            break;
          }
          offset += limit;
        }

        return { columnDefinitions: collected, total, limit, offset };
      },
      ...options,
    });
  },

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
    useAuthMutation<
      ColumnDefinitionCreateResponsePayload,
      ColumnDefinitionCreateRequestBody
    >({
      url: COLUMN_DEFINITIONS_URL,
      method: "POST",
    }),

  update: (id: string) =>
    useAuthMutation<
      ColumnDefinitionUpdateResponsePayload,
      ColumnDefinitionUpdateRequestBody
    >({
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
    const mapFn = (options?.mapItem ?? defaultMapItem) as (
      item: ColumnDefinition
    ) => TOption;
    const [labelMap, setLabelMap] = useState<Record<string, string>>({});

    const searchMutation = useMutation<TOption[], ApiError, string>({
      mutationFn: async (query: string) => {
        const params: Record<string, string> = {
          ...CATALOG_ORDER,
          ...options?.defaultParams,
        };
        if (query) params.search = query;
        const res = await fetchWithAuth<
          ApiSuccessResponse<ColumnDefinitionListResponsePayload>
        >(buildUrl(COLUMN_DEFINITIONS_URL, params));
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
        const res = await fetchWithAuth<
          ApiSuccessResponse<ColumnDefinitionGetResponsePayload>
        >(`${COLUMN_DEFINITIONS_URL}/${encodeURIComponent(id)}`);
        const option = mapFn(res.payload.columnDefinition);
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
    };
  },
};
