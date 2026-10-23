/**
 * Job re-dispatch against the real DB + real Redis (#852).
 *
 * Each case starts by obliterating the jobs queue: that IS the cutover, a
 * Redis that has never seen the rows Postgres still holds. Re-dispatch then
 * runs for real, and the real jobs worker (with a trivial `system_check`
 * processor) proves a re-added row runs to `completed` through the worker,
 * not through the stranded sweep.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
} from "@jest/globals";
import type { Worker } from "bullmq";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

// This suite obliterates the jobs queue, so it runs on its own Redis logical
// DB: locally the integration Redis is the dev stack's, whose queue must
// survive. Set before the app modules load, since `environment` reads
// REDIS_URL at import.
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://redis:6379");
redisUrl.pathname = "/15";
process.env.REDIS_URL = redisUrl.toString();

const { JobRedispatchService } =
  await import("../../../services/job-redispatch.service.js");
const { DbService } = await import("../../../services/db.service.js");
const { closeJobsQueue, getJobsQueue } =
  await import("../../../queues/jobs.queue.js");
const { createJobsWorker } = await import("../../../queues/jobs.worker.js");
const { closeRedis } = await import("../../../utils/redis.util.js");

const AUTH0_ID = "auth0|ci-test-user";
const STALE = () => Date.now() - 30 * 60 * 1000;

describe("JobRedispatchService — integration (#852)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let organizationId!: string;
  let worker: Worker | null = null;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    ({ organizationId } = await seedUserAndOrg(db, AUTH0_ID));
    // The replacement Redis: nothing the rows reference exists in it.
    await getJobsQueue().obliterate({ force: true });
  });

  afterEach(async () => {
    if (worker) await worker.close();
    worker = null;
    await connection.end();
  });

  afterAll(async () => {
    await closeJobsQueue();
    await closeRedis();
  });

  async function seedJob(
    status: string,
    over: Record<string, unknown> = {}
  ): Promise<string> {
    const id = generateId();
    await db.insert(schema.jobs).values({
      id,
      organizationId,
      type: "system_check",
      status,
      progress: status === "active" ? 30 : 0,
      metadata: {},
      lockScopes: [],
      result: null,
      error: null,
      startedAt: status === "active" ? STALE() : null,
      completedAt: null,
      // A pre-#852 dispatch: BullMQ's own counter, gone with the old Redis.
      bullJobId: "57",
      attempts: status === "active" ? 1 : 0,
      maxAttempts: 3,
      lostExecutions: 0,
      created: STALE(),
      createdBy: "SYSTEM_TEST",
      updated: STALE(),
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...over,
    } as never);
    return id;
  }

  const jobRow = async (id: string) => {
    const [r] = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, id));
    return r!;
  };

  async function waitForStatus(id: string, status: string, timeoutMs = 15_000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if ((await jobRow(id)).status === status) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`job ${id} never reached ${status}`);
  }

  const startWorker = () => {
    worker = createJobsWorker({ system_check: async () => ({ ok: true }) });
  };

  it("re-adds a pending row whose queue entry is gone, and the worker completes it", async () => {
    const id = await seedJob("pending");

    const summary = await JobRedispatchService.redispatchOrphans({
      dryRun: false,
    });
    expect(summary.redispatched).toContainEqual({
      id,
      type: "system_check",
      priorStatus: "pending",
    });
    expect((await jobRow(id)).bullJobId).toBe(id);
    const queued = await getJobsQueue().getJob(id);
    expect(queued?.data).toMatchObject({ jobId: id, type: "system_check" });
    expect(queued?.opts.attempts).toBe(3);

    startWorker();
    await waitForStatus(id, "completed");
  });

  it("resumes an interrupted active row as a lost execution (#464)", async () => {
    const id = await seedJob("active");

    await JobRedispatchService.redispatchOrphans({ dryRun: false });
    startWorker();
    await waitForStatus(id, "completed");

    expect((await jobRow(id)).lostExecutions).toBe(1);
  });

  it("carries the spent attempts over: the row keeps its budget and its count", async () => {
    // Failed attempts 1 and 2 on the old Redis; one attempt is left.
    const id = await seedJob("pending", { attempts: 2 });

    await JobRedispatchService.redispatchOrphans({ dryRun: false });
    const queued = await getJobsQueue().getJob(id);
    expect(queued?.opts.attempts).toBe(1);
    expect(queued?.data.attemptOffset).toBe(2);

    startWorker();
    await waitForStatus(id, "completed");
    expect((await jobRow(id)).attempts).toBe(3);
  });

  it("never revives a terminal row", async () => {
    const id = await seedJob("cancelled", { completedAt: STALE() });

    const summary = await JobRedispatchService.redispatchOrphans({
      dryRun: false,
    });
    expect(summary.redispatched.map((r) => r.id)).not.toContain(id);
    expect(await getJobsQueue().getJob(id)).toBeUndefined();
    expect((await jobRow(id)).status).toBe("cancelled");
  });

  it("is idempotent: a second pass finds the row present and adds nothing", async () => {
    const id = await seedJob("pending");

    await JobRedispatchService.redispatchOrphans({ dryRun: false });
    const second = await JobRedispatchService.redispatchOrphans({
      dryRun: false,
    });
    expect(second.redispatched.map((r) => r.id)).not.toContain(id);
    expect(second.present).toBeGreaterThanOrEqual(1);
    expect(await getJobsQueue().getJobCountByTypes("wait")).toBe(1);
  });

  it("candidates exclude awaiting_confirmation and deleted rows", async () => {
    const waiting = await seedJob("awaiting_confirmation");
    const deleted = await seedJob("pending", { deleted: STALE() });
    const live = await seedJob("stalled");

    const ids = (
      await DbService.repository.jobs.findRedispatchCandidates(null, 1000)
    ).map((r) => r.id);
    expect(ids).toContain(live);
    expect(ids).not.toContain(waiting);
    expect(ids).not.toContain(deleted);
  });
});
