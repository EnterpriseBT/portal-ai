import { z } from "zod";
import { InvitationSchema } from "../models/invitation.model.js";
import { OrganizationSchema } from "../models/organization.model.js";
import { OrgRoleSchema } from "../models/organization-user.model.js";
import { RbacKindSchema } from "../models/permission.model.js";

/**
 * Wire contracts for org seats / invitations (#584). The invite-link flow is
 * self-contained: `POST /invitations` returns an `inviteUrl` (the plaintext
 * token, once); acceptance carries the token in the **body** (never the URL —
 * a bearer capability must not land in access/proxy logs or history).
 */

/**
 * Request body for `POST /api/organization/invitations`. You invite at
 * `member` or `admin` — never `owner` (ownership transfer is out of scope).
 */
export const InviteCreateRequestSchema = z.object({
  email: z.string().email(),
  role: OrgRoleSchema.refine((r) => r !== "owner", {
    message: "Cannot invite a user as owner",
  }),
});
export type InviteCreateRequest = z.infer<typeof InviteCreateRequestSchema>;

/**
 * Request body for `POST /api/organization/invitations/accept` — the token
 * travels in the body, not the URL.
 */
export const AcceptInvitationRequestSchema = z.object({
  token: z.string().min(1),
});
export type AcceptInvitationRequest = z.infer<
  typeof AcceptInvitationRequestSchema
>;

/**
 * An invitation as returned to a caller — the row **without** `tokenHash`
 * (never exposed), plus a transient `inviteUrl` present only on the
 * invite/resend responses (carries the plaintext token once).
 */
export const InvitationResponseSchema = InvitationSchema.omit({
  tokenHash: true,
}).extend({
  inviteUrl: z.string().optional(),
});
export type InvitationResponse = z.infer<typeof InvitationResponseSchema>;

/** Response payload for `GET /api/organization/invitations`. */
export const InvitationListResponseSchema = z.object({
  invitations: z.array(InvitationResponseSchema),
});
export type InvitationListResponse = z.infer<
  typeof InvitationListResponseSchema
>;

/** A resolved org member — the membership joined to its user. */
export const MemberSchema = z.object({
  userId: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  /** The member's **system** roles in the org (#620), from the `user_role`
   *  join — for display + owner/self UI logic. Custom roles are surfaced via
   *  `roleSlugs`, not here. */
  roles: z.array(OrgRoleSchema),
  /** The slugs of **all** roles the member holds (#622) — system + custom, the
   *  complete assignment set the Members-tab multiselect edits. Defaulted so
   *  callers/fixtures predating custom roles still parse. */
  roleSlugs: z.array(z.string()).default([]),
  /** The custom groups the member belongs to (#622), from the `user_group`
   *  join — group ids. Empty unless the org authors custom groups. Defaulted so
   *  callers/fixtures predating groups still parse. */
  groupIds: z.array(z.string()).default([]),
  /** The membership's `created` timestamp (epoch ms). */
  joinedAt: z.number(),
});
export type Member = z.infer<typeof MemberSchema>;

/** A role the caller may assign to members (#622) — the option set for the
 *  Members-tab role multiselect (system roles always; custom when authored).
 *  `slug` is the stable assignment key. */
export const RoleRefSchema = z.object({
  slug: z.string(),
  name: z.string(),
  kind: RbacKindSchema,
});
export type RoleRef = z.infer<typeof RoleRefSchema>;

/**
 * Org seat usage (#585) — `used` = accepted members + pending-active invites;
 * `max` = the tier's seat cap, `null` = unlimited. A display value (the server
 * enforces the cap on invite via `SeatService`); resolved fail-open (`max:null`
 * when the tier can't be read) so it never blocks the members list.
 */
export const SeatUsageSchema = z.object({
  used: z.number().int().nonnegative(),
  max: z.number().int().nullable(),
});
export type SeatUsage = z.infer<typeof SeatUsageSchema>;

/** Response payload for `GET /api/organization/members`. */
export const MemberListResponseSchema = z.object({
  members: z.array(MemberSchema),
  seatUsage: SeatUsageSchema,
  /** The roles the caller may assign here (#622) — the multiselect's options.
   *  System roles always; custom roles only when the org authored them.
   *  Defaulted so pre-#622 callers/fixtures still parse. */
  assignableRoles: z.array(RoleRefSchema).default([]),
});
export type MemberListResponse = z.infer<typeof MemberListResponseSchema>;

/**
 * Response payload for a successful accept — the invited org + the caller's
 * role in it (same shape as `OrganizationGetResponse`).
 */
export const AcceptInvitationResponseSchema = z.object({
  organization: OrganizationSchema,
  role: OrgRoleSchema,
});
export type AcceptInvitationResponse = z.infer<
  typeof AcceptInvitationResponseSchema
>;
