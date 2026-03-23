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
import { useInfiniteFilterOptions } from "@portalai/core/ui";
import type { InfiniteFilterOptionsConfig } from "@portalai/core/ui";
import { useAuthMutation, useAuthQuery, useAuthFetch } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";
import { EntityTag } from "@portalai/core/models";

export const ENTITY_TAGS_URL = "/api/entity-tags";

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
    useAuthMutation<EntityTagCreateResponsePayload, EntityTagCreateRequestBody>(
      {
        url: ENTITY_TAGS_URL,
        method: "POST",
      }
    ),

  update: (id: string) =>
    useAuthMutation<EntityTagUpdateResponsePayload, EntityTagUpdateRequestBody>(
      {
        url: `${ENTITY_TAGS_URL}/${encodeURIComponent(id)}`,
        method: "PATCH",
      }
    ),

  delete: (id: string) =>
    useAuthMutation<void, void>({
      url: `${ENTITY_TAGS_URL}/${encodeURIComponent(id)}`,
      method: "DELETE",
    }),
};


const ENTITY_TAG_FILTER_BASE = {
  url: ENTITY_TAGS_URL,
  getItems: (res: ApiSuccessResponse<EntityTagListResponsePayload>) => res.payload.entityTags,
  getTotal: (res: ApiSuccessResponse<EntityTagListResponsePayload>) => res.payload.total,
  mapItem: (tag: EntityTag) => ({
    value: tag.id,
    label: tag.name,
  }),
  sortBy: "name",
} as const;

export function useEntityTagFilter() {
  const { fetchWithAuth } = useAuthFetch();

  const config: InfiniteFilterOptionsConfig<
    ApiSuccessResponse<EntityTagListResponsePayload>,
    EntityTag
  > = {
    ...ENTITY_TAG_FILTER_BASE,
    fetcher: fetchWithAuth
  };

  return useInfiniteFilterOptions(config);
}
