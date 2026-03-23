import type {
  EntityTagListRequestQuery,
  EntityTagListResponsePayload,
} from "@portalai/core/contracts";
import { useInfiniteFilterOptions } from "@portalai/core/ui";
import type { InfiniteFilterOptionsConfig } from "@portalai/core/ui";

import { useAuthFetch, useAuthQuery } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

const ENTITY_TAGS_URL = "/api/entity-tags";

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
};

const ENTITY_TAG_FILTER_BASE = {
  url: ENTITY_TAGS_URL,
  getItems: (res: EntityTagListResponsePayload) => res.entityTags,
  getTotal: (res: EntityTagListResponsePayload) => res.total,
  mapItem: (tag: EntityTagListResponsePayload["entityTags"][number]) => ({
    value: tag.id,
    label: tag.name,
  }),
  sortBy: "name",
} as const;

export function useEntityTagFilter() {
  const { fetchWithAuth } = useAuthFetch();

  const config: InfiniteFilterOptionsConfig<
    EntityTagListResponsePayload,
    EntityTagListResponsePayload["entityTags"][number]
  > = {
    ...ENTITY_TAG_FILTER_BASE,
    fetcher: fetchWithAuth,
  };

  return useInfiniteFilterOptions(config);
}
