import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

/**
 * #640: 0124 adds the pin definer and backfills it from `created_by`, so every
 * existing pin executes as the user who pinned it.
 */
describe("0124 pin-definer-columns (#640)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let orgId: string;
  let stationId: string;

  const sql = readFileSync(
    join(process.cwd(), "drizzle/0124_pin-definer-columns.sql"),
    "utf8"
  );
  // The columns exist in the test database (migrations ran at setup); the data
  // step is the UPDATE.
  const backfill = sql
    .split("--> statement-breakpoint")
    .find((s) => s.includes("UPDATE"))!;

  async function pin(createdBy: string, deleted: number | null = null) {
    const id = generateId();
    await db.insert(schema.portalResults).values({
      id,
      organizationId: orgId,
      stationId,
      portalId: null,
      name: "pin",
      type: "text",
      content: { value: "x" },
      // A stale value the backfill must overwrite.
      definerPrincipalType: "role",
      definerPrincipalId: "stale",
      created: Date.now(),
      createdBy,
      deleted,
      deletedBy: deleted ? createdBy : null,
    } as never);
    return async () =>
      (
        await db
          .select()
          .from(schema.portalResults)
          .where(eq(schema.portalResults.id, id))
      )[0];
  }

  beforeEach(async () => {
    connection = postgres(process.env.DATABASE_URL!, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    ({ organizationId: orgId } = await seedUserAndOrg(db, "auth0|pin-0124"));
    stationId = generateId();
    await db.insert(schema.stations).values({
      id: stationId,
      organizationId: orgId,
      name: "s",
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
    } as never);
  });

  afterEach(async () => {
    await teardownOrg(db);
    await connection.end();
  });

  it("backfills every pin's definer as its creator, deleted ones included", async () => {
    const live = await pin("user-a");
    const tombstoned = await pin("user-b", Date.now());

    await connection.unsafe(backfill);

    expect(await live()).toMatchObject({
      definerPrincipalType: "user",
      definerPrincipalId: "user-a",
    });
    expect(await tombstoned()).toMatchObject({
      definerPrincipalType: "user",
      definerPrincipalId: "user-b",
    });
  });

  it("leaves both columns NOT NULL", async () => {
    const cols = await connection<
      { column_name: string; is_nullable: string }[]
    >`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name = 'portal_results'
        AND column_name IN ('definer_principal_type', 'definer_principal_id')`;
    expect(cols).toHaveLength(2);
    expect(cols.every((c) => c.is_nullable === "NO")).toBe(true);
  });
});
