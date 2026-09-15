/**
 * Integration tests for SeatService (#584, slice 2).
 *
 * Exercises invite/list/revoke/resend + the tier seat cap against the real DB:
 * the cap counts members + pending invites, is fail-closed, and — the point of
 * the per-org advisory lock — cannot be overshot by concurrent invites. Authz
 * (owner+admin invite, member denied) and audit emission are verified too.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, like } from "drizzle-orm";
import postgres from "postgres";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { SeatService } from "../../../services/seat.service.js";
import { ApiError } from "../../../services/http.service.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import type { PermissionContext } from "../../../services/permission.service.js";
import {
  generateId,
  createUser,
  createOrganization,
  createOrganizationUser,
  teardownOrg,
} from "../utils/application.util.js";

const AUDIT = { sourceIp: "203.0.113.4", userAgent: "jest" };

describe("SeatService Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let orgId: string;
  let ownerId: string;
  let owner: PermissionContext;
  let tierSlug: string;

  const asDrizzle = () => db as ReturnType<typeof drizzle>;

  /** Point the org at a dedicated tier with the given seat cap (null = unlimited). */
  async function setSeatCap(maxSeats: number | null) {
    const client = asDrizzle();
    await client.insert(schema.tiers).values({
      id: generateId(),
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
      slug: tierSlug,
      displayName: "Seat Test Tier",
      maxSeats,
    } as never);
    await client
      .update(schema.organizations)
      .set({ tier: tierSlug })
      .where(eq(schema.organizations.id, orgId));
  }

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 6 });
    db = drizzle(connection, { schema });
    await teardownOrg(asDrizzle());

    const u = createUser(`auth0|${generateId()}`);
    await asDrizzle()
      .insert(schema.users)
      .values(u as never);
    ownerId = u.id;
    const org = createOrganization(u.id);
    await asDrizzle()
      .insert(schema.organizations)
      .values(org as never);
    orgId = org.id;
    // The owner is a member (counts toward seats + appears in listMembers).
    await asDrizzle()
      .insert(schema.organizationUsers)
      .values(
        createOrganizationUser(orgId, ownerId, { role: "owner" }) as never
      );
    owner = { userId: ownerId, organizationId: orgId, role: "owner" };
    tierSlug = `seat-cap-test-${generateId()}`;
  });

  afterEach(async () => {
    await teardownOrg(asDrizzle());
    // Test tiers are not covered by teardownOrg; remove ours (orgs already gone).
    await asDrizzle()
      .delete(schema.tiers)
      .where(like(schema.tiers.slug, "seat-cap-test-%"));
    await connection.end();
  });

  const auditRows = (action: string) =>
    asDrizzle()
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.organizationId, orgId),
          eq(schema.auditLog.action, action as never)
        )
      );

  // ── invite + token handling ─────────────────────────────────────────

  it("invite creates a pending row + inviteUrl and stores only the token hash", async () => {
    await setSeatCap(null);
    const res = await SeatService.invite(
      owner,
      { email: "Invitee@Example.com", role: "member" },
      AUDIT
    );

    expect(res.status).toBe("pending");
    expect(res.email).toBe("invitee@example.com"); // normalized
    expect(res.role).toBe("member");
    expect(res.inviteUrl).toContain("token=");
    expect((res as Record<string, unknown>).tokenHash).toBeUndefined();

    const [row] = await asDrizzle()
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, res.id));
    expect(row.tokenHash).toBeDefined();
    // The stored hash is not the plaintext token from the URL.
    const token = res.inviteUrl!.split("token=")[1];
    expect(row.tokenHash).not.toBe(token);

    await new Promise((r) => setTimeout(r, 60));
    expect(await auditRows("member.invite")).toHaveLength(1);
  });

  // ── seat cap ────────────────────────────────────────────────────────

  it("enforces the seat cap counting members + pending invites", async () => {
    await setSeatCap(2); // owner is member #1
    // One invite reserves the 2nd seat.
    await SeatService.invite(
      owner,
      { email: "a@x.com", role: "member" },
      AUDIT
    );
    // The next exceeds the cap.
    await expect(
      SeatService.invite(owner, { email: "b@x.com", role: "member" }, AUDIT)
    ).rejects.toMatchObject({ code: ApiCode.SEAT_LIMIT_EXCEEDED });
  });

  it("maxSeats = null (unlimited) never denies", async () => {
    await setSeatCap(null);
    for (const email of ["a@x.com", "b@x.com", "c@x.com"]) {
      await expect(
        SeatService.invite(owner, { email, role: "member" }, AUDIT)
      ).resolves.toBeDefined();
    }
  });

  it("concurrent invites racing the last seat: exactly one wins", async () => {
    await setSeatCap(2); // owner + 1 free seat
    const results = await Promise.allSettled([
      SeatService.invite(owner, { email: "r1@x.com", role: "member" }, AUDIT),
      SeatService.invite(owner, { email: "r2@x.com", role: "member" }, AUDIT),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: ApiCode.SEAT_LIMIT_EXCEEDED,
    });
  });

  it("revoke frees a reserved seat", async () => {
    await setSeatCap(2);
    const inv = await SeatService.invite(
      owner,
      { email: "a@x.com", role: "member" },
      AUDIT
    );
    // Cap now reached.
    await expect(
      SeatService.invite(owner, { email: "b@x.com", role: "member" }, AUDIT)
    ).rejects.toMatchObject({ code: ApiCode.SEAT_LIMIT_EXCEEDED });
    // Revoke frees the seat.
    await SeatService.revoke(owner, inv.id, AUDIT);
    await expect(
      SeatService.invite(owner, { email: "b@x.com", role: "member" }, AUDIT)
    ).resolves.toBeDefined();
    await new Promise((r) => setTimeout(r, 60));
    expect(await auditRows("member.invite.revoke")).toHaveLength(1);
  });

  // ── resend ──────────────────────────────────────────────────────────

  it("resend rotates the token (old link no longer valid) and re-audits", async () => {
    await setSeatCap(null);
    const inv = await SeatService.invite(
      owner,
      { email: "a@x.com", role: "member" },
      AUDIT
    );
    const oldToken = inv.inviteUrl!.split("token=")[1];
    const resent = await SeatService.resend(owner, inv.id, AUDIT);
    const newToken = resent.inviteUrl!.split("token=")[1];
    expect(newToken).not.toBe(oldToken);

    const [row] = await asDrizzle()
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, inv.id));
    // Stored hash now matches the NEW token, not the old one.
    expect(row.tokenHash).not.toBe(oldToken);
    await new Promise((r) => setTimeout(r, 60));
    expect(await auditRows("member.invite.resend")).toHaveLength(1);
  });

  // ── conflicts ───────────────────────────────────────────────────────

  it("rejects inviting an existing member (MEMBER_ALREADY_EXISTS)", async () => {
    await setSeatCap(null);
    const memberUser = createUser(`auth0|${generateId()}`, {
      email: "member@x.com",
    });
    await asDrizzle()
      .insert(schema.users)
      .values(memberUser as never);
    await asDrizzle()
      .insert(schema.organizationUsers)
      .values(
        createOrganizationUser(orgId, memberUser.id, {
          role: "member",
        }) as never
      );
    await expect(
      SeatService.invite(
        owner,
        { email: "member@x.com", role: "member" },
        AUDIT
      )
    ).rejects.toMatchObject({ code: ApiCode.MEMBER_ALREADY_EXISTS });
  });

  it("rejects a duplicate pending invite (INVITATION_ALREADY_PENDING)", async () => {
    await setSeatCap(null);
    await SeatService.invite(
      owner,
      { email: "dup@x.com", role: "member" },
      AUDIT
    );
    await expect(
      SeatService.invite(owner, { email: "dup@x.com", role: "member" }, AUDIT)
    ).rejects.toMatchObject({ code: ApiCode.INVITATION_ALREADY_PENDING });
  });

  // ── authz ───────────────────────────────────────────────────────────

  it("a member caller cannot invite; an admin can", async () => {
    await setSeatCap(null);
    const member: PermissionContext = {
      userId: "u-member",
      organizationId: orgId,
      role: "member",
    };
    await expect(
      SeatService.invite(member, { email: "x@x.com", role: "member" }, AUDIT)
    ).rejects.toBeInstanceOf(ApiError);

    const admin: PermissionContext = {
      userId: ownerId,
      organizationId: orgId,
      role: "admin",
    };
    await expect(
      SeatService.invite(admin, { email: "y@x.com", role: "member" }, AUDIT)
    ).resolves.toBeDefined();
  });

  // ── listing ─────────────────────────────────────────────────────────

  it("listMembers returns the owner; listInvitations returns pending", async () => {
    await setSeatCap(null);
    await SeatService.invite(owner, { email: "p@x.com", role: "admin" }, AUDIT);

    const members = await SeatService.listMembers(owner);
    expect(members).toHaveLength(1);
    expect(members[0].userId).toBe(ownerId);
    expect(members[0].role).toBe("owner");

    const invitations = await SeatService.listInvitations(owner);
    expect(invitations).toHaveLength(1);
    expect(invitations[0].email).toBe("p@x.com");
    expect(
      (invitations[0] as Record<string, unknown>).tokenHash
    ).toBeUndefined();
  });

  // ── accept ──────────────────────────────────────────────────────────

  it("acceptByToken binds the invitee as a member and is idempotent", async () => {
    await setSeatCap(null);
    const inv = await SeatService.invite(
      owner,
      { email: "joiner@x.com", role: "member" },
      AUDIT
    );
    const token = inv.inviteUrl!.split("token=")[1];
    const invitee = createUser(`auth0|${generateId()}`, {
      email: "joiner@x.com",
    });
    await asDrizzle()
      .insert(schema.users)
      .values(invitee as never);

    const res = await SeatService.acceptByToken(invitee as never, token, AUDIT);
    expect(res.organization.id).toBe(orgId);
    expect(res.role).toBe("member");

    const [membership] = await asDrizzle()
      .select()
      .from(schema.organizationUsers)
      .where(eq(schema.organizationUsers.userId, invitee.id));
    expect(membership.role).toBe("member");

    // Re-accepting the (now consumed) token fails.
    await expect(
      SeatService.acceptByToken(invitee as never, token, AUDIT)
    ).rejects.toMatchObject({ code: ApiCode.INVITATION_NOT_FOUND });

    await new Promise((r) => setTimeout(r, 60));
    expect(await auditRows("member.invite.accept")).toHaveLength(1);
  });

  it("acceptByToken: 404 on unknown token, 410 on expired", async () => {
    await setSeatCap(null);
    const invitee = createUser(`auth0|${generateId()}`, { email: "e@x.com" });
    await asDrizzle()
      .insert(schema.users)
      .values(invitee as never);

    await expect(
      SeatService.acceptByToken(invitee as never, "bogus-token", AUDIT)
    ).rejects.toMatchObject({ code: ApiCode.INVITATION_NOT_FOUND });

    const inv = await SeatService.invite(
      owner,
      { email: "e@x.com", role: "member" },
      AUDIT
    );
    const token = inv.inviteUrl!.split("token=")[1];
    await asDrizzle()
      .update(schema.invitations)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(schema.invitations.id, inv.id));
    await expect(
      SeatService.acceptByToken(invitee as never, token, AUDIT)
    ).rejects.toMatchObject({ code: ApiCode.INVITATION_EXPIRED });
  });
});
