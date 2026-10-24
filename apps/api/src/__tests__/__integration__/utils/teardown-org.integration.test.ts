/**
 * `teardownOrg` under a held lock (#850).
 *
 * A suite's `beforeEach` once sat past Jest's 60s hook timeout inside
 * teardown, in CI only, with nothing in the log saying why. Deleting 10,002
 * rows takes ~36ms locally, so the time was a wait, not work. These pin the
 * teardown's answer to a wait: fail well inside the hook budget, and name
 * the session that blocked it, so the next occurrence carries its cause.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../../../db/schema/index.js";
import { seedUserAndOrg, teardownOrg } from "./application.util.js";

describe("teardownOrg (#850)", () => {
  let connection!: ReturnType<typeof postgres>;
  let holder!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;

  beforeEach(() => {
    connection = postgres(process.env.DATABASE_URL!, { max: 1 });
    holder = postgres(process.env.DATABASE_URL!, { max: 1 });
    db = drizzle(connection, { schema });
  });

  afterEach(async () => {
    await holder.end();
    await connection.end();
  });

  const count = async (table: string) =>
    (await connection.unsafe(`select count(*)::int as n from ${table}`))[0]!
      .n as number;

  it("clears an org, its user and its membership", async () => {
    await teardownOrg(db);
    await seedUserAndOrg(db, `auth0|teardown-${Date.now()}`);
    expect(await count("organizations")).toBeGreaterThan(0);

    await teardownOrg(db);

    expect(await count("organizations")).toBe(0);
    expect(await count("users")).toBe(0);
    expect(await count("organization_users")).toBe(0);
  });

  it("fails fast on a held lock, naming the table it waited on and the session that blocked it", async () => {
    const reserved = await holder.reserve();
    await reserved`begin`;
    await reserved`lock table entity_records in access exclusive mode`;
    await reserved`select 'held by the #850 test' as marker`;

    const started = Date.now();
    let error: (Error & { cause?: unknown }) | undefined;
    try {
      await teardownOrg(db, { lockTimeoutMs: 1_000 });
    } catch (err) {
      error = err as Error;
    } finally {
      await reserved`rollback`;
      reserved.release();
    }

    expect(Date.now() - started).toBeLessThan(10_000);
    expect(error?.message).toMatch(/lock/i);
    expect(error?.message).toContain("entity_records");
    // The blocker itself, found with pg_blocking_pids while teardown waited.
    expect(error?.message).toContain("held by the #850 test");
    expect(error?.cause).toBeDefined();
  });

  it("restores the connection's lock_timeout afterwards, even when it fails", async () => {
    const before = (await connection`show lock_timeout`)[0]!.lock_timeout;
    const reserved = await holder.reserve();
    await reserved`begin`;
    await reserved`lock table entity_records in access exclusive mode`;
    await teardownOrg(db, { lockTimeoutMs: 500 }).catch(() => undefined);
    await reserved`rollback`;
    reserved.release();

    expect((await connection`show lock_timeout`)[0]!.lock_timeout).toBe(before);
  });

  it("bounds the whole teardown, not just each wait", async () => {
    await expect(
      teardownOrg(db, { lockTimeoutMs: 1_000, budgetMs: 0 })
    ).rejects.toThrow(/budget/);
  });
});
