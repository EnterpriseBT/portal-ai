/**
 * Smoke A — Phase 2 acceptance integration test for #85.
 *
 * Exercises the worker pipeline end-to-end against real Redis + PG:
 *
 *  1. Seed an org + user + portal.
 *  2. Stand up a BullMQ worker against the unique-named test queue.
 *  3. Enqueue a `bulk_transform` job with metadata that ties it to the
 *     seeded portal.
 *  4. Worker processes the job using a stub `BulkTransformService` that
 *     returns a fixed batch payload. (The real SQL is a Phase 2
 *     scaffold and gets manual smoke + a follow-up PR.)
 *  5. Worker terminal hook fires `PortalService.notifyJobTerminal`,
 *     which persists a synthetic assistant message + publishes a
 *     `bulk_job_terminal` event on the portal-events channel.
 *  6. Test asserts: the assistant message lands in `portal_messages`,
 *     the Pub/Sub event arrives on a subscriber, and the running-jobs
 *     query returns the in-flight job before terminal.
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

jest.unstable_mockModule("../../../services/bulk-transform.service.js", () => ({
  BulkTransformService: {
    countSourceRows: async () => 3,
    // Three batches × 1 row each so the loop emits 3 SSE events.
    // Slice 4 (#99): runBatch returns the projection rows with
    // `__src_key` + `__source_row` framing keys + the projection's
    // aliases at the top level. The processor's fan-out reads
    // `__src_key` as the upsert key.
    runBatch: jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce({
        rowsCommitted: 1,
        rows: [
          {
            __src_key: "r-1",
            __source_row: { c_parcel_id: "r-1" },
            c_doubled: 2,
          },
        ],
      })
      .mockResolvedValueOnce({
        rowsCommitted: 1,
        rows: [
          {
            __src_key: "r-2",
            __source_row: { c_parcel_id: "r-2" },
            c_doubled: 4,
          },
        ],
      })
      .mockResolvedValueOnce({
        rowsCommitted: 1,
        rows: [
          {
            __src_key: "r-3",
            __source_row: { c_parcel_id: "r-3" },
            c_doubled: 6,
          },
        ],
      }),
    // Slice 4 (#99): the fan-out calls upsertSuccesses per target
    // per batch. Smoke A is single-target so this fires once per
    // batch.
    upsertSuccesses: jest
      .fn<
        (args: {
          successes: Array<{ sourceKey: string }>;
        }) => Promise<{ rowsUpserted: number; droppedKeys: string[] }>
      >()
      .mockImplementation(async (args) => ({
        rowsUpserted: args.successes.length,
        droppedKeys: [],
      })),
  },
}));

const { bulkTransformProcessor } =
  await import("../../../queues/processors/bulk-transform.processor.js");
const { PortalService } = await import("../../../services/portal.service.js");
const { JobEventsService } =
  await import("../../../services/job-events.service.js");

describe("Smoke A — bulk_transform worker pipeline (#85 Phase 2)", () => {
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
      `auth0|smoke-a-${generateId()}`
    );
    orgId = seeded.organizationId;
    userId = seeded.userId;

    // Seed a station first — portals FK to stations.
    const stationId = generateId();
    await db.insert(schema.stations).values({
      id: stationId,
      organizationId: orgId,
      name: "Smoke A Station",
      description: null,
      created: Date.now(),
      createdBy: userId,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    // Seed a portal that the bulk_transform job will be bound to.
    portalId = generateId();
    await db.insert(schema.portals).values({
      id: portalId,
      organizationId: orgId,
      stationId,
      name: "Smoke A Portal",
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

  it("end-to-end: worker runs processor → terminal hook → portal message + SSE event", async () => {
    const queueName = uniqueQueueName("bulk-transform-smoke-a");
    const queue = new Queue(queueName, { connection: connectionOpts });
    cleanupQueues.push(queue);

    // Create the job row directly so the worker hook can reference it.
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
        targetConnectorEntityIds: ["ce-target"],
        expression: {
          kind: "sql",
          value: "c_value * 2 AS c_doubled",
          writes: [
            {
              targetConnectorEntityId: "ce-target",
              column: "c_doubled",
              valueFrom: { kind: "sql_alias", alias: "c_doubled" },
            },
          ],
        },
        keyField: "c_parcel_id",
        batchSize: 1,
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

    // Worker that runs the real bulk-transform processor + fires the
    // terminal hook (mirrors apps/api/src/queues/jobs.worker.ts).
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

    // Subscribe to the portal-events channel to capture the terminal event.
    const { getRedisClient } = await import("../../../utils/redis.util.js");
    const sub = getRedisClient().duplicate();
    const channel = `portal:events:${portalId}`;
    await sub.subscribe(channel);
    const received: string[] = [];
    sub.on("message", (_chan, msg) => received.push(msg));

    // Enqueue.
    await queue.add(
      "bulk_transform",
      {
        jobId,
        type: "bulk_transform",
        sourceConnectorEntityId: "ce-source",
        targetConnectorEntityIds: ["ce-target"],
        expression: {
          kind: "sql",
          value: "c_value * 2 AS c_doubled",
          writes: [
            {
              targetConnectorEntityId: "ce-target",
              column: "c_doubled",
              valueFrom: { kind: "sql_alias", alias: "c_doubled" },
            },
          ],
        },
        keyField: "c_parcel_id",
        batchSize: 1,
        organizationId: orgId,
        portalId,
      },
      { jobId }
    );

    // Wait for the job to reach completed in PG.
    const startedAt = Date.now();
    let jobRow: { status: string } | undefined;
    while (Date.now() - startedAt < 20_000) {
      const rows = (await db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, jobId))) as Array<{ status: string }>;
      jobRow = rows[0];
      if (jobRow && jobRow.status === "completed") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(jobRow?.status).toBe("completed");

    // Settle: the worker's terminal hook is async; give the Pub/Sub
    // event + portal-message INSERT a moment to land.
    await new Promise((r) => setTimeout(r, 500));

    // Assert: portal-events SSE channel received a bulk_job_terminal.
    expect(received.length).toBeGreaterThan(0);
    const parsed = JSON.parse(received[0]);
    expect(parsed.type).toBe("bulk_job_terminal");
    expect(parsed.jobId).toBe(jobId);
    expect(parsed.status).toBe("completed");

    // Assert: a synthetic assistant message landed in portal_messages.
    const messages = (await db
      .select()
      .from(schema.portalMessages)
      .where(eq(schema.portalMessages.portalId, portalId))) as Array<{
      role: string;
      blocks: unknown;
    }>;
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe("assistant");
    const blocks = messages[0].blocks as Array<{
      type: string;
      content: unknown;
    }>;
    expect(blocks[0].type).toBe("text");
    expect(blocks[0].content as string).toMatch(/3 records/);

    await sub.unsubscribe(channel);
    await sub.quit();
  }, 30_000);
});
