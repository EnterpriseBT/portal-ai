/**
 * Stranded-job sweep against the real DB + real Redis (#391 slice 2).
 *
 * No mocks: the finder runs real SQL, `getJob(<bogus id>)` against the test
 * Redis returns `undefined` naturally (which IS the stranded condition), and
 * the reap goes through the real guarded transition — so case 11 proves the
 * acceptance criterion in miniature: the entity lock actually releases.
 *
 * Bogus bull ids are prefixed `stranded-test-` so they can never collide
 * with a real queue entry in the shared test Redis.
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
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";
import {
  JobReconciliationService,
  STRANDED_JOB_REASON,
} from "../../../services/job-reconciliation.service.js";
import { JobEventsService } from "../../../services/job-events.service.js";
import { JobLockService } from "../../../services/job-lock.service.js";
import { closeJobsQueue } from "../../../queues/jobs.queue.js";
import { closeRedis } from "../../../utils/redis.util.js";

const AUTH0_ID = "auth0|ci-test-user";
const STALE = () => Date.now() - 30 * 60 * 1000; // well past the 15-min default
const FRESH = () => Date.now() - 1000;

describe("JobReconciliationService — integration (#391)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let organizationId!: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    ({ organizationId } = await seedUserAndOrg(db, AUTH0_ID));
  });

  afterEach(async () => {
    await connection.end();
  });

  afterAll(async () => {
    await closeJobsQueue();
    await closeRedis();
  });

  async function seedJob() {
    const id = generateId();
    await db.insert(schema.jobs).values({
      id,
      organizationId,
      type: "connector_sync",
      status: "active",
      progress: 30,
      metadata: { connectorInstanceId: `ci-${id}`, organizationId },
      result: null,
      error: null,
      startedAt: STALE(),
      completedAt: null,
      bullJobId: `stranded-test-${id}`,
      attempts: 1,
      maxAttempts: 3,
      lostExecutions: 0,
      created: STALE(),
      createdBy: "SYSTEM_TEST",
      updated: STALE(),
      updatedBy: null,
      deleted: null,
      deletedBy: null,
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

  it("reaps a stale active row whose queue entry is gone — and the entity lock releases (case 11)", async () => {
    const id = await seedJob();
    const instanceId = (
      (await jobRow(id)).metadata as { connectorInstanceId: string }
    ).connectorInstanceId;

    // The lock is held before the sweep…
    const before = await JobLockService.findRunningForConnectorInstance(
      instanceId,
      organizationId
    );
    expect(before.map((j) => j.id)).toContain(id);

    const summary = await JobReconciliationService.sweepStrandedJobs();
    expect(summary.reaped).toBeGreaterThanOrEqual(1);

    const row = await jobRow(id);
    expect(row.status).toBe("failed");
    expect(row.error).toBe(STRANDED_JOB_REASON);
    expect(row.completedAt).not.toBeNull();

    // …and released after.
    const after = await JobLockService.findRunningForConnectorInstance(
      instanceId,
      organizationId
    );
    expect(after).toEqual([]);
  });

  it("leaves a fresh active row untouched (case 12)", async () => {
    const id = await seedJob({ updated: FRESH(), created: FRESH() });
    await db
      .update(schema.jobs)
      .set({ updated: FRESH(), created: FRESH() })
      .where(eq(schema.jobs.id, id));

    await JobReconciliationService.sweepStrandedJobs();

    expect((await jobRow(id)).status).toBe("active");
  });

  it("leaves a stale awaiting_confirmation row untouched (case 13)", async () => {
    const id = await seedJob();
    await db
      .update(schema.jobs)
      .set({ status: "awaiting_confirmation" })
      .where(eq(schema.jobs.id, id));

    await JobReconciliationService.sweepStrandedJobs();

    expect((await jobRow(id)).status).toBe("awaiting_confirmation");
  });

  it("leaves a terminal row untouched, and the guarded transition refuses it (case 14)", async () => {
    const id = await seedJob();
    await db
      .update(schema.jobs)
      .set({ status: "completed", result: { ok: true } })
      .where(eq(schema.jobs.id, id));

    await JobReconciliationService.sweepStrandedJobs();
    expect((await jobRow(id)).status).toBe("completed");

    await expect(
      JobEventsService.transitionIfNonTerminal(id, "failed", {
        error: "should not land",
      })
    ).resolves.toBe(false);
    expect((await jobRow(id)).result).toEqual({ ok: true });
  });

  it("reaps a pending row that never transitioned (updated NULL, stale created) via COALESCE (case 15)", async () => {
    const id = await seedJob();
    await db
      .update(schema.jobs)
      .set({ status: "pending", updated: null, bullJobId: null })
      .where(eq(schema.jobs.id, id));

    await JobReconciliationService.sweepStrandedJobs();

    const row = await jobRow(id);
    expect(row.status).toBe("failed");
    expect(row.error).toBe(STRANDED_JOB_REASON);
  });

  it("finder honors the limit and excludes soft-deleted rows (case 16)", async () => {
    const a = await seedJob();
    const b = await seedJob();
    const ghost = await seedJob();
    await db
      .update(schema.jobs)
      .set({ deleted: Date.now(), deletedBy: "SYSTEM_TEST" })
      .where(eq(schema.jobs.id, ghost));

    const { jobsRepo } =
      await import("../../../db/repositories/jobs.repository.js");
    const limited = await jobsRepo.findStrandedCandidates(Date.now(), 1);
    expect(limited).toHaveLength(1);

    const all = await jobsRepo.findStrandedCandidates(Date.now(), 100);
    const ids = all.map((j) => j.id);
    expect(ids).toEqual(expect.arrayContaining([a, b]));
    expect(ids).not.toContain(ghost);
  });
});
