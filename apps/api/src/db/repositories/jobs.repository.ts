/**
 * Repository for the `jobs` table.
 *
 * Extends the generic {@link Repository} with job-specific queries
 * such as lookup by organization, status, and BullMQ job ID.
 */

import { eq, and } from "drizzle-orm";
import { jobs } from "../schema/index.js";
import { db } from "../client.js";
import { ListOptions, Repository, type DbClient } from "./base.repository.js";
import type { JobSelect, JobInsert } from "../schema/zod.js";

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
}

/** Singleton instance — import this in route handlers / services. */
export const jobsRepo = new JobsRepository();
