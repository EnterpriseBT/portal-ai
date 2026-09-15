/**
 * Integration tests for the InvitationsRepository (#584, slice 1).
 *
 * Exercises the finders, the pending-active seat-count semantics (excludes
 * expired/revoked/accepted), the partial-unique "one live pending per
 * (org,email)" invariant, and the atomic single-winner `consumeByTokenHash`
 * under two racing accepts — all against the real DB harness.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";

import { InvitationsRepository } from "../../../../db/repositories/invitations.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import type { InvitationInsert } from "../../../../db/schema/zod.js";
import * as schema from "../../../../db/schema/index.js";
import {
  generateId,
  createUser,
  createOrganization,
  teardownOrg,
} from "../../utils/application.util.js";

const NOW = 1_800_000_000_000;

describe("InvitationsRepository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: InvitationsRepository;
  let orgId: string;
  let ownerId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 4 });
    db = drizzle(connection, { schema });
    repo = new InvitationsRepository();

    const client = db as ReturnType<typeof drizzle>;
    await teardownOrg(client);

    const user = createUser(`auth0|${generateId()}`);
    await client.insert(schema.users).values(user as never);
    ownerId = user.id;
    const org = createOrganization(user.id);
    await client.insert(schema.organizations).values(org as never);
    orgId = org.id;
  });

  afterEach(async () => {
    await teardownOrg(db as ReturnType<typeof drizzle>);
    await connection.end();
  });

  function invRow(overrides: Partial<InvitationInsert> = {}): InvitationInsert {
    return {
      id: generateId(),
      created: NOW,
      createdBy: ownerId,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: orgId,
      email: `invitee-${generateId()}@example.com`,
      role: "member",
      tokenHash: `hash-${generateId()}`,
      status: "pending",
      expiresAt: NOW + 60_000,
      invitedByUserId: ownerId,
      acceptedByUserId: null,
      acceptedAt: null,
      ...overrides,
    };
  }

  // ── finders ─────────────────────────────────────────────────────────

  it("findByTokenHash / findPendingByOrgEmail resolve a live pending row", async () => {
    const row = invRow({ email: "a@example.com", tokenHash: "tok-a" });
    await repo.create(row, db);

    expect((await repo.findByTokenHash("tok-a", db))?.id).toBe(row.id);
    expect(
      (await repo.findPendingByOrgEmail(orgId, "a@example.com", db))?.id
    ).toBe(row.id);
    expect(await repo.findByTokenHash("nope", db)).toBeUndefined();
  });

  // ── pending-active count semantics ──────────────────────────────────

  it("countPendingActive counts only pending, unexpired rows", async () => {
    await repo.create(invRow(), db); // pending, active
    await repo.create(invRow({ status: "revoked" }), db); // excluded
    await repo.create(invRow({ status: "accepted" }), db); // excluded
    await repo.create(invRow({ expiresAt: NOW - 1 }), db); // expired → excluded

    expect(await repo.countPendingActive(orgId, NOW, db)).toBe(1);
  });

  it("findPendingActiveByEmail returns live unexpired pending invites across orgs", async () => {
    const email = "multi@example.com";
    await repo.create(invRow({ email, tokenHash: "t1" }), db); // org1, active
    // A second org with an EXPIRED invite for the same email (the partial
    // unique index only allows one live pending per (org,email), so the
    // expired sibling must live in a different org).
    const org2 = createOrganization(ownerId);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.organizations)
      .values(org2 as never);
    await repo.create(
      invRow({
        email,
        tokenHash: "t2",
        organizationId: org2.id,
        expiresAt: NOW - 1,
      }),
      db
    );
    const rows = await repo.findPendingActiveByEmail(email, NOW, db);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe("t1");
  });

  // ── partial-unique invariant ────────────────────────────────────────

  it("rejects a second live pending invite for the same (org,email)", async () => {
    await repo.create(
      invRow({ email: "dup@example.com", tokenHash: "d1" }),
      db
    );
    await expect(
      repo.create(invRow({ email: "dup@example.com", tokenHash: "d2" }), db)
    ).rejects.toThrow();
  });

  it("allows a new pending invite once the prior one is revoked", async () => {
    const first = invRow({ email: "reuse@example.com", tokenHash: "r1" });
    await repo.create(first, db);
    await repo.update(first.id, { status: "revoked" }, db);
    // A fresh pending invite for the same email now succeeds.
    await expect(
      repo.create(invRow({ email: "reuse@example.com", tokenHash: "r2" }), db)
    ).resolves.toBeDefined();
  });

  // ── atomic consume ──────────────────────────────────────────────────

  it("consumeByTokenHash: exactly one of two racing accepts wins", async () => {
    await repo.create(invRow({ tokenHash: "race" }), db);

    // acceptedByUserId is FK → users.id, so use a real user (the owner).
    const [a, b] = await Promise.all([
      repo.consumeByTokenHash("race", ownerId, NOW, db),
      repo.consumeByTokenHash("race", ownerId, NOW, db),
    ]);

    expect([a, b].filter(Boolean)).toHaveLength(1);
    const winner = (a ?? b)!;
    expect(winner.status).toBe("accepted");
  });

  it("consumeByTokenHash returns undefined for an expired or revoked invite", async () => {
    await repo.create(invRow({ tokenHash: "exp", expiresAt: NOW - 1 }), db);
    expect(await repo.consumeByTokenHash("exp", "u", NOW, db)).toBeUndefined();

    const rev = invRow({ tokenHash: "rev", status: "revoked" });
    await repo.create(rev, db);
    expect(await repo.consumeByTokenHash("rev", "u", NOW, db)).toBeUndefined();
  });

  // ── tiers.max_seats CHECK (#584) ────────────────────────────────────

  it("tiers.max_seats CHECK rejects 0 but allows a positive int or NULL", async () => {
    const client = db as ReturnType<typeof drizzle>;
    // A default tier row exists (setup ensures one).
    await expect(
      client.execute(sql`UPDATE tiers SET max_seats = 0`)
    ).rejects.toThrow();
    await expect(
      client.execute(sql`UPDATE tiers SET max_seats = 5`)
    ).resolves.toBeDefined();
    await expect(
      client.execute(sql`UPDATE tiers SET max_seats = NULL`)
    ).resolves.toBeDefined();
  });
});
