import {
  InviteCreateRequestSchema,
  AcceptInvitationRequestSchema,
  InvitationResponseSchema,
} from "../../contracts/invitation.contract.js";

describe("InviteCreateRequestSchema", () => {
  it("accepts a member/admin invite with a valid email", () => {
    expect(
      InviteCreateRequestSchema.safeParse({
        email: "a@b.com",
        role: "member",
      }).success
    ).toBe(true);
    expect(
      InviteCreateRequestSchema.safeParse({ email: "a@b.com", role: "admin" })
        .success
    ).toBe(true);
  });

  it("rejects inviting as owner", () => {
    expect(
      InviteCreateRequestSchema.safeParse({ email: "a@b.com", role: "owner" })
        .success
    ).toBe(false);
  });

  it("rejects a malformed email", () => {
    expect(
      InviteCreateRequestSchema.safeParse({ email: "nope", role: "member" })
        .success
    ).toBe(false);
  });
});

describe("AcceptInvitationRequestSchema", () => {
  it("requires a non-empty token", () => {
    expect(
      AcceptInvitationRequestSchema.safeParse({ token: "t" }).success
    ).toBe(true);
    expect(AcceptInvitationRequestSchema.safeParse({ token: "" }).success).toBe(
      false
    );
    expect(AcceptInvitationRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("InvitationResponseSchema", () => {
  it("never carries tokenHash", () => {
    expect(InvitationResponseSchema.shape).not.toHaveProperty("tokenHash");
  });

  it("allows a transient inviteUrl", () => {
    const row = {
      id: "inv-1",
      created: 1,
      createdBy: "u",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: "org-1",
      email: "a@b.com",
      role: "member" as const,
      status: "pending" as const,
      expiresAt: 10,
      invitedByUserId: "u",
      acceptedByUserId: null,
      acceptedAt: null,
      inviteUrl: "https://app/accept?token=abc",
    };
    expect(InvitationResponseSchema.safeParse(row).success).toBe(true);
  });
});
