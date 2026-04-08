import { useMemo } from "react";

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
import { useAsyncFilterOptions, useInfiniteFilterOptions } from "@portalai/core/ui";
import type { InfiniteFilterOptionsConfig, SelectOption } from "@portalai/core/ui";
import { useAuthMutation, useAuthQuery, useAuthFetch } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions, SearchHookOptions } from "./types";

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
  ) => {
    const { fetchWithAuth } = useAuthFetch();
    const mapFn = (options?.mapItem ?? defaultMapItem) as (item: EntityTag) => TOption;

    const config = useMemo(
      () => ({
        url: ENTITY_TAGS_URL,
        fetcher: fetchWithAuth,
        getItems: (res: ApiSuccessResponse<EntityTagListResponsePayload>) =>
          res.payload.entityTags,
        mapItem: mapFn,
        defaultParams: options?.defaultParams,
        loadSelectedOption: async (id: string): Promise<TOption | null> => {
          const res = (await fetchWithAuth(
            `${ENTITY_TAGS_URL}/${encodeURIComponent(id)}`
          )) as ApiSuccessResponse<EntityTagGetResponsePayload>;
          return mapFn(res.payload.entityTag);
        },
      }),
      [fetchWithAuth, mapFn, options?.defaultParams]
    );

    const { loadSelectedOption, ...rest } = useAsyncFilterOptions<
      ApiSuccessResponse<EntityTagListResponsePayload>,
      EntityTag,
      TOption
    >(config);
    return { ...rest, getById: loadSelectedOption };
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
