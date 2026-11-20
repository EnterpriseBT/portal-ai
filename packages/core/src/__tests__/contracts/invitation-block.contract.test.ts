import { describe, it, expect } from "@jest/globals";

import {
  InvitationBlockContentSchema,
  toInvitationBlockContent,
} from "../../contracts/invitation-block.contract.js";
import type { InvitationResponse } from "../../contracts/invitation.contract.js";

describe("InvitationBlockContentSchema (#847)", () => {
  const valid = {
    type: "invitation" as const,
    invitationId: "inv-1",
    email: "alice@example.com",
    role: "member" as const,
    status: "pending" as const,
    expiresAt: 1_800_000_000_000,
  };

  it("parses a valid invitation", () => {
    expect(InvitationBlockContentSchema.parse(valid)).toEqual(valid);
  });

  it("refuses a link or token riding along (strict)", () => {
    for (const extra of [
      { inviteUrl: "https://app/invitations/accept?token=abc" },
      { tokenHash: "deadbeef" },
      { token: "abc" },
    ]) {
      expect(
        InvitationBlockContentSchema.safeParse({ ...valid, ...extra }).success
      ).toBe(false);
    }
  });

  it("refuses an unknown status or role", () => {
    expect(
      InvitationBlockContentSchema.safeParse({ ...valid, status: "sent" })
        .success
    ).toBe(false);
    expect(
      InvitationBlockContentSchema.safeParse({ ...valid, role: "guest" })
        .success
    ).toBe(false);
  });

  it("toInvitationBlockContent keeps the five fields and drops the link", () => {
    const inv: InvitationResponse = {
      id: "inv-1",
      organizationId: "org-1",
      email: "alice@example.com",
      role: "member",
      status: "pending",
      expiresAt: 1_800_000_000_000,
      invitedByUserId: "u-1",
      acceptedByUserId: null,
      acceptedAt: null,
      inviteUrl: "https://app/invitations/accept?token=secret",
      created: 1,
      createdBy: "u-1",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    };
    const content = toInvitationBlockContent(inv);
    expect(content).toEqual({
      type: "invitation",
      invitationId: "inv-1",
      email: "alice@example.com",
      role: "member",
      status: "pending",
      expiresAt: 1_800_000_000_000,
    });
    expect(JSON.stringify(content)).not.toContain("secret");
    expect(InvitationBlockContentSchema.safeParse(content).success).toBe(true);
  });
});
