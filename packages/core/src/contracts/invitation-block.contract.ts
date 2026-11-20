import { z } from "zod";

import { InvitationStatusSchema } from "../models/invitation.model.js";
import { OrgRoleSchema } from "../models/organization-user.model.js";
import type { InvitationResponse } from "./invitation.contract.js";

/**
 * The `invitation` block (#847): an invitation `member_invite` or
 * `invitation_show` made or found, rendered in the portal with a "Get invite
 * link" button. The server builds the block from the tool's own result.
 *
 * It never carries the invite link. The link is a join credential, so it
 * isn't put in the model's context or the stored portal messages: the block's
 * button asks the existing resend endpoint for a fresh one, shown only in the
 * browser that asked. `.strict()` refuses a link or token riding along.
 */
export const InvitationBlockContentSchema = z
  .object({
    type: z.literal("invitation"),
    invitationId: z.string().min(1),
    email: z.string(),
    role: OrgRoleSchema,
    status: InvitationStatusSchema,
    expiresAt: z.number(),
  })
  .strict();
export type InvitationBlockContent = z.infer<
  typeof InvitationBlockContentSchema
>;

/** An invitation as block content: its five display fields, never its link. */
export function toInvitationBlockContent(
  inv: InvitationResponse
): InvitationBlockContent {
  return {
    type: "invitation",
    invitationId: inv.id,
    email: inv.email,
    role: inv.role,
    status: inv.status,
    expiresAt: inv.expiresAt,
  };
}
