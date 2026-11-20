import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import { ApiError } from "../../../services/http.service.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import type { PermissionContext } from "../../../services/permission.service.js";

/**
 * Unit coverage for the member_management invitation tools (#847). Each wraps
 * the SeatService method Settings → Members calls. Pinned here: the agent
 * audit stamp, the link never reaching the result, a 403 propagating (the
 * gate turns it into TOOL_PERMISSION_DENIED) and other refusals relayed with
 * their code.
 */

const invite = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const listInvitations = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const getPendingInvitation =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const revoke = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.unstable_mockModule("../../../services/seat.service.js", () => ({
  SeatService: { invite, listInvitations, getPendingInvitation, revoke },
}));

const {
  MemberInviteTool,
  InvitationListTool,
  InvitationShowTool,
  InvitationRevokeTool,
} = await import("../../../tools/rbac/invitation.tool.js");
const { AGENT_AUDIT } = await import("../../../tools/rbac/rbac-tool.util.js");

const ctx: PermissionContext = {
  userId: "u-1",
  organizationId: "org-1",
  roles: [],
};

type Executable = { execute: (i: unknown, o: unknown) => Promise<unknown> };
const exec = (built: unknown, input: unknown) =>
  (built as Executable).execute(input, { toolCallId: "t", messages: [] });

const INVITATION = {
  id: "inv-1",
  organizationId: "org-1",
  email: "alice@example.com",
  role: "member",
  status: "pending",
  expiresAt: 1_800_000_000_000,
  invitedByUserId: "u-1",
  acceptedByUserId: null,
  acceptedAt: null,
  created: 1,
  createdBy: "u-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};
const BLOCK = {
  type: "invitation",
  invitationId: "inv-1",
  email: "alice@example.com",
  role: "member",
  status: "pending",
  expiresAt: 1_800_000_000_000,
};

describe("member_management invitation tools (#847)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("member_invite invites with the agent audit stamp and returns the block, never the link", async () => {
    invite.mockResolvedValue({
      ...INVITATION,
      inviteUrl: "https://app/invitations/accept?token=secret",
    });
    const r = await exec(new MemberInviteTool().build(ctx), {
      email: "alice@example.com",
      role: "member",
    });
    expect(invite).toHaveBeenCalledWith(
      ctx,
      { email: "alice@example.com", role: "member" },
      AGENT_AUDIT
    );
    expect(r).toEqual(BLOCK);
    expect(JSON.stringify(r)).not.toContain("secret");
  });

  it("member_invite relays a refusal with its code", async () => {
    invite.mockRejectedValue(
      new ApiError(
        409,
        ApiCode.INVITATION_ALREADY_PENDING,
        "An invitation is already pending for this email"
      )
    );
    const r = await exec(new MemberInviteTool().build(ctx), {
      email: "alice@example.com",
      role: "member",
    });
    expect(r).toEqual({
      error: "An invitation is already pending for this email",
      code: ApiCode.INVITATION_ALREADY_PENDING,
    });
  });

  it("member_invite lets a 403 propagate, so the gate surfaces the denial", async () => {
    invite.mockRejectedValue(
      new ApiError(
        403,
        ApiCode.PERMISSION_DENIED,
        "You don't have permission to invite members."
      )
    );
    await expect(
      exec(new MemberInviteTool().build(ctx), {
        email: "alice@example.com",
        role: "member",
      })
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("member_invite refuses an owner role or a bad email without calling the service", async () => {
    for (const input of [
      { email: "alice@example.com", role: "owner" },
      { email: "not-an-email", role: "member" },
      // #1101: over RFC 5321's 254 characters.
      { email: "a".repeat(288) + "@example.com", role: "member" },
    ]) {
      const r = (await exec(new MemberInviteTool().build(ctx), input)) as {
        error?: string;
      };
      expect(r.error).toBeDefined();
    }
    expect(invite).not.toHaveBeenCalled();
  });

  it("member_invite refuses an email over 254 characters for its length (#1101)", async () => {
    const r = (await exec(new MemberInviteTool().build(ctx), {
      email: "a".repeat(288) + "@example.com",
      role: "member",
    })) as { error?: string };
    expect(r.error).toContain("Email must be 254 characters or fewer");
    expect(invite).not.toHaveBeenCalled();
  });

  it("invitation_list returns id, email, role and expiry for each pending invitation", async () => {
    listInvitations.mockResolvedValue([INVITATION]);
    const r = await exec(new InvitationListTool().build(ctx), {});
    expect(listInvitations).toHaveBeenCalledWith(ctx);
    expect(r).toEqual({
      invitations: [
        {
          invitationId: "inv-1",
          email: "alice@example.com",
          role: "member",
          expiresAt: 1_800_000_000_000,
        },
      ],
    });
  });

  it("invitation_show returns the pending invitation's block", async () => {
    getPendingInvitation.mockResolvedValue(INVITATION);
    const r = await exec(new InvitationShowTool().build(ctx), {
      invitationId: "inv-1",
    });
    expect(getPendingInvitation).toHaveBeenCalledWith(ctx, "inv-1");
    expect(r).toEqual(BLOCK);
  });

  it("invitation_show relays a missing invitation with its code", async () => {
    getPendingInvitation.mockRejectedValue(
      new ApiError(404, ApiCode.INVITATION_NOT_FOUND, "Invitation not found")
    );
    const r = await exec(new InvitationShowTool().build(ctx), {
      invitationId: "inv-gone",
    });
    expect(r).toEqual({
      error: "Invitation not found",
      code: ApiCode.INVITATION_NOT_FOUND,
    });
  });

  it("invitation_revoke revokes with the agent audit stamp", async () => {
    revoke.mockResolvedValue({ ...INVITATION, status: "revoked" });
    const r = await exec(new InvitationRevokeTool().build(ctx), {
      invitationId: "inv-1",
    });
    expect(revoke).toHaveBeenCalledWith(ctx, "inv-1", AGENT_AUDIT);
    expect(r).toEqual({
      success: true,
      invitationId: "inv-1",
      status: "revoked",
    });
  });
});
