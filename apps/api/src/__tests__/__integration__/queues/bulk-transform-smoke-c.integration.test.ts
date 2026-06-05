/**
 * Smoke C — Phase 4 acceptance integration test for #85.
 *
 * Exercises the tool-dispatch branch of the bulk_transform processor
 * end-to-end against real Redis + PG:
 *
 *   1. Seed an org + user + station + portal.
 *   2. Mock BulkTransformService.fetchSourceBatch + upsertSuccesses
 *      (the wide-table SQL is a Phase 2/4 scaffold; Smoke C focuses
 *      on the dispatcher control flow + worker hook + portal SSE).
 *   3. Mock ToolService.lookupBulkDispatchable to return a stub
 *      bulkDispatch-able tool whose executor injects deterministic
 *      failures for specific source keys.
 *   4. Stand up a BullMQ worker, enqueue a tool-kind job, wait for
 *      terminal, assert: target reached completed, terminal message
 *      lands, partialFailures count matches injected failures.
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

// ── Stub the SQL seams + the tool lookup ─────────────────────────────

const sourceRows = Array.from({ length: 10 }, (_, i) => ({
  entity_record_id: `r-${i}`,
  organization_id: "org-stub",
  source_id: `p-${i}`,
}));

const failingKeys = new Set(["p-3", "p-7"]);

jest.unstable_mockModule("../../../services/bulk-transform.service.js", () => ({
  BulkTransformService: {
    countSourceRows: async () => sourceRows.length,
    fetchSourceBatch: async (opts: { offset: number; batchSize: number }) =>
      sourceRows.slice(opts.offset, opts.offset + opts.batchSize),
    upsertSuccesses: async () => 0,
    explainExpression: async () => undefined,
    runBatch: async () => ({ rowsCommitted: 0, rows: [] }),
  },
}));

jest.unstable_mockModule("../../../services/tools.service.js", () => ({
  ToolService: {
    lookupBulkDispatchable: async () => ({
      executor: async (input: Record<string, unknown>) => {
        const sourceKey = String(input.sourceKey);
        if (failingKeys.has(sourceKey)) {
          throw new Error(`Injected failure for ${sourceKey}`);
        }
        return { c_distance_km: sourceKey.length * 1.5 };
      },
      metadata: {
        maxConcurrency: 4,
        timeoutMs: 5_000,
        idempotent: true,
      },
    }),
  },
}));

const { bulkTransformProcessor } = await import(
  "../../../queues/processors/bulk-transform.processor.js"
);
const { PortalService } = await import(
  "../../../services/portal.service.js"
);
const { JobEventsService } = await import(
  "../../../services/job-events.service.js"
);

describe("Smoke C — tool-dispatch processor pipeline (#85 Phase 4)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let orgId: string;
  let userId: string;
  let portalId: string;
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
      `auth0|smoke-c-${generateId()}`
    );
    orgId = seeded.organizationId;
    userId = seeded.userId;

    const stationId = generateId();
    await db.insert(schema.stations).values({
      id: stationId,
      organizationId: orgId,
      name: "Smoke C Station",
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
      name: "Smoke C Portal",
      lastOpened: null,
      created: Date.now(),
      createdBy: userId,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
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

  it("end-to-end: tool-dispatch processor → partial failures → terminal message", async () => {
    const queueName = uniqueQueueName("bulk-transform-smoke-c");
    const queue = new Queue(queueName, { connection: connectionOpts });
    cleanupQueues.push(queue);

    const jobId = generateId();
    await db.insert(schema.jobs).values({
      id: jobId,
      organizationId: orgId,
      type: "bulk_transform",
      status: "pending",
      progress: 0,
      metadata: {
        portalId,
        organizationId: orgId,
        sourceConnectorEntityId: "ce-source",
        targetConnectorEntityId: "ce-target",
        expression: {
          kind: "tool",
          ref: "compute_distance_to_nearest_hospital",
        },
        keyField: "source_id",
        batchSize: 5,
      },
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
        await JobEventsService.transition(data.jobId, "active", { progress: 0 });
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
      {
        jobId,
        type: "bulk_transform",
        sourceConnectorEntityId: "ce-source",
        targetConnectorEntityId: "ce-target",
        expression: {
          kind: "tool",
          ref: "compute_distance_to_nearest_hospital",
        },
        keyField: "source_id",
        batchSize: 5,
        organizationId: orgId,
        portalId,
      },
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

    const result = jobRow!.result as {
      recordsProcessed: number;
      recordsFailed: number;
      partialFailures?: Array<{ sourceKey: string }>;
    };
    expect(result.recordsProcessed).toBe(10);
    expect(result.recordsFailed).toBe(2);
    expect(result.partialFailures).toBeDefined();
    expect(result.partialFailures!.map((f) => f.sourceKey).sort()).toEqual([
      "p-3",
      "p-7",
    ]);

    // Let the worker terminal hook drain.
    await new Promise((r) => setTimeout(r, 500));

    const messages = (await db
      .select()
      .from(schema.portalMessages)
      .where(eq(schema.portalMessages.portalId, portalId))) as Array<{
      role: string;
      blocks: unknown;
    }>;
    expect(messages.length).toBe(1);
    const blocks = messages[0].blocks as Array<{ type: string }>;
    // Text summary + failures table.
    expect(blocks.map((b) => b.type)).toEqual([
      "text",
      "bulk-failures-table",
    ]);
  }, 30_000);
});
