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
 * #640: 0125 reduces every stored data pin to its recipe. Pins saved before
 * #640 copied their whole source block, so the strip is an allowlist per type:
 * nothing data-bearing (`rows`, `samplePeek`, counts, a handle) may survive,
 * on live and soft-deleted pins alike. Text pins are untouched.
 */
describe("0125 strip-pin-snapshots (#640)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let orgId: string;
  let stationId: string;

  // The column drop already ran in the test database (migrations ran at
  // setup); the data step is the UPDATE before the breakpoint.
  const strip = readFileSync(
    join(process.cwd(), "drizzle/0125_strip-pin-snapshots.sql"),
    "utf8"
  ).split("--> statement-breakpoint")[0];

  const PIPELINE = { sql: "SELECT 1", stationId: "s", organizationId: "o" };
  const DATA = {
    rows: [{ a: 1 }],
    samplePeek: [{ a: 1 }],
    rowCount: 1,
    matchedCount: 1,
    matchedCountExact: true,
    truncated: false,
    queryHandle: "qh-old",
    schema: [{ name: "a", type: "int" }],
    sql: "SELECT 1",
  };

  async function pin(
    type: "text" | "data-table" | "d3" | "geo",
    content: unknown,
    deleted: number | null = null
  ) {
    const id = generateId();
    await db.insert(schema.portalResults).values({
      id,
      organizationId: orgId,
      stationId,
      portalId: null,
      name: "pin",
      type,
      content,
      definerPrincipalType: "user",
      definerPrincipalId: "SYSTEM_TEST",
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
      deleted,
      deletedBy: deleted ? "SYSTEM_TEST" : null,
    } as never);
    return async () =>
      (
        await db
          .select()
          .from(schema.portalResults)
          .where(eq(schema.portalResults.id, id))
      )[0].content;
  }

  beforeEach(async () => {
    connection = postgres(process.env.DATABASE_URL!, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    ({ organizationId: orgId } = await seedUserAndOrg(db, "auth0|pin-0125"));
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

  it("keeps each data kind's recipe and nothing data-bearing", async () => {
    const spec = { layers: [] };
    const table = await pin("data-table", {
      columns: ["a"],
      pipeline: PIPELINE,
      ...DATA,
    });
    const chart = await pin("d3", {
      program: "api.d3;",
      title: "T",
      params: { k: null },
      pipeline: PIPELINE,
      ...DATA,
    });
    const map = await pin("geo", {
      spec,
      pipeline: PIPELINE,
      tiled: true,
      ...DATA,
    });

    await connection.unsafe(strip);

    expect(await table()).toEqual({ columns: ["a"], pipeline: PIPELINE });
    // A null nested in the recipe survives (no null-stripping).
    expect(await chart()).toEqual({
      program: "api.d3;",
      title: "T",
      params: { k: null },
      pipeline: PIPELINE,
    });
    expect(await map()).toEqual({ spec, pipeline: PIPELINE, tiled: true });
  });

  it("strips soft-deleted pins too, and a pin left with no recipe keeps none", async () => {
    const deleted = await pin(
      "data-table",
      { columns: ["a"], pipeline: PIPELINE, ...DATA },
      Date.now()
    );
    const legacy = await pin("data-table", { queryHandle: "qh-dead" });

    await connection.unsafe(strip);

    expect(await deleted()).toEqual({ columns: ["a"], pipeline: PIPELINE });
    expect(await legacy()).toEqual({});
  });

  it("leaves text pins untouched", async () => {
    const text = await pin("text", "## Notes");
    await connection.unsafe(strip);
    expect(await text()).toBe("## Notes");
  });

  it("drops the snapshot clock", async () => {
    const cols = await connection<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'portal_results' AND column_name = 'snapshot_updated_at'`;
    expect(cols).toHaveLength(0);
  });
});
