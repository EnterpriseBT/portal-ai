import type {
  MemberListResponse,
  MemberRoleUpdateResponse,
  MemberRoleUpdateRequest,
} from "@portalai/core/contracts";
import { useAuthQuery, useAuthMutation } from "../utils/api.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

/**
 * Org members (#585) — the read side of the Members/Team tab. Owner/admin only
 * (server-enforced); `list` also carries `seatUsage`. Mutations don't
 * self-invalidate — the tab's `onSuccess` invalidates `queryKeys.members.root`.
 */
export const members = {
  list: (options?: QueryOptions<MemberListResponse>) =>
    useAuthQuery<MemberListResponse>(
      queryKeys.members.list(),
      "/api/organization/members",
      undefined,
      options
    ),

  /** Remove a member (soft-delete). Variables build the URL; no body. */
  remove: () =>
    useAuthMutation<void, { userId: string }>({
      url: (v) => `/api/organization/members/${encodeURIComponent(v.userId)}`,
      method: "DELETE",
      body: () => undefined,
    }),

  /** Change a member's role (owner-only, server-enforced). */
  changeRole: () =>
    useAuthMutation<
      MemberRoleUpdateResponse,
      { userId: string } & MemberRoleUpdateRequest
    >({
      url: (v) =>
        `/api/organization/members/${encodeURIComponent(v.userId)}/role`,
      method: "PATCH",
      body: (v) => ({ role: v.role }),
    }),
};
