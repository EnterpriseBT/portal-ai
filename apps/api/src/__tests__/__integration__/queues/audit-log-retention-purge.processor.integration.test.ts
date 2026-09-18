/**
 * Integration tests for the audit-log retention purge (#575 slice 5).
 *
 * The processor is a DELETE loop against Postgres (driven directly, no Redis).
 * `deleteOlderThan` sets the app.audit_retention_purge flag so the append-only
 * trigger permits its DELETEs. The scheduler-registration upsert is asserted
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
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";

import * as schema from "../../../db/schema/index.js";
import { generateId } from "../utils/application.util.js";
import { environment } from "../../../environment.js";
import { auditLogRetentionPurgeProcessor } from "../../../queues/processors/audit-log-retention-purge.processor.js";
import {
  getMaintenanceQueue,
  closeMaintenanceQueue,
  registerMaintenanceSchedulers,
  AUDIT_LOG_RETENTION_PURGE_JOB,
} from "../../../queues/maintenance.queue.js";

const { auditLog, organizations, users } = schema;

const RETENTION_MS =
  environment.AUDIT_LOG_RETENTION_MONTHS * 30 * 24 * 60 * 60 * 1000;

describe("auditLogRetentionPurgeProcessor (#575 slice 5)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let orgId!: string;

  async function purgeAuditLog() {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL app.audit_retention_purge = 'on'`);
      await tx.delete(auditLog);
    });
  }

  beforeEach(async () => {
    connection = postgres(process.env.DATABASE_URL!, { max: 1 });
    db = drizzle(connection, { schema });

    await purgeAuditLog();

    const userId = generateId();
    const now = Date.now();
    await db.insert(users).values({
      id: userId,
      auth0Id: `auth0|apurge-${generateId()}`,
      email: `apurge-${generateId()}@example.com`,
      name: "Audit Purge Test",
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
      name: "Audit Purge Org",
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
    await purgeAuditLog();
    await connection.end();
  });

  afterAll(async () => {
    await closeMaintenanceQueue();
  });

  const seedRow = async (created: number, label: string) => {
    await db.insert(auditLog).values({
      id: generateId(),
      created,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: orgId,
      userId: "user-1",
      action: "auth.login",
      targetType: null,
      targetId: null,
      outcome: "success",
      sourceIp: null,
      userAgent: null,
      metadata: { label },
    } as never);
  };

  it("purges only rows older than the cutoff, in batches, and reports the summary", async () => {
    const now = Date.now();
    await seedRow(now - RETENTION_MS - 3_000, "expired-a");
    await seedRow(now - RETENTION_MS - 2_000, "expired-b");
    await seedRow(now - RETENTION_MS - 1_000, "expired-c");
    await seedRow(now - 1_000, "fresh-a");
    await seedRow(now, "fresh-b");

    // batchSize 2 forces multiple delete rounds (3 expired → 2 batches).
    const summary = await auditLogRetentionPurgeProcessor({
      batchSize: 2,
      now,
    });

    expect(summary.purged).toBe(3);
    expect(summary.batches).toBe(2);
    expect(new Date(summary.cutoff).getTime()).toBe(now - RETENTION_MS);

    const remaining = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.organizationId, orgId));
    expect(
      remaining.map((r) => (r.metadata as { label: string }).label).sort()
    ).toEqual(["fresh-a", "fresh-b"]);
  });

  it("is a no-op on an already-drained table", async () => {
    await seedRow(Date.now(), "fresh-only");
    const summary = await auditLogRetentionPurgeProcessor();
    expect(summary.purged).toBe(0);
    expect(summary.batches).toBe(0);
  });

  it("registers the audit-log purge as a repeatable scheduler", async () => {
    await registerMaintenanceSchedulers();
    const schedulers = await getMaintenanceQueue().getJobSchedulers();
    const ids = schedulers.map((s) => s.key ?? s.id);
    expect(ids).toContain(AUDIT_LOG_RETENTION_PURGE_JOB);
  });
});
