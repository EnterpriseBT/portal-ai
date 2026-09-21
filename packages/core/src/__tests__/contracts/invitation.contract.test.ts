import {
  InviteCreateRequestSchema,
  AcceptInvitationRequestSchema,
  InvitationResponseSchema,
  SeatUsageSchema,
  MemberListResponseSchema,
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

describe("SeatUsageSchema (#585)", () => {
  it("accepts used + a numeric or null cap", () => {
    expect(SeatUsageSchema.safeParse({ used: 2, max: 5 }).success).toBe(true);
    expect(SeatUsageSchema.safeParse({ used: 0, max: null }).success).toBe(
      true
    );
  });

  it("rejects a negative used count", () => {
    expect(SeatUsageSchema.safeParse({ used: -1, max: null }).success).toBe(
      false
    );
  });
});

describe("MemberListResponseSchema (#585)", () => {
  const member = {
    userId: "u-1",
    email: "a@b.com",
    name: "A",
    roles: ["member" as const],
    role: "member" as const,
    joinedAt: 1,
  };

  it("requires seatUsage alongside members", () => {
    expect(
      MemberListResponseSchema.safeParse({ members: [member] }).success
    ).toBe(false);
    expect(
      MemberListResponseSchema.safeParse({
        members: [member],
        seatUsage: { used: 1, max: 3 },
      }).success
    ).toBe(true);
  });

  it("requires roles[] on each member, and accepts multiple (#620)", () => {
    const { roles: _omit, ...withoutRoles } = member;
    expect(
      MemberListResponseSchema.safeParse({
        members: [withoutRoles],
        seatUsage: { used: 1, max: 3 },
      }).success
    ).toBe(false);
    expect(
      MemberListResponseSchema.safeParse({
        members: [{ ...member, roles: ["admin", "member"], role: "admin" }],
        seatUsage: { used: 1, max: 3 },
      }).success
    ).toBe(true);
  });
});
