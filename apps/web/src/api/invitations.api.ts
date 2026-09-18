import type {
  InvitationListResponse,
  InvitationResponse,
  InviteCreateRequest,
  AcceptInvitationRequest,
  AcceptInvitationResponse,
} from "@portalai/core/contracts";
import { useAuthQuery, useAuthMutation } from "../utils/api.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

/**
 * Org invitations (#585) — the pending side of the Members/Team tab + the
 * accept flow. Owner/admin only for invite/list/revoke/resend (server
 * enforced); `accept` is any authed user. `invite`/`resend` return a one-time
 * `inviteUrl` (the token is stored hashed, so it's shown only here). Mutations
 * don't self-invalidate — the tab's `onSuccess` invalidates
 * `queryKeys.invitations.root` (+ `members.root` for seat usage).
 */
export const invitations = {
  list: (options?: QueryOptions<InvitationListResponse>) =>
    useAuthQuery<InvitationListResponse>(
      queryKeys.invitations.list(),
      "/api/organization/invitations",
      undefined,
      options
    ),

  /** Invite an email at a role. Variables ARE the body ({ email, role }). */
  create: () =>
    useAuthMutation<InvitationResponse, InviteCreateRequest>({
      url: "/api/organization/invitations",
      method: "POST",
    }),

  revoke: () =>
    useAuthMutation<InvitationResponse, { id: string }>({
      url: (v) =>
        `/api/organization/invitations/${encodeURIComponent(v.id)}/revoke`,
      method: "POST",
      body: () => undefined,
    }),

  /** Rotate the token + extend expiry; returns a fresh `inviteUrl`. */
  resend: () =>
    useAuthMutation<InvitationResponse, { id: string }>({
      url: (v) =>
        `/api/organization/invitations/${encodeURIComponent(v.id)}/resend`,
      method: "POST",
      body: () => undefined,
    }),

  /** Accept an invitation by token (any authed user). Variables ARE the body. */
  accept: () =>
    useAuthMutation<AcceptInvitationResponse, AcceptInvitationRequest>({
      url: "/api/organization/invitations/accept",
      method: "POST",
    }),
};
