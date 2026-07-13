/**
 * Multi-write smoke — slice 5 acceptance test for #99.
 *
 * Exercises the per-target write fan-out end-to-end against a real
 * BullMQ worker + Redis + PG seed. Three cases:
 *
 *   5.1 — Two writes against ONE target (same record, two columns).
 *         The fan-out collapses to a single upsertSuccesses call
 *         carrying both columns in each success's value object.
 *
 *   5.2 — Cross-target writes (same record, two targets). The
 *         fan-out runs one upsertSuccesses per target; metadata's
 *         denormalized `targetConnectorEntityIds` carries the sorted
 *         union.
 *
 *   5.3 — Per-target failure isolation. Target B's upsertSuccesses
 *         throws; target A commits anyway; partialFailures entries
 *         carry `{ targetConnectorEntityId, column }` attribution.
 *
 * The SQL seams (`upsertSuccesses`, `fetchSourceBatch`) are mocked
 * so the test stays focused on the fan-out control flow; the live
 * SQL is covered by smoke A + smoke C and is unchanged here.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import postgres from "postgres";
import { Queue, Worker } from "bullmq";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import {
  generateId,
  teardownOrg,
  seedUserAndOrg,
} from "../utils/application.util.js";
import { connectionOpts, uniqueQueueName } from "./queue.util.js";

// ── Mock SQL seams + tool lookup ─────────────────────────────────────

const SOURCE_BATCH_SIZE = 10;
const sourceRows = Array.from({ length: SOURCE_BATCH_SIZE }, (_, i) => ({
  entity_record_id: `r-${i}`,
  organization_id: "org-stub",
  source_id: `p-${i}`,
}));

interface UpsertSuccessesArgs {
  targetConnectorEntityId: string;
  organizationId: string;
  jobId: string;
  successes: Array<{ sourceKey: string; value: Record<string, unknown> }>;
  userId: string;
}

// Test-controlled hooks the mocked BulkTransformService dispatches
// into. Reset in beforeEach; overridden per test for 5.3.
const upsertCalls: UpsertSuccessesArgs[] = [];
let upsertImpl: (
  opts: UpsertSuccessesArgs
) => Promise<{ rowsUpserted: number; droppedKeys: string[] }> = async (
  opts
) => ({
  rowsUpserted: opts.successes.length,
  droppedKeys: [],
});

jest.unstable_mockModule("../../../services/bulk-transform.service.js", () => ({
  BulkTransformService: {
    countSourceRows: async () => sourceRows.length,
    fetchSourceBatch: async (opts: { offset: number; batchSize: number }) =>
      sourceRows.slice(opts.offset, opts.offset + opts.batchSize),
    upsertSuccesses: async (opts: UpsertSuccessesArgs) => {
      upsertCalls.push(opts);
      return upsertImpl(opts);
    },
    explainExpression: async () => undefined,
    runBatch: async () => ({ rowsCommitted: 0, rows: [] }),
  },
}));

jest.unstable_mockModule("../../../services/tools.service.js", () => ({
  ToolService: {
    lookupBulkDispatchable: async () => ({
      // Tool returns a structured object per record. shapeWritesForRecord
      // picks values out of it via tool_path (`km` / `miles`) or copies
      // the whole result via tool_result.
      executor: async () => ({ km: 5, miles: 3.1 }),
      metadata: {
        maxConcurrency: 4,
        timeoutMs: 5_000,
        idempotent: true,
      },
    }),
  },
}));

const { bulkTransformProcessor } =
  await import("../../../queues/processors/bulk-transform.processor.js");
const { PortalService } = await import("../../../services/portal.service.js");
const { JobEventsService } =
  await import("../../../services/job-events.service.js");

const TARGET_A = "ce-target-a";
const TARGET_B = "ce-target-b";

describe("Multi-write smoke — bulk_transform fan-out (#99 slice 5)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let orgId: string;
  let userId: string;
  let portalId: string;
  let stationId: string;
  const cleanupQueues: Queue[] = [];
  const cleanupWorkers: Worker[] = [];

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);
    const seeded = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      `auth0|multi-write-${generateId()}`
    );
    orgId = seeded.organizationId;
    userId = seeded.userId;

    stationId = generateId();
    await db.insert(schema.stations).values({
      id: stationId,
      organizationId: orgId,
      name: "Multi-Write Smoke Station",
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
      name: "Multi-Write Smoke Portal",
      lastOpened: null,
      created: Date.now(),
      createdBy: userId,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    // Reset per-test test hooks.
    upsertCalls.length = 0;
    upsertImpl = async (opts) => ({
      rowsUpserted: opts.successes.length,
      droppedKeys: [],
    });
  });

  afterEach(async () => {
    for (const w of cleanupWorkers) await w.close();
    for (const q of cleanupQueues) {
      await q.obliterate({ force: true });
      await q.close();
    }
    cleanupQueues.length = 0;
    cleanupWorkers.length = 0;
    await teardownOrg(db as ReturnType<typeof drizzle>);
    await connection.end();
  });

  // Helper — enqueue a job and wait for terminal status.
  async function runJobToTerminal(
    writes: Array<{
      targetConnectorEntityId: string;
      column: string;
      valueFrom: { kind: string } & Record<string, unknown>;
    }>
  ): Promise<{
    jobId: string;
    result: {
      recordsProcessed: number;
      recordsFailed: number;
      partialFailures?: Array<{
        sourceKey: string;
        targetConnectorEntityId?: string;
        column?: string;
        error: { message: string };
      }>;
    };
  }> {
    const queueName = uniqueQueueName("bulk-transform-multi-write");
    const queue = new Queue(queueName, { connection: connectionOpts });
    cleanupQueues.push(queue);

    const jobId = generateId();
    const targetConnectorEntityIds = Array.from(
      new Set(writes.map((w) => w.targetConnectorEntityId))
    ).sort();
    const metadata = {
      portalId,
      organizationId: orgId,
      stationId,
      userId,
      sourceConnectorEntityId: "ce-source",
      targetConnectorEntityIds,
      expression: {
        kind: "tool",
        ref: "multi_write_tool",
        writes,
      },
      keyField: "source_id",
      batchSize: 5,
    };
    await db.insert(schema.jobs).values({
      id: jobId,
      organizationId: orgId,
      type: "bulk_transform",
      status: "pending",
      progress: 0,
      metadata,
      result: null,
      error: null,
      startedAt: null,
      completedAt: null,
      bullJobId: null,
      attempts: 0,
      maxAttempts: 3,
      created: Date.now(),
      createdBy: userId,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    const worker = new Worker(
      queueName,
      async (bullJob) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any = bullJob.data;
        await JobEventsService.transition(data.jobId, "active", {
          progress: 0,
        });
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await bulkTransformProcessor(bullJob as any);
          await JobEventsService.transition(data.jobId, "completed", {
            progress: 100,
            result: result as Record<string, unknown>,
          });
          await PortalService.notifyJobTerminal(data.portalId, data.jobId, {
            status: "completed",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            recordsProcessed: (result as any).recordsProcessed,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            recordsFailed: (result as any).recordsFailed,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            durationMs: (result as any).durationMs,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            partialFailures: (result as any).partialFailures,
          });
          return result;
        } catch (err) {
          await JobEventsService.transition(data.jobId, "failed", {
            error: err instanceof Error ? err.message : "unknown",
          });
          throw err;
        }
      },
      { connection: connectionOpts, concurrency: 1 }
    );
    cleanupWorkers.push(worker);

    await queue.add(
      "bulk_transform",
      { jobId, type: "bulk_transform", ...metadata },
      { jobId }
    );

    const startedAt = Date.now();
    let jobRow: { status: string; result: unknown } | undefined;
    while (Date.now() - startedAt < 20_000) {
      const rows = (await db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, jobId))) as Array<{
        status: string;
        result: unknown;
      }>;
      jobRow = rows[0];
      if (jobRow && jobRow.status === "completed") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(jobRow?.status).toBe("completed");
    return {
      jobId,
      result: jobRow!.result as {
        recordsProcessed: number;
        recordsFailed: number;
        partialFailures?: Array<{
          sourceKey: string;
          targetConnectorEntityId?: string;
          column?: string;
          error: { message: string };
        }>;
      },
    };
  }

  // Case 5.1 — two writes against ONE target.
  it("two writes against the same target land both columns in one upsertSuccesses call per batch", async () => {
    const { result } = await runJobToTerminal([
      {
        targetConnectorEntityId: TARGET_A,
        column: "c_km",
        valueFrom: { kind: "tool_path", path: "km" },
      },
      {
        targetConnectorEntityId: TARGET_A,
        column: "c_miles",
        valueFrom: { kind: "tool_path", path: "miles" },
      },
    ]);

    expect(result.recordsProcessed).toBe(SOURCE_BATCH_SIZE);
    expect(result.recordsFailed).toBe(0);
    expect(result.partialFailures ?? []).toEqual([]);

    // Each batch fires one upsertSuccesses call against TARGET_A.
    // batchSize=5, 10 source rows → 2 batches.
    expect(upsertCalls).toHaveLength(2);
    for (const call of upsertCalls) {
      expect(call.targetConnectorEntityId).toBe(TARGET_A);
      for (const s of call.successes) {
        expect(s.value).toEqual({ c_km: 5, c_miles: 3.1 });
      }
    }
  }, 30_000);

  // Case 5.2 — cross-target writes (one record, two targets).
  it("cross-target writes fan out into per-target upsertSuccesses calls", async () => {
    const { result, jobId } = await runJobToTerminal([
      {
        targetConnectorEntityId: TARGET_A,
        column: "c_km",
        valueFrom: { kind: "tool_path", path: "km" },
      },
      {
        targetConnectorEntityId: TARGET_A,
        column: "c_miles",
        valueFrom: { kind: "tool_path", path: "miles" },
      },
      {
        targetConnectorEntityId: TARGET_B,
        column: "c_summary",
        valueFrom: { kind: "tool_result" },
      },
    ]);

    expect(result.recordsProcessed).toBe(SOURCE_BATCH_SIZE);
    expect(result.recordsFailed).toBe(0);

    // Two batches × two targets = 4 upsertSuccesses calls.
    expect(upsertCalls).toHaveLength(4);
    const callsByTarget = new Map<string, UpsertSuccessesArgs[]>();
    for (const call of upsertCalls) {
      const bucket = callsByTarget.get(call.targetConnectorEntityId) ?? [];
      bucket.push(call);
      callsByTarget.set(call.targetConnectorEntityId, bucket);
    }
    expect(callsByTarget.get(TARGET_A)).toHaveLength(2);
    expect(callsByTarget.get(TARGET_B)).toHaveLength(2);

    // TARGET_A receives the two tool_path columns; TARGET_B receives
    // the whole tool result under c_summary.
    expect(callsByTarget.get(TARGET_A)![0].successes[0].value).toEqual({
      c_km: 5,
      c_miles: 3.1,
    });
    expect(callsByTarget.get(TARGET_B)![0].successes[0].value).toEqual({
      c_summary: { km: 5, miles: 3.1 },
    });

    // The job's persisted metadata carries the sorted union of
    // write targets so the lock query (Slice 3 #99) sees both.
    const jobRow = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, jobId));
    const metadata = jobRow[0].metadata as {
      targetConnectorEntityIds: string[];
    };
    expect(metadata.targetConnectorEntityIds).toEqual(
      [TARGET_A, TARGET_B].sort()
    );
  }, 30_000);

  // Case 5.3 — per-target failure isolation. TARGET_B throws; TARGET_A
  // commits; failures carry { targetConnectorEntityId, column }.
  it("per-target failure isolation — target A commits while target B's failure surfaces in partialFailures", async () => {
    upsertImpl = async (opts) => {
      if (opts.targetConnectorEntityId === TARGET_B) {
        throw new Error("target B exploded");
      }
      return { rowsUpserted: opts.successes.length, droppedKeys: [] };
    };

    const { result } = await runJobToTerminal([
      {
        targetConnectorEntityId: TARGET_A,
        column: "c_km",
        valueFrom: { kind: "tool_path", path: "km" },
      },
      {
        targetConnectorEntityId: TARGET_B,
        column: "c_summary",
        valueFrom: { kind: "tool_result" },
      },
    ]);

    expect(result.recordsProcessed).toBe(SOURCE_BATCH_SIZE);
    // One partialFailure entry per source key per failing target.
    expect(result.partialFailures).toBeDefined();
    expect(result.partialFailures).toHaveLength(SOURCE_BATCH_SIZE);
    for (const f of result.partialFailures!) {
      expect(f.targetConnectorEntityId).toBe(TARGET_B);
      expect(f.column).toBe("c_summary");
      expect(f.error.message).toContain("target B exploded");
    }

    // TARGET_A still got its writes — both batches went through.
    const targetACalls = upsertCalls.filter(
      (c) => c.targetConnectorEntityId === TARGET_A
    );
    expect(targetACalls).toHaveLength(2);
    for (const call of targetACalls) {
      for (const s of call.successes) {
        expect(s.value).toEqual({ c_km: 5 });
      }
    }
  }, 30_000);
});
