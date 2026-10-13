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
 * #769: 0120 adds `jobs.lock_scopes` and backfills it for the jobs that are
 * live when it runs, from each type's metadata, so a job started before the
 * deploy still locks its scope afterwards. Terminal jobs lock nothing.
 */
describe("0120 job-lock-scopes backfill (#769)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let orgId: string;

  // The column and index already exist in the test database (migrations ran
  // at setup); the data step is the UPDATE between the two breakpoints.
  const backfill = readFileSync(
    join(process.cwd(), "drizzle/0120_job-lock-scopes.sql"),
    "utf8"
  ).split("--> statement-breakpoint")[1];

  async function job(
    type: string,
    status: string,
    metadata: Record<string, unknown>
  ) {
    const id = generateId();
    await db.insert(schema.jobs).values({
      id,
      organizationId: orgId,
      type,
      status,
      progress: 0,
      metadata,
      attempts: 0,
      maxAttempts: 3,
      lockScopes: [],
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    return async () =>
      (await db.select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0]
        .lockScopes;
  }

  beforeEach(async () => {
    connection = postgres(process.env.DATABASE_URL!, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    ({ organizationId: orgId } = await seedUserAndOrg(db, "auth0|lock-0120"));
  });

  afterEach(async () => {
    await connection.end();
  });

  it("backfills each live job type from its metadata", async () => {
    const sync = await job("connector_sync", "active", {
      connectorInstanceId: "ci-1",
    });
    const clear = await job("entity_record_clear", "pending", {
      connectorInstanceId: "ci-2",
      connectorEntityId: "ce-9",
    });
    const reval = await job("revalidation", "stalled", {
      connectorEntityId: "ce-1",
    });
    const geocode = await job("bulk_geocode", "awaiting_confirmation", {
      connectorEntityId: "ce-2",
      targetConnectorEntityIds: ["ce-2"],
    });
    const transform = await job("bulk_transform", "active", {
      sourceConnectorEntityId: "src",
      targetConnectorEntityIds: ["t1", "src"],
    });
    const query = await job("sql_query", "active", {});

    await connection.unsafe(backfill);

    expect(await sync()).toEqual(["instance:ci-1"]);
    expect(await clear()).toEqual(["instance:ci-2"]);
    expect(await reval()).toEqual(["entity:ce-1"]);
    expect(await geocode()).toEqual(["entity:ce-2"]);
    expect([...(await transform())].sort()).toEqual([
      "entity:src",
      "entity:t1",
    ]);
    expect(await query()).toEqual([]);
  });

  it("leaves terminal jobs locking nothing", async () => {
    const done = await job("revalidation", "completed", {
      connectorEntityId: "ce-1",
    });
    const failed = await job("connector_sync", "failed", {
      connectorInstanceId: "ci-1",
    });

    await connection.unsafe(backfill);

    expect(await done()).toEqual([]);
    expect(await failed()).toEqual([]);
  });

  it("a live job missing its id locks nothing rather than a blank scope", async () => {
    const bare = await job("revalidation", "active", {});

    await connection.unsafe(backfill);

    expect(await bare()).toEqual([]);
  });
});
