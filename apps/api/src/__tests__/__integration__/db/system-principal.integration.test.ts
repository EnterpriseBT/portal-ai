/**
 * #956: the database records the system principal it was provisioned with
 * (0134), and `runMigrations` refuses a different SYSTEM_ID before applying
 * anything.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import postgres from "postgres";

import { environment } from "../../../environment.js";
import { runMigrations } from "../../../scripts/db-migrate.js";
import {
  readSystemPrincipal,
  recordSystemPrincipal,
  type SqlRunner,
} from "../../../db/system-principal.util.js";

const PRINCIPAL = process.env.SYSTEM_ID!;

describe("system_principal (#956)", () => {
  let sql!: ReturnType<typeof postgres>;
  let run!: SqlRunner;

  beforeEach(async () => {
    sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    run = (text, params) => sql.unsafe(text, params as never[]);
    // The global setup truncates every table, this one included, before it
    // migrates; record as the runner does after a migrate.
    await recordSystemPrincipal(run, PRINCIPAL);
  });

  afterEach(async () => {
    await sql.end();
  });

  it("records the principal the database was migrated with", async () => {
    expect(await readSystemPrincipal(run)).toBe(PRINCIPAL);
  });

  it("holds one row, and a second record is a no-op", async () => {
    await recordSystemPrincipal(run, "SOMEONE-ELSE");
    const rows = await sql`SELECT id FROM system_principal`;
    expect(rows.map((r) => r.id)).toEqual([PRINCIPAL]);
  });

  it("re-records after the table is emptied", async () => {
    await sql`DELETE FROM system_principal`;
    expect(await readSystemPrincipal(run)).toBeNull();
    await recordSystemPrincipal(run, PRINCIPAL);
    expect(await readSystemPrincipal(run)).toBe(PRINCIPAL);
  });

  it("refuses a migrate under a different SYSTEM_ID, before applying", async () => {
    const [before] =
      await sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`;
    const saved = environment.SYSTEM_ID;
    environment.SYSTEM_ID = "SOMEONE-ELSE";
    try {
      await expect(runMigrations()).rejects.toThrow(
        /SYSTEM_ID "SOMEONE-ELSE" doesn't match the "[^"]+" this database was provisioned with/
      );
    } finally {
      environment.SYSTEM_ID = saved;
    }
    const [after] =
      await sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`;
    expect(after.n).toBe(before.n);
    expect(await readSystemPrincipal(run)).toBe(PRINCIPAL);
  });

  it("migrates under the recorded SYSTEM_ID", async () => {
    await expect(runMigrations()).resolves.toBeUndefined();
    expect(await readSystemPrincipal(run)).toBe(PRINCIPAL);
  });
});
