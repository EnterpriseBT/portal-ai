/**
 * #956: the database records the system principal it was provisioned with
 * (0134), and `runMigrations` refuses a different SYSTEM_ID before applying
 * anything.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../../../db/schema/index.js";
import { teardownOrg } from "../utils/application.util.js";
import { seedPopulatedOrg } from "../utils/seed-populated-org.util.js";

import { environment } from "../../../environment.js";
import { runMigrations } from "../../../scripts/db-migrate.js";
import {
  ensureSystemPrincipal,
  readSystemPrincipal,
  recordSystemPrincipal,
  SystemPrincipalMismatchError,
  type SqlRunner,
} from "../../../db/system-principal.util.js";

const PRINCIPAL = process.env.SYSTEM_ID!;

const MIGRATION_0134 = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../drizzle/0134_system-principal.sql"
  ),
  "utf8"
)
  .split("--> statement-breakpoint")
  .map((stmt) => stmt.trim())
  .filter(Boolean);

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

  it("a concurrent first record under another id is refused on the re-check", async () => {
    // The other principal won the race: its row is already there.
    await sql`DELETE FROM system_principal`;
    await recordSystemPrincipal(run, "WON-THE-RACE");
    await expect(ensureSystemPrincipal(run, PRINCIPAL)).rejects.toBeInstanceOf(
      SystemPrincipalMismatchError
    );
    await sql`DELETE FROM system_principal`;
    await recordSystemPrincipal(run, PRINCIPAL);
  });

  it("0134 refuses to record a principal the platform rows don't carry", async () => {
    // A connector definition seeded under this run's principal, like the
    // global seed writes.
    const d = drizzle(sql, { schema });
    await teardownOrg(d);
    await seedPopulatedOrg(d, "sp956");
    const apply = (principal: string) =>
      sql.begin(async (tx) => {
        await tx`SELECT set_config('portalai.system_id', ${principal}, true)`;
        for (const stmt of MIGRATION_0134) await tx.unsafe(stmt);
      });
    try {
      await expect(apply("SOMEONE-ELSE")).rejects.toThrow(
        /SYSTEM_ID SOMEONE-ELSE doesn't match this database's platform rows/
      );
      await apply(PRINCIPAL); // the principal the rows carry: applies
    } finally {
      await teardownOrg(d);
    }
  });

  it("migrates under the recorded SYSTEM_ID", async () => {
    await expect(runMigrations()).resolves.toBeUndefined();
    expect(await readSystemPrincipal(run)).toBe(PRINCIPAL);
  });
});
