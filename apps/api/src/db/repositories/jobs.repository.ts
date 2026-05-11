/**
 * Repository for the `jobs` table.
 *
 * Extends the generic {@link Repository} with job-specific queries
 * such as lookup by organization, status, and BullMQ job ID.
 */

import { eq, and, inArray, sql } from "drizzle-orm";
import { jobs } from "../schema/index.js";
import { db } from "../client.js";
import { ListOptions, Repository, type DbClient } from "./base.repository.js";
import type { JobSelect, JobInsert } from "../schema/zod.js";

/**
 * Job statuses that mean the worker still owns the entity referenced
 * in `metadata`. Mirrors the inverse of `TERMINAL_JOB_STATUSES` in
 * `@portalai/core/models/job.model.ts` (`completed` / `failed` /
 * `cancelled`). `stalled` is intentionally excluded — Bull surfaces it
 * mid-recovery and the job will either resume or fail; while it's
 * pending recovery the entity is still owned.
 */
export const NON_TERMINAL_JOB_STATUSES = [
  "pending",
  "active",
  "awaiting_confirmation",
  "stalled",
] as const;

export class JobsRepository extends Repository<
  typeof jobs,
  JobSelect,
  JobInsert
> {
  constructor() {
    super(jobs);
  }

  /** Find all jobs with a given status. */
  async findByStatus(
    status: JobSelect["status"],
    options: ListOptions = {},
    client: DbClient = db
  ): Promise<JobSelect[]> {
    return this.findMany(eq(jobs.status, status), options, client);
  }

  /** Find a job by its BullMQ job ID. */
  async findByBullJobId(
    bullJobId: string,
    client: DbClient = db
  ): Promise<JobSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table)
      .where(and(eq(jobs.bullJobId, bullJobId), this.notDeleted()))
      .limit(1);
    return row;
  }

  /**
   * Find every non-terminal job whose metadata references the given
   * connector instance id. Covers `connector_sync` and both kinds of
   * `layout_plan_commit` — all three carry `metadata.connectorInstanceId`.
   *
   * Used by the entity-lock convention (see `JobLockService` and
   * CLAUDE.md §"Async Job State & Data Locking"): mutations targeting
   * a connector instance reject with 409 ENTITY_LOCKED_BY_JOB while
   * any of these jobs are still active, and the connector-instance
   * detail view surfaces them in a status chip.
   */
  async findRunningForConnectorInstance(
    connectorInstanceId: string,
    organizationId: string,
    client: DbClient = db
  ): Promise<JobSelect[]> {
    return (await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(jobs.organizationId, organizationId),
          inArray(
            jobs.type,
            ["connector_sync", "layout_plan_commit"] as JobSelect["type"][]
          ),
          inArray(
            jobs.status,
            NON_TERMINAL_JOB_STATUSES as unknown as JobSelect["status"][]
          ),
          sql`${jobs.metadata}->>'connectorInstanceId' = ${connectorInstanceId}`,
          this.notDeleted()
        )
      )) as JobSelect[];
  }
}

/** Singleton instance — import this in route handlers / services. */
export const jobsRepo = new JobsRepository();
