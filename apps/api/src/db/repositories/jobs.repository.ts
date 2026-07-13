/**
 * Repository for the `jobs` table.
 *
 * Extends the generic {@link Repository} with job-specific queries
 * such as lookup by organization, status, and BullMQ job ID.
 */

import { eq, and, inArray, sql } from "drizzle-orm";
import { jobTypesLocking } from "@portalai/core/models";
import { jobs } from "../schema/index.js";
import { db } from "../client.js";
import { ListOptions, Repository, type DbClient } from "./base.repository.js";
import type { JobSelect, JobInsert } from "../schema/zod.js";

/** Job types that lock under a given key, from the central registry
 *  (`JOB_LOCK_KEYS`). Derives the lock queries' type filter so a new locking
 *  job type is config-only — declared in the registry, no edit here (#121 F). */
const lockingTypes = (field: Parameters<typeof jobTypesLocking>[0]) =>
  jobTypesLocking(field).map((t) => t.type) as JobSelect["type"][];

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
          inArray(jobs.type, lockingTypes("connectorInstanceId")),
          inArray(
            jobs.status,
            NON_TERMINAL_JOB_STATUSES as unknown as JobSelect["status"][]
          ),
          sql`${jobs.metadata}->>'connectorInstanceId' = ${connectorInstanceId}`,
          this.notDeleted()
        )
      )) as JobSelect[];
  }

  /**
   * Find every non-terminal job for an organization, regardless of
   * type — unlike the per-entity lock finders this is not filtered to
   * locking job types, because org deletion (#197) must account for
   * every job that could still write org data.
   */
  async findRunningForOrganization(
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
            jobs.status,
            NON_TERMINAL_JOB_STATUSES as unknown as JobSelect["status"][]
          ),
          this.notDeleted()
        )
      )) as JobSelect[];
  }

  /**
   * Find every non-terminal job whose metadata declares the given
   * portal id. Used by the portal chat-input lock (#85 Phase 2):
   * while any of these jobs are running, the portal's input is
   * disabled at the UI layer.
   *
   * Today only `bulk_transform` carries `metadata.portalId`; future
   * job types that should lock the chat extend the type filter.
   */
  async findRunningByPortalId(
    portalId: string,
    organizationId: string,
    client: DbClient = db
  ): Promise<JobSelect[]> {
    return (await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(jobs.organizationId, organizationId),
          inArray(jobs.type, lockingTypes("portalId")),
          inArray(
            jobs.status,
            NON_TERMINAL_JOB_STATUSES as unknown as JobSelect["status"][]
          ),
          sql`${jobs.metadata}->>'portalId' = ${portalId}`,
          this.notDeleted()
        )
      )) as JobSelect[];
  }

  /**
   * Find every non-terminal job whose metadata's lock-set overlaps the
   * given connector entity ids. Today this covers `bulk_transform`
   * (`metadata.targetConnectorEntityIds: string[]`); future job types
   * that lock at the entity level extend this query.
   *
   * Slice 3 (#99): generalized from a single entity id to an array.
   * The SQL uses PG's JSONB array-overlap operator (`?|`): a row
   * matches when its metadata's `targetConnectorEntityIds` JSON array
   * shares at least one element with the requested set. Returns `[]`
   * when `connectorEntityIds` is empty (the predicate against an empty
   * `text[]` is always false; short-circuit to skip the DB hit).
   *
   * Used by `JobLockService.assertConnectorEntityUnlocked` to surface
   * entity-level locks alongside the existing instance-level path.
   */
  async findRunningByTargetEntityIds(
    connectorEntityIds: string[],
    organizationId: string,
    client: DbClient = db
  ): Promise<JobSelect[]> {
    if (connectorEntityIds.length === 0) return [];
    // postgres.js doesn't auto-bind a JS array as a PG array literal,
    // so build the `text[]` via `sql.join` so each element binds as
    // its own parameter (`ARRAY[$n, $n+1, …]::text[]`). The `?|`
    // operator then matches rows whose JSONB array on the left
    // overlaps the requested set on the right.
    const entityIdsSql = sql.join(
      connectorEntityIds.map((id) => sql`${id}`),
      sql`, `
    );
    return (await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(jobs.organizationId, organizationId),
          inArray(jobs.type, lockingTypes("targetConnectorEntityIds")),
          inArray(
            jobs.status,
            NON_TERMINAL_JOB_STATUSES as unknown as JobSelect["status"][]
          ),
          sql`${jobs.metadata}->'targetConnectorEntityIds' ?| ARRAY[${entityIdsSql}]::text[]`,
          this.notDeleted()
        )
      )) as JobSelect[];
  }

  /**
   * Find the upload-session id that backed the most recent
   * `layout_plan_commit` job for `connectorInstanceId`. Returns
   * `undefined` if no prior commit job referenced an upload session
   * (i.e., the connector was never an `uploadSession`-source path).
   *
   * Used by the edit-context endpoint to recover the file-upload
   * source for an existing connector — the `file_uploads` table has no
   * back-reference to `connector_instances`, so we walk job history
   * instead. Order is `created DESC` so the most recent commit wins
   * (covers the case where a connector was committed multiple times).
   */
  async findLatestUploadSessionIdForConnectorInstance(
    connectorInstanceId: string,
    organizationId: string,
    client: DbClient = db
  ): Promise<string | undefined> {
    const [row] = await (client as typeof db)
      .select({
        uploadSessionId: sql<
          string | null
        >`${jobs.metadata}#>>'{workbookSource,uploadSessionId}'`,
      })
      .from(this.table)
      .where(
        and(
          eq(jobs.organizationId, organizationId),
          eq(jobs.type, "layout_plan_commit" as JobSelect["type"]),
          sql`${jobs.metadata}->>'connectorInstanceId' = ${connectorInstanceId}`,
          sql`${jobs.metadata}#>>'{workbookSource,kind}' = 'uploadSession'`,
          this.notDeleted()
        )
      )
      .orderBy(sql`${jobs.created} DESC`)
      .limit(1);
    return row?.uploadSessionId ?? undefined;
  }
}

/** Singleton instance — import this in route handlers / services. */
export const jobsRepo = new JobsRepository();
