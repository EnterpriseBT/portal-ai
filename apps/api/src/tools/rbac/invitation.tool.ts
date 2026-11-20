import { z } from "zod";
import { tool } from "ai";

import { toInvitationBlockContent } from "@portalai/core/contracts";
import { OrgRoleSchema } from "@portalai/core/models";

import { Tool } from "../../types/tools.js";
import { SeatService } from "../../services/seat.service.js";
import type { PermissionContext } from "../../services/permission.service.js";
import { AGENT_AUDIT, runRbac } from "./rbac-tool.util.js";

/**
 * The invitation half of the `member_management` pack (#847). Each tool wraps
 * the `SeatService` method Settings → Members calls, so it refuses what
 * Settings refuses (a 403 becomes TOOL_PERMISSION_DENIED at the gate; any
 * other refusal is relayed with its code).
 *
 * No result carries an invite link. The link is a join credential, so
 * `member_invite` and `invitation_show` return `invitation` block content
 * (`toInvitationBlockContent` drops `inviteUrl`), and the block's own button
 * asks the resend endpoint for a fresh link in the user's browser.
 */

const InviteInput = z
  .object({
    email: z.string().email().describe("The invitee's email address"),
    role: OrgRoleSchema.exclude(["owner"]).describe(
      "The system role they receive on accepting: admin or member"
    ),
  })
  .strict();
const ListInput = z.object({}).strict();
const InvitationIdInput = z
  .object({
    invitationId: z
      .string()
      .min(1)
      .describe("The invitation's id, from invitation_list"),
  })
  .strict();

export class MemberInviteTool extends Tool<typeof InviteInput> {
  slug = "member_invite";
  name = "member_invite";
  description =
    "Invites someone by email with a system role (admin or member). The user sees the invitation as a block with a button that generates the link to share; the result never contains a link. Refuses an existing member, an already-pending invitation (show it with invitation_show instead) and a full seat count. Needs member.invite.";

  get schema() {
    return InviteInput;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runRbac(async () => {
          const { email, role } = this.validate(input);
          const inv = await SeatService.invite(
            ctx,
            { email, role },
            AGENT_AUDIT
          );
          return toInvitationBlockContent(inv);
        }),
    });
  }
}

export class InvitationListTool extends Tool<typeof ListInput> {
  slug = "invitation_list";
  name = "invitation_list";
  description =
    "Lists the organization's pending invitations: id, email, role and expiry. Needs member.invite.";

  get schema() {
    return ListInput;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: () =>
        runRbac(async () => ({
          invitations: (await SeatService.listInvitations(ctx)).map((inv) => ({
            invitationId: inv.id,
            email: inv.email,
            role: inv.role,
            expiresAt: inv.expiresAt,
          })),
        })),
    });
  }
}

export class InvitationShowTool extends Tool<typeof InvitationIdInput> {
  slug = "invitation_show";
  name = "invitation_show";
  description =
    "Shows a pending invitation to the user as a block whose button generates a fresh link (which replaces the old one). Use it to reshare an invitation instead of inviting again. Needs member.invite.";

  get schema() {
    return InvitationIdInput;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runRbac(async () => {
          const { invitationId } = this.validate(input);
          return toInvitationBlockContent(
            await SeatService.getPendingInvitation(ctx, invitationId)
          );
        }),
    });
  }
}

export class InvitationRevokeTool extends Tool<typeof InvitationIdInput> {
  slug = "invitation_revoke";
  name = "invitation_revoke";
  description =
    "Revokes a pending invitation so its link stops working. Needs member.invite.";

  get schema() {
    return InvitationIdInput;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runRbac(async () => {
          const { invitationId } = this.validate(input);
          await SeatService.revoke(ctx, invitationId, AGENT_AUDIT);
          return {
            success: true as const,
            invitationId,
            status: "revoked" as const,
          };
        }),
    });
  }
}
