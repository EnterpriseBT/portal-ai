import type {
  EntityGroupCreateRequestBody,
  EntityGroupCreateResponsePayload,
  EntityGroupGetResponsePayload,
  EntityGroupListRequestQuery,
  EntityGroupListResponsePayload,
  EntityGroupUpdateRequestBody,
  EntityGroupUpdateResponsePayload,
  EntityGroupMemberCreateRequestBody,
  EntityGroupMemberCreateResponsePayload,
  EntityGroupMemberUpdateRequestBody,
  EntityGroupMemberUpdateResponsePayload,
  EntityGroupMemberOverlapRequestQuery,
  EntityGroupMemberOverlapResponsePayload,
  EntityGroupResolveRequestQuery,
  EntityGroupResolveResponsePayload,
} from "@portalai/core/contracts";
import { useAuthMutation, useAuthQuery } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

export const ENTITY_GROUPS_URL = "/api/entity-groups";

export const entityGroups = {
  list: (
    params?: EntityGroupListRequestQuery,
    options?: QueryOptions<EntityGroupListResponsePayload>
  ) =>
    useAuthQuery<EntityGroupListResponsePayload>(
      queryKeys.entityGroups.list(params),
      buildUrl(ENTITY_GROUPS_URL, params),
      undefined,
      options
    ),

  get: (id: string, options?: QueryOptions<EntityGroupGetResponsePayload>) =>
    useAuthQuery<EntityGroupGetResponsePayload>(
      queryKeys.entityGroups.get(id),
      buildUrl(`${ENTITY_GROUPS_URL}/${encodeURIComponent(id)}`),
      undefined,
      options
    ),

  create: () =>
    useAuthMutation<
      EntityGroupCreateResponsePayload,
      EntityGroupCreateRequestBody
    >({
      url: ENTITY_GROUPS_URL,
      method: "POST",
    }),

  update: (id: string) =>
    useAuthMutation<
      EntityGroupUpdateResponsePayload,
      EntityGroupUpdateRequestBody
    >({
      url: `${ENTITY_GROUPS_URL}/${encodeURIComponent(id)}`,
      method: "PATCH",
    }),

  delete: (id: string) =>
    useAuthMutation<void, void>({
      url: `${ENTITY_GROUPS_URL}/${encodeURIComponent(id)}`,
      method: "DELETE",
    }),

  addMember: (groupId: string) =>
    useAuthMutation<
      EntityGroupMemberCreateResponsePayload,
      EntityGroupMemberCreateRequestBody
    >({
      url: `${ENTITY_GROUPS_URL}/${encodeURIComponent(groupId)}/members`,
      method: "POST",
    }),

  updateMember: (groupId: string, memberId: string) =>
    useAuthMutation<
      EntityGroupMemberUpdateResponsePayload,
      EntityGroupMemberUpdateRequestBody
    >({
      url: `${ENTITY_GROUPS_URL}/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}`,
      method: "PATCH",
    }),

  removeMember: (groupId: string, memberId: string) =>
    useAuthMutation<void, void>({
      url: `${ENTITY_GROUPS_URL}/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}`,
      method: "DELETE",
    }),

  memberOverlap: (
    groupId: string,
    params?: EntityGroupMemberOverlapRequestQuery,
    options?: QueryOptions<EntityGroupMemberOverlapResponsePayload>
  ) =>
    useAuthQuery<EntityGroupMemberOverlapResponsePayload>(
      queryKeys.entityGroups.memberOverlap(groupId, params),
      buildUrl(
        `${ENTITY_GROUPS_URL}/${encodeURIComponent(groupId)}/members/overlap`,
        params
      ),
      undefined,
      options
    ),

  resolve: (
    groupId: string,
    params?: EntityGroupResolveRequestQuery,
    options?: QueryOptions<EntityGroupResolveResponsePayload>
  ) =>
    useAuthQuery<EntityGroupResolveResponsePayload>(
      queryKeys.entityGroups.resolve(groupId, params),
      buildUrl(
        `${ENTITY_GROUPS_URL}/${encodeURIComponent(groupId)}/resolve`,
        params
      ),
      undefined,
      options
    ),
};
