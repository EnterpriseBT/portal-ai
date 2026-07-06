/**
 * Integration tests for the `organizations.tier` slug FK (#172, slice 2).
 *
 * Verifies that every org resolves a tier from day one: the `NOT NULL
 * DEFAULT 'standard'` fills the column (the same mechanism that backfills
 * pre-existing rows on `ADD COLUMN`), and the FK rejects an unknown slug.
 * Runs against the real DB harness (migrations applied, `standard` seeded).
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../utils/application.util.js";

describe("organizations.tier integration (#172 slice 2)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let userId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });

    await teardownOrg(db);

    const user = createUser(`auth0|${generateId()}`);
    await db.insert(schema.users).values(user as never);
    userId = user.id;
  });

  afterEach(async () => {
    await teardownOrg(db);
    await connection.end();
  });

  // ── case 34 (backfill mechanism) ────────────────────────────────────
  it("defaults `tier` to 'standard' when an org is inserted without it", async () => {
    const org = createOrganization(userId);
    await db.insert(schema.organizations).values(org as never);

    const [row] = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, org.id));

    // Same DEFAULT the migration applies to pre-existing rows on ADD COLUMN.
    expect(row.tier).toBe("standard");
  });

  // ── case 16 (FK integrity) ──────────────────────────────────────────
  it("FK rejects an org pointing at a nonexistent tier slug", async () => {
    const org = { ...createOrganization(userId), tier: "does-not-exist" };
    await expect(
      db.insert(schema.organizations).values(org as never)
    ).rejects.toThrow();
  });
});
