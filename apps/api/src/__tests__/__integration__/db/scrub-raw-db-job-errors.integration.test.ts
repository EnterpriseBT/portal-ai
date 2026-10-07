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
 * #719: 0119 rewrites job errors that already hold the database's own text
 * (SQL + params, or the old formatter's pg message/detail/SQLSTATE), and a
 * draft commit's raw message on a connector instance. Upstream, network,
 * parse and stall text is left alone.
 */
describe("0119 scrub-raw-db-job-errors (#719)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let orgId: string;

  const migration = readFileSync(
    join(process.cwd(), "drizzle/0119_scrub-raw-db-job-errors.sql"),
    "utf8"
  );
  const runMigration = async () => {
    for (const statement of migration.split("--> statement-breakpoint")) {
      await connection.unsafe(statement);
    }
  };

  async function jobWithError(error: string) {
    const id = generateId();
    await db.insert(schema.jobs).values({
      id,
      organizationId: orgId,
      type: "connector_sync",
      status: "failed",
      progress: 0,
      metadata: {},
      attempts: 1,
      maxAttempts: 3,
      error,
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    return async () =>
      (await db.select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0]
        .error;
  }

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    ({ organizationId: orgId } = await seedUserAndOrg(
      db,
      "auth0|scrub-job-errors"
    ));
  });

  afterEach(async () => {
    await connection.end();
  });

  it("rewrites raw database text and leaves everything else alone", async () => {
    const sqlText = await jobWithError(
      'Failed query: insert into "entity_records" values ($1)\nparams: secret-source'
    );
    const pgText = await jobWithError(
      'duplicate key value violates unique constraint "uq_x" | detail: Key (source_id)=(secret-source) already exists. | code: 23505 | constraint: uq_x'
    );
    const outOfBand = await jobWithError(
      "Attempt ended out-of-band (canceling statement due to user request | code: 57014)"
    );
    const upstream = await jobWithError(
      "other side closed | code: UND_ERR_SOCKET"
    );
    const pipe = await jobWithError("write EPIPE | code: EPIPE");
    const stall = await jobWithError("job stalled more than allowable limit");

    await runMigration();
    // Idempotent: the replacement text matches neither pattern.
    await runMigration();

    expect(await sqlText()).toBe("Database error. See the server log.");
    expect(await pgText()).toBe(
      "Database error (SQLSTATE 23505). See the server log."
    );
    expect(await outOfBand()).toBe(
      "Database error (SQLSTATE 57014). See the server log."
    );
    expect(await upstream()).toBe("other side closed | code: UND_ERR_SOCKET");
    expect(await pipe()).toBe("write EPIPE | code: EPIPE");
    expect(await stall()).toBe("job stalled more than allowable limit");
  });
});
