/**
 * Integration tests for ApplicationService.ensureProvisioned (#583, slice 2).
 *
 * The single idempotent, concurrency-safe first-login path shared by the Auth0
 * webhook and the getApplicationMetadata self-heal. Run against the real DB so
 * the advisory lock + find-or-create + provisioning transaction execute for
 * real — the concurrency case (7) is the whole reason this lives in
 * integration, not a mocked unit test.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, and } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApplicationService } from "../../../services/application.service.js";
import { DbService } from "../../../services/db.service.js";
import { SeedService } from "../../../services/seed.service.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  generateId,
  createUser,
  createOrganization,
  createOrganizationUser,
  teardownOrg,
} from "../utils/application.util.js";

const { users, organizations, organizationUsers, invitations, auditLog } =
  schema;

/** A profile resolver that records how many times it was asked. */
const profileResolver = (
  opts: { email?: string; emailVerified?: boolean } = {}
) =>
  jest.fn(async () => ({
    email: opts.email ?? `resolved-${generateId()}@example.com`,
    name: "Resolved User",
    picture: null,
    emailVerified: opts.emailVerified ?? false,
  }));

describe("ApplicationService.ensureProvisioned Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 4 });
    db = drizzle(connection, { schema });

    await teardownOrg(db as ReturnType<typeof drizzle>);
    await new SeedService().seedConnectorDefinitions(db);
  });

  afterEach(async () => {
    try {
      // ensureProvisioned emits its org.create + auth.login audit rows
      // fire-and-forget (post-commit, fail-open). Let them land before
      // teardown purges audit_log — a late insert would otherwise re-reference
      // an org mid-delete and the FK abort would leak this suite's connection
      // pool (surfacing as 503s in later suites). The connection is closed in
      // `finally` regardless, so a teardown failure can never leak either.
      await new Promise((r) => setTimeout(r, 150));
      await teardownOrg(db as ReturnType<typeof drizzle>);
    } finally {
      await connection.end();
    }
  });

  const sub = () => `auth0|${generateId()}`;

  const usersFor = (auth0Id: string) =>
    (db as ReturnType<typeof drizzle>)
      .select()
      .from(users)
      .where(eq(users.auth0Id, auth0Id));

  const orgsOwnedBy = (userId: string) =>
    (db as ReturnType<typeof drizzle>)
      .select()
      .from(organizations)
      .where(eq(organizations.ownerUserId, userId));

  // ── case 4 ──────────────────────────────────────────────────────────

  it("new sub → creates user + org + OWNER membership; resolveProfile once; created:true", async () => {
    const auth0Sub = sub();
    const resolve = profileResolver();

    const result = await ApplicationService.ensureProvisioned(
      auth0Sub,
      resolve
    );

    expect(result.created).toBe(true);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(result.user.auth0Id).toBe(auth0Sub);
    expect(result.organizationUser.role).toBe("owner");
    expect(result.organization.ownerUserId).toBe(result.user.id);

    expect(await usersFor(auth0Sub)).toHaveLength(1);
    expect(await orgsOwnedBy(result.user.id)).toHaveLength(1);
  });

  // ── case 5 ──────────────────────────────────────────────────────────

  it("existing user WITH a membership → no-op, resolveProfile NOT called, created:false, no new org", async () => {
    const auth0Sub = sub();
    // First login provisions.
    const first = await ApplicationService.ensureProvisioned(
      auth0Sub,
      profileResolver()
    );

    const resolve = profileResolver();
    const second = await ApplicationService.ensureProvisioned(
      auth0Sub,
      resolve
    );

    expect(second.created).toBe(false);
    expect(resolve).not.toHaveBeenCalled();
    expect(second.user.id).toBe(first.user.id);
    expect(second.organization.id).toBe(first.organization.id);
    // Still exactly one org for the user.
    expect(await orgsOwnedBy(first.user.id)).toHaveLength(1);
  });

  // ── case 6 ──────────────────────────────────────────────────────────

  it("existing user with ZERO memberships → provisions (the self-heal case), created:true", async () => {
    const auth0Sub = sub();
    // A user row with no org/membership (webhook created the user but
    // provisioning never completed, or a user predating provisioning).
    const created = await DbService.repository.users.create(
      createUser(auth0Sub) as never
    );

    const resolve = profileResolver();
    const result = await ApplicationService.ensureProvisioned(
      auth0Sub,
      resolve
    );

    expect(result.created).toBe(true);
    // The user already existed, so no profile fetch was needed.
    expect(resolve).not.toHaveBeenCalled();
    expect(result.user.id).toBe(created.id);
    expect(result.organizationUser.role).toBe("owner");
    expect(await orgsOwnedBy(created.id)).toHaveLength(1);
  });

  // ── case 7 ──────────────────────────────────────────────────────────

  it("concurrent first-login for one sub → exactly one user + one org", async () => {
    const auth0Sub = sub();
    const resolve = profileResolver();

    const [a, b] = await Promise.all([
      ApplicationService.ensureProvisioned(auth0Sub, resolve),
      ApplicationService.ensureProvisioned(auth0Sub, resolve),
    ]);

    // Exactly one call provisioned; both resolve to the same user + org.
    expect([a, b].filter((r) => r.created).length).toBe(1);
    expect(a.user.id).toBe(b.user.id);
    expect(a.organization.id).toBe(b.organization.id);

    // The lock lets the loser observe the winner's user, so the profile is
    // fetched at most once (only the creator resolves it).
    expect(resolve.mock.calls.length).toBeLessThanOrEqual(1);

    expect(await usersFor(auth0Sub)).toHaveLength(1);
    expect(await orgsOwnedBy(a.user.id)).toHaveLength(1);
  });

  // ── case 8 ──────────────────────────────────────────────────────────

  it("provision path emits org.create + auth.login{firstLogin}; no-op path emits neither", async () => {
    const auth0Sub = sub();
    const first = await ApplicationService.ensureProvisioned(
      auth0Sub,
      profileResolver()
    );

    // Fire-and-forget audit — give it a tick to land.
    await new Promise((r) => setTimeout(r, 75));

    const auditRows = async (action: "org.create" | "auth.login") =>
      (db as ReturnType<typeof drizzle>)
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.organizationId, first.organization.id),
            eq(auditLog.action, action)
          )
        );

    const orgCreate = await auditRows("org.create");
    const login = await auditRows("auth.login");
    expect(orgCreate).toHaveLength(1);
    expect(orgCreate[0].targetId).toBe(first.organization.id);
    expect(login).toHaveLength(1);
    expect(login[0].metadata).toMatchObject({ firstLogin: true });

    // A second (no-op) call emits no further audit rows.
    await ApplicationService.ensureProvisioned(auth0Sub, profileResolver());
    await new Promise((r) => setTimeout(r, 75));
    expect(await auditRows("org.create")).toHaveLength(1);
    expect(await auditRows("auth.login")).toHaveLength(1);
  });

  // ── invited-user branch (#584, Decision 2-C) ────────────────────────

  /** Seed an inviter org + a pending invitation for `email`; return its org. */
  async function seedPendingInvite(email: string, role: "member" | "admin") {
    const client = db as ReturnType<typeof drizzle>;
    const inviter = createUser(`auth0|${generateId()}`);
    await client.insert(users).values(inviter as never);
    const org = createOrganization(inviter.id);
    await client.insert(organizations).values(org as never);
    await client
      .insert(organizationUsers)
      .values(
        createOrganizationUser(org.id, inviter.id, { role: "owner" }) as never
      );
    await DbService.repository.invitations.create({
      id: generateId(),
      created: Date.now(),
      createdBy: inviter.id,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: org.id,
      email: email.toLowerCase(),
      role,
      tokenHash: `hash-${generateId()}`,
      status: "pending",
      expiresAt: Date.now() + 3_600_000,
      invitedByUserId: inviter.id,
      acceptedByUserId: null,
      acceptedAt: null,
    } as never);
    return org.id;
  }

  it("verified email with a pending invite → joins the invited org, no personal org", async () => {
    const email = `invitee-${generateId()}@example.com`;
    const invitedOrgId = await seedPendingInvite(email, "member");
    const auth0Sub = sub();

    const result = await ApplicationService.ensureProvisioned(
      auth0Sub,
      profileResolver({ email, emailVerified: true })
    );

    expect(result.created).toBe(true);
    expect(result.organization.id).toBe(invitedOrgId);
    expect(result.organizationUser.role).toBe("member");
    // No personal org was provisioned for the new user.
    expect(await orgsOwnedBy(result.user.id)).toHaveLength(0);
  });

  it("UNverified email with a pending invite → personal org (invite untouched)", async () => {
    const email = `invitee-${generateId()}@example.com`;
    await seedPendingInvite(email, "member");
    const auth0Sub = sub();

    const result = await ApplicationService.ensureProvisioned(
      auth0Sub,
      profileResolver({ email, emailVerified: false })
    );

    expect(result.created).toBe(true);
    // A personal owner-org was provisioned; the invite was not consumed.
    expect(result.organization.ownerUserId).toBe(result.user.id);
    expect(result.organizationUser.role).toBe("owner");
    const stillPending = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(invitations)
      .where(eq(invitations.email, email.toLowerCase()));
    expect(stillPending[0].status).toBe("pending");
  });

  it("existing user with no membership → personal org (invite branch not consulted)", async () => {
    // #583 case 6 preserved: an existing user fetches no profile, so the
    // verified-email branch never runs even if an invite exists for the email.
    const auth0Sub = sub();
    const existing = await DbService.repository.users.create(
      createUser(auth0Sub, { email: "existing@example.com" }) as never
    );
    await seedPendingInvite("existing@example.com", "member");

    const result = await ApplicationService.ensureProvisioned(
      auth0Sub,
      profileResolver({ email: "existing@example.com", emailVerified: true })
    );

    expect(result.created).toBe(true);
    expect(result.user.id).toBe(existing.id);
    expect(result.organization.ownerUserId).toBe(existing.id); // personal org
    expect(result.organizationUser.role).toBe("owner");
  });

  // ── deploy-mode provisioning fallback (#577, slice 4) ────────────────
  // The existing cases above all use the default fallback ("personal_org"),
  // proving SaaS self-serve is unchanged. These exercise the split.

  it("self_hosted join_single_org: first user → owner, second → member of the same org", async () => {
    const first = await ApplicationService.ensureProvisioned(
      sub(),
      profileResolver(),
      undefined,
      "join_single_org"
    );
    expect(first.created).toBe(true);
    expect(first.organizationUser.role).toBe("owner");

    const second = await ApplicationService.ensureProvisioned(
      sub(),
      profileResolver(),
      undefined,
      "join_single_org"
    );
    expect(second.created).toBe(true);
    expect(second.organizationUser.role).toBe("member");
    expect(second.organization.id).toBe(first.organization.id);
  });

  it("saas deny: enterprise-federated with no invite → 403 SSO_PROVISIONING_NOT_INVITED, no org", async () => {
    const auth0Sub = sub();
    await expect(
      ApplicationService.ensureProvisioned(
        auth0Sub,
        profileResolver({ emailVerified: true }),
        undefined,
        "deny"
      )
    ).rejects.toMatchObject({ code: ApiCode.SSO_PROVISIONING_NOT_INVITED });

    // The user row may exist, but no org was provisioned for them.
    const [u] = await usersFor(auth0Sub);
    if (u) expect(await orgsOwnedBy(u.id)).toHaveLength(0);
  });

  it("deny fallback but a pending invite exists → joins the invited org (invite wins)", async () => {
    const email = `invitee-${generateId()}@example.com`;
    const invitedOrgId = await seedPendingInvite(email, "member");

    const result = await ApplicationService.ensureProvisioned(
      sub(),
      profileResolver({ email, emailVerified: true }),
      undefined,
      "deny"
    );

    expect(result.created).toBe(true);
    expect(result.organization.id).toBe(invitedOrgId);
    expect(result.organizationUser.role).toBe("member");
  });

  // ── re-homed per-login audit/profile (#577, slice 6) ─────────────────

  it("recordLoginIfNewSession: new marker → auth.login + persists marker; repeat → no-op", async () => {
    const auth0Sub = sub();
    const p = await ApplicationService.ensureProvisioned(
      auth0Sub,
      profileResolver()
    );
    await new Promise((r) => setTimeout(r, 75));

    const loginRows = () =>
      (db as ReturnType<typeof drizzle>)
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.organizationId, p.organization.id),
            eq(auditLog.action, "auth.login")
          )
        );

    // Provision emitted one auth.login{firstLogin}.
    expect(await loginRows()).toHaveLength(1);

    const profile = jest.fn(async () => ({
      email: "refreshed@example.com",
      name: "Refreshed",
      picture: null,
      emailVerified: true,
    }));

    // A new session marker → a second auth.login + the marker persisted.
    await ApplicationService.recordLoginIfNewSession(
      p.user,
      p.organization.id,
      p.organizationUser,
      "at:1000",
      profile,
      { sourceIp: null, userAgent: null }
    );
    await new Promise((r) => setTimeout(r, 75));
    expect(await loginRows()).toHaveLength(2);
    const refreshed = (await usersFor(auth0Sub))[0];
    expect(refreshed.lastLoginSession).toBe("at:1000");
    expect(refreshed.name).toBe("Refreshed");

    // The same marker again → no new auth.login (deduped).
    await ApplicationService.recordLoginIfNewSession(
      refreshed as never,
      p.organization.id,
      p.organizationUser,
      "at:1000",
      profile,
      { sourceIp: null, userAgent: null }
    );
    await new Promise((r) => setTimeout(r, 75));
    expect(await loginRows()).toHaveLength(2);
  });
});
