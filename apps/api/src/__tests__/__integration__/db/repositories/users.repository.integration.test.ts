/**
 * Integration tests for the UsersRepository (#583, slice 1).
 *
 * `findOrCreateByAuth0Id` is the idempotency gate for first-login provisioning:
 * INSERT … ON CONFLICT (auth0_id) WHERE deleted IS NULL DO NOTHING → re-read.
 * Exercised against the real DB harness, including a concurrent double-insert
 * (two connections racing the same Auth0 sub) and the partial-index semantics
 * (a soft-deleted row does not block a fresh registration).
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";

import { UsersRepository } from "../../../../db/repositories/users.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import { generateId, createUser } from "../../utils/application.util.js";

describe("UsersRepository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: UsersRepository;
  const createdAuth0Ids: string[] = [];

  const sub = () => {
    const s = `auth0|${generateId()}`;
    createdAuth0Ids.push(s);
    return s;
  };

  beforeEach(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 4 });
    db = drizzle(connection, { schema });
    repo = new UsersRepository();
  });

  afterEach(async () => {
    const client = db as ReturnType<typeof drizzle>;
    if (createdAuth0Ids.length) {
      await client
        .delete(schema.users)
        .where(inArray(schema.users.auth0Id, createdAuth0Ids));
      createdAuth0Ids.length = 0;
    }
    await connection.end();
  });

  // ── case 1: find-or-create idempotency ──────────────────────────────

  it("creates a new user on first call, returns the same row (created:false) on repeat", async () => {
    const auth0Id = sub();

    const first = await repo.findOrCreateByAuth0Id(
      createUser(auth0Id) as never,
      db
    );
    const second = await repo.findOrCreateByAuth0Id(
      createUser(auth0Id) as never,
      db
    );

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.user.id).toBe(first.user.id);

    const rows = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.users)
      .where(eq(schema.users.auth0Id, auth0Id));
    expect(rows.length).toBe(1);
  });

  it("concurrent first-login for the same sub yields exactly one user, one creator", async () => {
    const auth0Id = sub();

    const [a, b] = await Promise.all([
      repo.findOrCreateByAuth0Id(createUser(auth0Id) as never, db),
      repo.findOrCreateByAuth0Id(createUser(auth0Id) as never, db),
    ]);

    // Exactly one racer creates; both resolve to the same row.
    expect([a, b].filter((r) => r.created).length).toBe(1);
    expect(a.user.id).toBe(b.user.id);

    const rows = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.users)
      .where(eq(schema.users.auth0Id, auth0Id));
    expect(rows.length).toBe(1);
  });

  // ── case 2: partial-index semantics ─────────────────────────────────

  it("the partial unique index rejects a second live row for one sub", async () => {
    const auth0Id = sub();
    const client = db as ReturnType<typeof drizzle>;

    await client.insert(schema.users).values(createUser(auth0Id) as never);

    // A raw insert that bypasses ON CONFLICT must be rejected by the index.
    await expect(
      client.insert(schema.users).values(createUser(auth0Id) as never)
    ).rejects.toThrow();
  });

  it("a soft-deleted row does not block a fresh registration of the same sub", async () => {
    const auth0Id = sub();
    const client = db as ReturnType<typeof drizzle>;

    // A tombstoned prior user for this sub.
    await client
      .insert(schema.users)
      .values(createUser(auth0Id, { deleted: Date.now() }) as never);

    // Registration succeeds — the partial index only covers live rows.
    const { user, created } = await repo.findOrCreateByAuth0Id(
      createUser(auth0Id) as never,
      db
    );
    expect(created).toBe(true);
    expect(user.deleted).toBeNull();

    // findByAuth0Id resolves the live row, not the tombstone.
    const live = await repo.findByAuth0Id(auth0Id, db);
    expect(live?.id).toBe(user.id);
  });
});
