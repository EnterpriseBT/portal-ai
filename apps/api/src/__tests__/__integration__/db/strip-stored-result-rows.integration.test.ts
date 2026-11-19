import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import { stripStoredMessage } from "../../../services/stored-result.util.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

/**
 * #1038: portal messages stored result rows (inline tables, samples, handles,
 * raw tool results). 0136 removes them at rest, producing exactly what
 * `stripStoredMessage` serves, so the database and the API agree on what a
 * stored message is. A second run changes nothing.
 */
describe("0136 strip-stored-result-rows (#1038)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let orgId: string;
  let portalId: string;

  const migration = readFileSync(
    join(process.cwd(), "drizzle/0136_strip-stored-result-rows.sql"),
    "utf8"
  );
  const runMigration = async () => {
    for (const statement of migration.split("--> statement-breakpoint")) {
      await connection.unsafe(statement);
    }
  };

  const pipeline = {
    sql: "SELECT name FROM contacts",
    stationId: "st-1",
    organizationId: "org-1",
  };
  const rows = [{ name: "Acme" }, { name: "Bolt" }, { name: "Cog" }];

  /** Every stored shape a message from before #1038 can hold. */
  const legacyBlocks = [
    { type: "text", content: "Here are the contacts." },
    {
      type: "tool-call",
      toolCallId: "tc-1",
      toolName: "sql_query",
      input: { sql: pipeline.sql },
    },
    {
      type: "tool-result",
      toolCallId: "tc-1",
      toolName: "sql_query",
      content: { rows, pipeline },
    },
    {
      type: "tool-result",
      toolCallId: "tc-2",
      toolName: "display_entity_records",
      content: {
        type: "data-table",
        queryHandle: "qh-1",
        rowCount: 3,
        schema: [{ name: "name", type: "text" }],
        samplePeek: rows,
        sql: pipeline.sql,
      },
    },
    { type: "tool-result", toolCallId: "tc-3", toolName: "x", content: rows },
    {
      type: "tool-result",
      toolCallId: "tc-5",
      toolName: "list_view_ids",
      content: ["v-1", "v-2"],
    },
    {
      type: "tool-result",
      toolCallId: "tc-6",
      toolName: "mixed",
      content: [{ id: "v-1" }, "v-2"],
    },
    {
      type: "tool-result",
      toolCallId: "tc-4",
      toolName: "create_entity",
      content: { success: true, entityId: "e-1" },
    },
    {
      type: "data-table",
      content: { type: "data-table", columns: ["name"], rows, pipeline },
    },
    {
      type: "d3",
      content: {
        type: "d3",
        program: "api.d3;",
        queryHandle: "qh-2",
        rowCount: 3,
        schema: [{ name: "name", type: "text" }],
        samplePeek: rows,
        sampled: false,
        truncated: false,
        sql: pipeline.sql,
        pipeline,
      },
    },
    {
      type: "geo",
      content: { type: "geo", spec: { layers: [] }, rows, pipeline },
    },
    {
      type: "data-table",
      content: { type: "data-table", columns: ["name"], rows },
    },
    {
      type: "data-table",
      content: {
        type: "data-table",
        queryHandle: "qh-3",
        rowCount: 9,
        schema: [{ name: "name", type: "text" }],
        samplePeek: rows,
      },
    },
  ];

  async function message(blocks: unknown[]) {
    const id = generateId();
    await db.insert(schema.portalMessages).values({
      id,
      organizationId: orgId,
      portalId,
      role: "assistant",
      blocks,
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    return id;
  }

  async function blocksOf(id: string) {
    const [row] = await db
      .select({ blocks: schema.portalMessages.blocks })
      .from(schema.portalMessages)
      .where(eq(schema.portalMessages.id, id));
    return row.blocks;
  }

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    let userId: string;
    ({ organizationId: orgId, userId } = await seedUserAndOrg(
      db,
      "auth0|strip-stored-result-rows"
    ));
    const stationId = generateId();
    await db.insert(schema.stations).values({
      id: stationId,
      organizationId: orgId,
      name: "Station",
      description: null,
      created: Date.now(),
      createdBy: userId,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    portalId = generateId();
    await db.insert(schema.portals).values({
      id: portalId,
      organizationId: orgId,
      stationId,
      name: "Portal",
      created: Date.now(),
      createdBy: userId,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
  });

  afterEach(async () => {
    await teardownOrg(db);
    await connection.end();
  });

  it("strips every stored result to exactly what the API serves", async () => {
    const id = await message(legacyBlocks);

    await runMigration();

    const stored = await blocksOf(id);
    expect(stored).toEqual(stripStoredMessage({ blocks: legacyBlocks }).blocks);
    expect(JSON.stringify(stored)).not.toContain("Acme");
  });

  it("leaves a message with no stored rows alone, and a second run is a no-op", async () => {
    const plain = [{ type: "text", content: "No results here." }];
    const plainId = await message(plain);
    const id = await message(legacyBlocks);

    await runMigration();
    const once = await blocksOf(id);
    await runMigration();

    expect(await blocksOf(id)).toEqual(once);
    expect(await blocksOf(plainId)).toEqual(plain);
  });
});
