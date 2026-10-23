/**
 * Repository for the `jobs` table.
 *
 * Extends the generic {@link Repository} with job-specific queries
 * such as lookup by organization, status, and BullMQ job ID.
 */

import { eq, and, arrayOverlaps, inArray, notInArray, sql } from "drizzle-orm";
import { TERMINAL_JOB_STATUSES, jobTypesLocking } from "@portalai/core/models";
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
 * `cancelled`). `stalled` is included: Bull surfaces it mid-recovery and
 * the job will either resume or fail, and while it's pending recovery the
 * entity is still owned (#769: every non-terminal status locks).
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
   * Non-terminal jobs in the org whose `lock_scopes` overlap any of `keys`
   * (#769): the jobs that lock an object resolving to those scope keys. Every
   * non-terminal status locks, `stalled` included. Served by the partial GIN
   * index on live rows (`status NOT IN` the terminal statuses); oldest first, so a refusal names the job that started
   * first.
   */
  async findRunningByScopeKeys(
    keys: string[],
    organizationId: string,
    client: DbClient = db
  ): Promise<JobSelect[]> {
    if (keys.length === 0) return [];
    return (await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(jobs.organizationId, organizationId),
          // The partial index's own predicate, as literals, so the planner
          // can prove it for a prepared (generic) plan too.
          sql`${jobs.status} NOT IN ('completed', 'failed', 'cancelled')`,
          arrayOverlaps(jobs.lockScopes, keys),
          this.notDeleted()
        )
      )
      .orderBy(jobs.created, jobs.id)) as JobSelect[];
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
   * Find non-terminal `dissolve_precompute` jobs for a specific owner **and
   * user** (#643). Used to dedup the lazy-fill enqueue on a tile-serve miss:
   * MapLibre fans out ~10 tiles at once, and a scope with genuinely empty
   * coverage would otherwise re-enqueue on every tile request forever. Keyed by
   * `userId` (not the owner alone) because the dissolve scope is per-user — a
   * different user's distinct scope must still be allowed to fill.
   */
  async findRunningDissolveForOwner(
    owner:
      | { kind: "pin"; portalResultId: string }
      | { kind: "message"; messageId: string; blockIndex: number },
    userId: string,
    organizationId: string,
    client: DbClient = db
  ): Promise<JobSelect[]> {
    const ownerCond =
      owner.kind === "pin"
        ? sql`${jobs.metadata}->>'portalResultId' = ${owner.portalResultId}`
        : sql`${jobs.metadata}->>'messageId' = ${owner.messageId} AND (${jobs.metadata}->>'blockIndex')::int = ${owner.blockIndex}`;
    return (await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(jobs.organizationId, organizationId),
          eq(jobs.type, "dissolve_precompute"),
          inArray(
            jobs.status,
            NON_TERMINAL_JOB_STATUSES as unknown as JobSelect["status"][]
          ),
          sql`${jobs.metadata}->>'userId' = ${userId}`,
          ownerCond,
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
  /** #743: has a layout-plan commit into `connectorInstanceId` ever read
   *  `uploadSessionId`? Any status: the recommit check accepts every session
   *  the instance was committed from, not only the latest. */
  async hasUploadSessionForConnectorInstance(
    connectorInstanceId: string,
    uploadSessionId: string,
    organizationId: string,
    client: DbClient = db
  ): Promise<boolean> {
    const [row] = await (client as typeof db)
      .select({ id: jobs.id })
      .from(this.table)
      .where(
        and(
          eq(jobs.organizationId, organizationId),
          eq(jobs.type, "layout_plan_commit" as JobSelect["type"]),
          sql`${jobs.metadata}->>'connectorInstanceId' = ${connectorInstanceId}`,
          sql`${jobs.metadata}#>>'{workbookSource,kind}' = 'uploadSession'`,
          sql`${jobs.metadata}#>>'{workbookSource,uploadSessionId}' = ${uploadSessionId}`,
          this.notDeleted()
        )
      )
      .limit(1);
    return row !== undefined;
  }

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

  /**
   * Candidates for the stranded-job sweep (#391): non-terminal rows whose
   * last write predates `olderThanMs`. `COALESCE(updated, created)` because
   * a `pending` row that was never transitioned has `updated = NULL`.
   * `awaiting_confirmation` is deliberately absent — its BullMQ entry is
   * legitimately gone while the user decides, so the sweep's absence
   * predicate would false-positive on it.
   */
  async findStrandedCandidates(
    olderThanMs: number,
    limit: number,
    client: DbClient = db
  ): Promise<JobSelect[]> {
    return (await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          inArray(jobs.status, [
            "pending",
            "active",
            "stalled",
          ] as JobSelect["status"][]),
          sql`COALESCE(${jobs.updated}, ${jobs.created}) < ${olderThanMs}`,
          this.notDeleted()
        )
      )
      .orderBy(jobs.created)
      .limit(limit)) as JobSelect[];
  }

  /**
   * Candidates for job re-dispatch (#852): every live non-terminal row a
   * worker could still run, keyset-paged on `(created, id)`. Unlike the
   * stranded sweep there is no heartbeat filter, because re-dispatch is run
   * deliberately after a Redis replacement, when every queued entry is gone at
   * once. `awaiting_confirmation` is excluded for the sweep's reason: its
   * BullMQ entry is legitimately absent while the user decides.
   */
  async findRedispatchCandidates(
    cursor: { created: number; id: string } | null,
    limit: number,
    client: DbClient = db
  ): Promise<JobSelect[]> {
    return (await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          inArray(jobs.status, [
            "pending",
            "active",
            "stalled",
          ] as JobSelect["status"][]),
          this.notDeleted(),
          cursor
            ? sql`(${jobs.created}, ${jobs.id}) > (${cursor.created}, ${cursor.id})`
            : undefined
        )
      )
      .orderBy(jobs.created, jobs.id)
      .limit(limit)) as JobSelect[];
  }

  /**
   * Point a row at its own id as its BullMQ id, only while it is still live
   * and non-terminal (#852). Returns false when the row went terminal (or was
   * deleted) since it was read, so re-dispatch never revives a cancelled or
   * reaped job. `status` is left alone: an interrupted `active` row must
   * still read `active` when the worker resumes it, which is how #464 counts
   * the lost execution. `updated` is bumped as the row's heartbeat.
   */
  async markRedispatched(id: string, client: DbClient = db): Promise<boolean> {
    const rows = await (client as typeof db)
      .update(this.table)
      .set({ bullJobId: id, updated: Date.now() })
      .where(
        and(
          eq(jobs.id, id),
          notInArray(jobs.status, TERMINAL_JOB_STATUSES),
          this.notDeleted()
        )
      )
      .returning({ id: jobs.id });
    return rows.length > 0;
  }
}

/** Singleton instance — import this in route handlers / services. */
export const jobsRepo = new JobsRepository();
