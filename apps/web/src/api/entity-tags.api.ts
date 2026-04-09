import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import type {
  ApiSuccessResponse,
  EntityTagCreateRequestBody,
  EntityTagCreateResponsePayload,
  EntityTagGetResponsePayload,
  EntityTagListRequestQuery,
  EntityTagListResponsePayload,
  EntityTagUpdateRequestBody,
  EntityTagUpdateResponsePayload,
} from "@portalai/core/contracts";
import type { EntityTag } from "@portalai/core/models";
import { useInfiniteFilterOptions } from "@portalai/core/ui";
import type { InfiniteFilterOptionsConfig, SelectOption } from "@portalai/core/ui";
import { useAuthMutation, useAuthQuery, useAuthFetch, type ApiError } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions, SearchHookOptions, SearchResult } from "./types";

const ENTITY_TAGS_URL = "/api/entity-tags";

const defaultMapItem = (tag: EntityTag): SelectOption => ({
  value: tag.id,
  label: tag.name,
});

const ENTITY_TAG_FILTER_BASE = {
  url: ENTITY_TAGS_URL,
  getItems: (res: ApiSuccessResponse<EntityTagListResponsePayload>) => res.payload.entityTags,
  getTotal: (res: ApiSuccessResponse<EntityTagListResponsePayload>) => res.payload.total,
  mapItem: (tag: EntityTag) => ({ value: tag.id, label: tag.name }),
  sortBy: "name",
} as const;

export const entityTags = {
  list: (
    params?: EntityTagListRequestQuery,
    options?: QueryOptions<EntityTagListResponsePayload>
  ) =>
    useAuthQuery<EntityTagListResponsePayload>(
      queryKeys.entityTags.list(params),
      buildUrl(ENTITY_TAGS_URL, params),
      undefined,
      options
    ),

  get: (id: string, options?: QueryOptions<EntityTagGetResponsePayload>) =>
    useAuthQuery<EntityTagGetResponsePayload>(
      queryKeys.entityTags.get(id),
      buildUrl(`${ENTITY_TAGS_URL}/${encodeURIComponent(id)}`),
      undefined,
      options
    ),

  create: () =>
    useAuthMutation<EntityTagCreateResponsePayload, EntityTagCreateRequestBody>({
      url: ENTITY_TAGS_URL,
      method: "POST",
    }),

  update: (id: string) =>
    useAuthMutation<EntityTagUpdateResponsePayload, EntityTagUpdateRequestBody>({
      url: `${ENTITY_TAGS_URL}/${encodeURIComponent(id)}`,
      method: "PATCH",
    }),

  delete: (id: string) =>
    useAuthMutation<void, void>({
      url: `${ENTITY_TAGS_URL}/${encodeURIComponent(id)}`,
      method: "DELETE",
    }),

  search: <TOption extends SelectOption = SelectOption>(
    options?: SearchHookOptions<EntityTag, TOption>
  ): SearchResult<TOption> => {
    const { fetchWithAuth } = useAuthFetch();
    const mapFn = (options?.mapItem ?? defaultMapItem) as (item: EntityTag) => TOption;
    const [labelMap, setLabelMap] = useState<Record<string, string>>({});

    const searchMutation = useMutation<TOption[], ApiError, string>({
      mutationFn: async (query: string) => {
        const params: Record<string, string> = { ...options?.defaultParams };
        if (query) params.search = query;
        const res = await fetchWithAuth<ApiSuccessResponse<EntityTagListResponsePayload>>(
          buildUrl(ENTITY_TAGS_URL, params)
        );
        const mapped = res.payload.entityTags.map(mapFn);
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
        const res = await fetchWithAuth<ApiSuccessResponse<EntityTagGetResponsePayload>>(
          `${ENTITY_TAGS_URL}/${encodeURIComponent(id)}`
        );
        const option = mapFn(res.payload.entityTag);
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
      ApiSuccessResponse<EntityTagListResponsePayload>,
      EntityTag
    > = {
      ...ENTITY_TAG_FILTER_BASE,
      fetcher: fetchWithAuth,
    };

    return useInfiniteFilterOptions(config);
  },
};
