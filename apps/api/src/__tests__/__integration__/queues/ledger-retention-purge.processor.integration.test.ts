/**
 * Integration tests for the ledger retention purge (#179 D5, case 17).
 *
 * The processor is a pure DELETE loop against Postgres — driven directly
 * (no Redis needed). The scheduler-registration upsert-shape is asserted
 * against real Redis from docker-compose.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
} from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import * as schema from "../../../db/schema/index.js";
import { generateId } from "../utils/application.util.js";
import { environment } from "../../../environment.js";
import { ledgerRetentionPurgeProcessor } from "../../../queues/processors/ledger-retention-purge.processor.js";
import {
  getMaintenanceQueue,
  closeMaintenanceQueue,
  registerMaintenanceSchedulers,
  LEDGER_RETENTION_PURGE_JOB,
} from "../../../queues/maintenance.queue.js";

const { toolUsageLedger, organizations, users } = schema;

const RETENTION_MS =
  environment.LEDGER_RETENTION_MONTHS * 30 * 24 * 60 * 60 * 1000;

describe("ledgerRetentionPurgeProcessor (#179 case 17)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let orgId!: string;

  beforeEach(async () => {
    connection = postgres(process.env.DATABASE_URL!, { max: 1 });
    db = drizzle(connection, { schema });

    await db.delete(toolUsageLedger);

    // Minimal FK chain: user → org.
    const userId = generateId();
    const now = Date.now();
    await db.insert(users).values({
      id: userId,
      auth0Id: `auth0|purge-${generateId()}`,
      email: `purge-${generateId()}@example.com`,
      name: "Purge Test",
      lastLogin: now,
      picture: null,
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    orgId = generateId();
    await db.insert(organizations).values({
      id: orgId,
      name: "Purge Org",
      timezone: "UTC",
      ownerUserId: userId,
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
  });

  afterEach(async () => {
    await connection.end();
  });

  afterAll(async () => {
    await closeMaintenanceQueue();
  });

  const seedRow = async (created: number, label: string) => {
    await db.insert(toolUsageLedger).values({
      id: generateId(),
      created,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: orgId,
      toolName: label,
      toolCallId: `call_${generateId()}`,
      stationId: "station-1",
      portalId: null,
      costClass: "metered",
      units: 1,
      periodId: "2024-01",
      userId: "user-1",
    } as never);
  };

  it("purges only rows older than the cutoff, in batches, and reports the summary", async () => {
    const now = Date.now();
    // Three expired rows (past the retention window) + two fresh ones.
    await seedRow(now - RETENTION_MS - 3_000, "expired-a");
    await seedRow(now - RETENTION_MS - 2_000, "expired-b");
    await seedRow(now - RETENTION_MS - 1_000, "expired-c");
    await seedRow(now - 1_000, "fresh-a");
    await seedRow(now, "fresh-b");

    // batchSize 2 forces multiple delete rounds (3 rows → 2 batches).
    const summary = await ledgerRetentionPurgeProcessor({
      batchSize: 2,
      now,
    });

    expect(summary.purged).toBe(3);
    expect(summary.batches).toBe(2);
    expect(new Date(summary.cutoff).getTime()).toBe(now - RETENTION_MS);

    const remaining = await db
      .select()
      .from(toolUsageLedger)
      .where(eq(toolUsageLedger.organizationId, orgId));
    expect(remaining.map((r) => r.toolName).sort()).toEqual([
      "fresh-a",
      "fresh-b",
    ]);
  });

  it("is a no-op on an already-drained table", async () => {
    await seedRow(Date.now(), "fresh-only");

    const summary = await ledgerRetentionPurgeProcessor();

    expect(summary.purged).toBe(0);
    expect(summary.batches).toBe(0);
  });

  it("scheduler registration is upsert-shaped — double-boot yields one scheduler", async () => {
    await registerMaintenanceSchedulers();
    await registerMaintenanceSchedulers();

    const schedulers = await getMaintenanceQueue().getJobSchedulers();
    const purgeSchedulers = schedulers.filter(
      (s) => s.key === LEDGER_RETENTION_PURGE_JOB
    );
    expect(purgeSchedulers).toHaveLength(1);
    expect(purgeSchedulers[0]!.pattern).toBe("0 4 * * *");
  });
});
