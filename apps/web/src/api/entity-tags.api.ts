import type {
  EntityTagCreateRequestBody,
  EntityTagCreateResponsePayload,
  EntityTagGetResponsePayload,
  EntityTagListRequestQuery,
  EntityTagListResponsePayload,
  EntityTagUpdateRequestBody,
  EntityTagUpdateResponsePayload,
  EntityTagAssignmentCreateRequestBody,
  EntityTagAssignmentCreateResponsePayload,
  EntityTagAssignmentListResponsePayload,
} from "@portalai/core/contracts";
import { useInfiniteFilterOptions } from "@portalai/core/ui";
import type { InfiniteFilterOptionsConfig } from "@portalai/core/ui";

import { useAuthFetch, useAuthMutation, useAuthQuery } from "../utils/api.util";
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

const entityTagAssignmentUrl = (connectorEntityId: string) =>
  `/api/connector-entities/${encodeURIComponent(connectorEntityId)}/tags`;

export const entityTagAssignments = {
  listByEntity: (
    connectorEntityId: string,
    options?: QueryOptions<EntityTagAssignmentListResponsePayload>
  ) =>
    useAuthQuery<EntityTagAssignmentListResponsePayload>(
      queryKeys.entityTagAssignments.listByEntity(connectorEntityId),
      buildUrl(entityTagAssignmentUrl(connectorEntityId)),
      undefined,
      options
    ),

  assign: (connectorEntityId: string) =>
    useAuthMutation<
      EntityTagAssignmentCreateResponsePayload,
      EntityTagAssignmentCreateRequestBody
    >({
      url: entityTagAssignmentUrl(connectorEntityId),
      method: "POST",
    }),

  remove: (connectorEntityId: string, assignmentId: string) =>
    useAuthMutation<void, void>({
      url: `${entityTagAssignmentUrl(connectorEntityId)}/${encodeURIComponent(assignmentId)}`,
      method: "DELETE",
    }),
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
