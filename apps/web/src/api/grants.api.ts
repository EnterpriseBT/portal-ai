import type {
  ShareGrantRequest,
  ShareGrantResponse,
  GrantListResponse,
} from "@portalai/core/contracts";
import { useAuthQuery, useAuthMutation } from "../utils/api.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

/**
 * RBAC object grants / sharing (#621) — the `sdk.grants` domain. `list` reads a
 * station/pin's shares (owner/admin/creator only, server-enforced); `share`
 * and `revoke` are the mutations. Mutations don't self-invalidate — the caller
 * invalidates `queryKeys.grants.list(...)` (and the object's query) on success.
 */
export const grants = {
  list: (
    resourceType: "station" | "pin",
    resourceId: string,
    options?: QueryOptions<GrantListResponse>
  ) =>
    useAuthQuery<GrantListResponse>(
      queryKeys.grants.list(resourceType, resourceId),
      `/api/grants?resourceType=${resourceType}&resourceId=${encodeURIComponent(resourceId)}`,
      undefined,
      options
    ),

  /** Share an object with a member or the team. */
  share: () =>
    useAuthMutation<ShareGrantResponse, ShareGrantRequest>({
      url: "/api/grants",
      method: "POST",
    }),

  /** Revoke a share by a representative grant-row id. */
  revoke: () =>
    useAuthMutation<{ id: string }, { id: string }>({
      url: (v) => `/api/grants/${encodeURIComponent(v.id)}`,
      method: "DELETE",
      body: () => undefined,
    }),
};
