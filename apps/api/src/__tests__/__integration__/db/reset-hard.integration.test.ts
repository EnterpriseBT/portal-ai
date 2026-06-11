/**
 * Integration smoke for #106 — `db:reset:hard` must drop `er__*`
 * wide tables, not just truncate them, otherwise they orphan when
 * the owning `connector_entities` row goes away.
 *
 * Doesn't invoke the full `resetHard()` (that would nuke the static
 * schema other tests rely on). Instead: create a real `er__<uuid>`
 * table, run the same partition + DROP path the script uses, and
 * verify the table is gone from `pg_tables`. The unit test covers
 * `partitionTables` itself; this test proves the DROP SQL actually
 * works against the real DB (quoting, UUID names with hyphens, etc).
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

import { partitionTables } from "../../../db/reset-hard.js";

describe("reset-hard — DROP wide tables (#106)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;

  beforeAll(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection);
  });

  afterAll(async () => {
    await connection.end();
  });

  it("partitions an `er__*` table into the DROP set and removes it from the schema", async () => {
    const tableName = `er__reset-hard-smoke-${Date.now()}`;
    await db.execute(
      sql.raw(
        `CREATE TABLE "${tableName}" (id text PRIMARY KEY)`
      )
    );

    const present = await db.execute<{ tablename: string }>(sql`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename = ${tableName}
    `);
    expect(present.length).toBe(1);

    // Drive the same partition the script uses against the live
    // schema and confirm our created table is identified as a wide
    // table to drop.
    const allTables = (
      await db.execute<{ tablename: string }>(sql`
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      `)
    ).map((r) => r.tablename);
    const { toDrop, toTruncate } = partitionTables(allTables);
    expect(toDrop).toContain(tableName);
    // Sanity-check the negative side: the static schema (which the
    // migrations create on integration setup) is on the truncate
    // side, not the drop side. `users` is one of the simplest
    // shared rows.
    expect(toTruncate).toContain("users");
    expect(toDrop).not.toContain("users");

    // Drop ONLY the table this test created, so we don't disturb
    // any `er__*` tables other integration tests may have left
    // behind. The end-to-end "DROP every `er__*`" path is exercised
    // when the script runs locally; here we just need to prove the
    // SQL works on a hyphen-bearing UUID-like name.
    await db.execute(sql.raw(`DROP TABLE "${tableName}" CASCADE`));

    const after = await db.execute<{ tablename: string }>(sql`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename = ${tableName}
    `);
    expect(after.length).toBe(0);
  });
});
