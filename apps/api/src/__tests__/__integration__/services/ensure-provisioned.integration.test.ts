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
import {
  generateId,
  createUser,
  teardownOrg,
} from "../utils/application.util.js";

const { users, organizations, auditLog } = schema;

/** A profile resolver that records how many times it was asked. */
const profileResolver = () =>
  jest.fn(async () => ({
    email: `resolved-${generateId()}@example.com`,
    name: "Resolved User",
    picture: null,
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
    await teardownOrg(db as ReturnType<typeof drizzle>);
    await connection.end();
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
});
