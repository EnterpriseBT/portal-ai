import type {
  GroupUpsertRequest,
  GroupResponse,
  GroupListResponse,
  GroupMembersSetRequest,
  GroupMembersResponse,
} from "@portalai/core/contracts";
import { useAuthQuery, useAuthMutation } from "../utils/api.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

/**
 * RBAC group authoring (#622) — `sdk.groups`. A group bundles policies (server
 * boundary-checks the union) and has members. Owner/admin + `customRbac` only.
 */
export const groups = {
  list: (options?: QueryOptions<GroupListResponse>) =>
    useAuthQuery<GroupListResponse>(
      queryKeys.groups.root,
      "/api/groups",
      undefined,
      options
    ),

  /** A group's member ids (#637) — fetched only when the editor opens one group
   *  (never on the list). Gated by the normal members-read permission. */
  members: (id: string, options?: QueryOptions<GroupMembersResponse>) =>
    useAuthQuery<GroupMembersResponse>(
      queryKeys.groups.members(id),
      `/api/groups/${encodeURIComponent(id)}/members`,
      undefined,
      options
    ),

  create: () =>
    useAuthMutation<GroupResponse, GroupUpsertRequest>({
      url: "/api/groups",
      method: "POST",
    }),

  update: (id: string) =>
    useAuthMutation<GroupResponse, GroupUpsertRequest>({
      url: `/api/groups/${encodeURIComponent(id)}`,
      method: "PUT",
    }),

  remove: () =>
    useAuthMutation<{ id: string }, { id: string }>({
      url: (v) => `/api/groups/${encodeURIComponent(v.id)}`,
      method: "DELETE",
      body: () => undefined,
    }),

  /** Set a group's membership (group-centric). The group id rides in the
   *  variables so one handle serves both the create (fresh id) + edit paths. */
  setMembers: () =>
    useAuthMutation<GroupResponse, { id: string } & GroupMembersSetRequest>({
      url: (v) => `/api/groups/${encodeURIComponent(v.id)}/members`,
      method: "PUT",
      body: (v) => ({ userIds: v.userIds }),
    }),
};
