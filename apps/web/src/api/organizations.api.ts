import type {
  OrganizationGetResponse,
  OrganizationUsageGetResponse,
  UserMembershipsGetResponse,
  OrganizationSwitchRequest,
  OrganizationDeleteRequest,
  OrganizationDeleteResponse,
} from "@portalai/core/contracts";
import { useAuthQuery, useAuthMutation } from "../utils/api.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

export const organizations = {
  current: (options?: QueryOptions<OrganizationGetResponse>) =>
    useAuthQuery<OrganizationGetResponse>(
      queryKeys.organizations.current(),
      "/api/organization/current",
      undefined,
      options
    ),
  usage: (options?: QueryOptions<OrganizationUsageGetResponse>) =>
    useAuthQuery<OrganizationUsageGetResponse>(
      queryKeys.organizations.usage(),
      "/api/organization/usage",
      undefined,
      options
    ),
  /** The authed user's org memberships — the org switcher's data source. */
  memberships: (options?: QueryOptions<UserMembershipsGetResponse>) =>
    useAuthQuery<UserMembershipsGetResponse>(
      queryKeys.organizations.memberships(),
      "/api/organization/memberships",
      undefined,
      options
    ),
  /** Switch the caller's current org. The variables ARE the request body
   *  ({ organizationId }). Consumers own cache invalidation in a per-call
   *  onSuccess — all cached data is org-scoped, so invalidate broadly. */
  switch: () =>
    useAuthMutation<OrganizationGetResponse, OrganizationSwitchRequest>({
      url: "/api/organization/switch",
      method: "POST",
    }),
  /** Owner-only org deletion (#197). The variables ARE the request body
   *  ({ confirmationName } — the server-verified type-to-confirm gate).
   *  Consumers log out on success, so no cache invalidation is needed. */
  delete: (id: string) =>
    useAuthMutation<OrganizationDeleteResponse, OrganizationDeleteRequest>({
      url: `/api/organization/${encodeURIComponent(id)}`,
      method: "DELETE",
    }),
};
