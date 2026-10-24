/**
 * `teardownOrg` under a held lock (#850).
 *
 * A suite's `beforeEach` once sat past Jest's 60s hook timeout inside
 * teardown, in CI only, with nothing in the log saying why. Deleting 10,002
 * rows takes ~36ms locally, so the time was a wait, not work. These pin the
 * teardown's answer to a wait: fail well inside the hook budget, and name
 * what held the lock, so the next occurrence carries its cause.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../../../db/schema/index.js";
import { teardownOrg } from "./application.util.js";

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

  it("clears every org's rows when nothing is in its way", async () => {
    await teardownOrg(db);
    const [{ n }] =
      await connection`select count(*)::int as n from organizations`;
    expect(n).toBe(0);
  });

  it("fails fast on a held lock, naming the session that holds it, instead of waiting out the hook", async () => {
    const reserved = await holder.reserve();
    await reserved`begin`;
    await reserved`lock table entity_records in access exclusive mode`;
    await reserved`select 'held by the #850 test' as marker`;

    const started = Date.now();
    let error: Error | undefined;
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
    // The blocker's own query, so the CI log says what held it.
    expect(error?.message).toContain("held by the #850 test");
  });
});
