import type {
  EntityGroupCreateRequestBody,
  EntityGroupCreateResponsePayload,
  EntityGroupGetResponsePayload,
  EntityGroupImpactResponsePayload,
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
import { omit } from "lodash-es";

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

  listByEntity: (
    connectorEntityId: string,
    options?: QueryOptions<EntityGroupListResponsePayload>
  ) =>
    useAuthQuery<EntityGroupListResponsePayload>(
      queryKeys.entityGroups.listByEntity(connectorEntityId),
      buildUrl(ENTITY_GROUPS_URL, { connectorEntityId }),
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

  impact: (
    id: string,
    options?: QueryOptions<EntityGroupImpactResponsePayload>
  ) =>
    useAuthQuery<EntityGroupImpactResponsePayload>(
      queryKeys.entityGroups.impact(id),
      buildUrl(`${ENTITY_GROUPS_URL}/${encodeURIComponent(id)}/impact`),
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
      // #689: a 403 means the caller's capabilities on the group changed;
      // refetch so the page's gates re-render from them.
      onPermissionDenied: { invalidate: () => [queryKeys.entityGroups.root] },
    }),

  update: (id: string) =>
    useAuthMutation<
      EntityGroupUpdateResponsePayload,
      EntityGroupUpdateRequestBody
    >({
      url: `${ENTITY_GROUPS_URL}/${encodeURIComponent(id)}`,
      method: "PATCH",
      onPermissionDenied: { invalidate: () => [queryKeys.entityGroups.root] },
    }),

  delete: (id: string) =>
    useAuthMutation<void, void>({
      url: `${ENTITY_GROUPS_URL}/${encodeURIComponent(id)}`,
      method: "DELETE",
      onPermissionDenied: { invalidate: () => [queryKeys.entityGroups.root] },
    }),

  addMember: (groupId: string) =>
    useAuthMutation<
      EntityGroupMemberCreateResponsePayload,
      EntityGroupMemberCreateRequestBody
    >({
      url: `${ENTITY_GROUPS_URL}/${encodeURIComponent(groupId)}/members`,
      method: "POST",
      onPermissionDenied: { invalidate: () => [queryKeys.entityGroups.root] },
    }),

  /** The member is a mutation variable, so one hook serves every row. */
  updateMember: (groupId: string) =>
    useAuthMutation<
      EntityGroupMemberUpdateResponsePayload,
      EntityGroupMemberUpdateRequestBody & { memberId: string }
    >({
      url: ({ memberId }) =>
        `${ENTITY_GROUPS_URL}/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}`,
      method: "PATCH",
      body: (vars) => omit(vars, "memberId"),
      onPermissionDenied: { invalidate: () => [queryKeys.entityGroups.root] },
    }),

  removeMember: (groupId: string) =>
    useAuthMutation<void, { memberId: string }>({
      url: ({ memberId }) =>
        `${ENTITY_GROUPS_URL}/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}`,
      method: "DELETE",
      body: () => undefined,
      onPermissionDenied: { invalidate: () => [queryKeys.entityGroups.root] },
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
