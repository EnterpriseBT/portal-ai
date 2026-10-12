/**
 * Entity-level locking against in-flight async jobs.
 *
 * Encodes the convention documented in CLAUDE.md §"Async Job State &
 * Data Locking": while a job is in flight, the entity it owns is
 * read-only across the entire stack. Mutation routes call
 * `assertConnectorInstanceUnlocked` (or its sibling, when other
 * lockable entity types arrive) before any DB write so the user
 * doesn't race the worker. The frontend reads the same blocking-jobs
 * list from `findRunningForConnectorInstance` to drive the
 * `<EntityLockAlert>` chip + disabled mutation buttons.
 *
 * Locks release when each job reaches a terminal status (see
 * `TERMINAL_JOB_STATUSES` in `@portalai/core/models/job.model.ts`).
 * No manual unlock paths.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import {
  JOB_TYPE_LABELS,
  jobLockScopes,
  lockScopeKey,
  type JobType,
  type LockTargetKind,
} from "@portalai/core/models";
import type { JobCreateRequestBody } from "@portalai/core/contracts";

import { db } from "../db/client.js";
import type { DbClient } from "../db/repositories/base.repository.js";
import {
  connectorEntities,
  connectorInstances,
  fieldMappings,
} from "../db/schema/index.js";
import type { JobSelect } from "../db/schema/zod.js";
import {
  ApiCode,
  ApiCodeDefaultRecommendation,
} from "../constants/api-codes.constants.js";
import { DbService } from "./db.service.js";
import { ApiError } from "./http.service.js";
import { JobsService } from "./jobs.service.js";
import { JOB_LOCK_NAMESPACE } from "./sync-lock.service.js";

/**
 * Trimmed job summary returned to API consumers — the full row's
 * `metadata` / `result` columns can carry the entire layout plan or
 * upload payload, which is too much to leak to a 409 details body or
 * a frontend lock chip.
 */
export interface RunningJobSummary {
  id: string;
  type: JobSelect["type"];
  status: JobSelect["status"];
  startedAt: number | null;
  created: number;
  lockScopes: string[];
}

function toSummary(row: JobSelect): RunningJobSummary {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    startedAt: row.startedAt,
    created: row.created,
    lockScopes: row.lockScopes,
  };
}

/**
 * What a write changes, for the lock check (#769). A record or field mapping
 * names its entity (the caller has it, or resolves it from the row); the
 * rest name themselves.
 */
export type LockTarget =
  | { kind: "record"; connectorEntityId: string }
  | { kind: "fieldMapping"; connectorEntityId: string }
  | { kind: "connectorEntity"; id: string }
  | { kind: "connectorInstance"; id: string }
  | { kind: "columnDefinition"; id: string };

// The kinds stay in step with core's LockTargetKindSchema, which the tool
// registry's `lock.target` uses.
type _SameKinds = [LockTarget["kind"]] extends [LockTargetKind]
  ? [LockTargetKind] extends [LockTarget["kind"]]
    ? true
    : never
  : never;
const _sameKinds: _SameKinds = true;
void _sameKinds;

const entityKey = (id: string) => lockScopeKey({ kind: "connectorEntity", id });
const instanceKey = (id: string) =>
  lockScopeKey({ kind: "connectorInstance", id });

/** The 409 for a write or enqueue refused by running jobs, naming the first. */
function lockedError(
  running: JobSelect[],
  targets: LockTarget[],
  keys: string[]
): ApiError {
  const job = running[0];
  const label = JOB_TYPE_LABELS[job.type as JobType] ?? job.type;
  const held = new Set(job.lockScopes.filter((k) => keys.includes(k)));
  const holdsEntity = [...held].some((k) => k.startsWith("entity:"));
  let where: string;
  if (targets.every((t) => t.kind === "columnDefinition")) {
    where = "on an entity that uses this column definition";
  } else if (targets.some((t) => t.kind === "connectorInstance")) {
    where = [...held].some((k) => k.startsWith("instance:"))
      ? "on this connector"
      : "on one of this connector's entities";
  } else {
    where = holdsEntity ? "on this entity" : "on this connector";
  }
  return new ApiError(
    409,
    ApiCode.ENTITY_LOCKED_BY_JOB,
    `${label} is running ${where}. Try again when it finishes.`,
    {
      recommendation:
        ApiCodeDefaultRecommendation[ApiCode.ENTITY_LOCKED_BY_JOB],
      details: { runningJobs: running.map(toSummary) },
    }
  );
}

/** Take a transaction-scoped advisory lock on each key, in sorted order so
 *  two lockers never deadlock on each other's keys. */
async function lockKeys(
  tx: DbClient,
  keys: string[],
  mode: "shared" | "exclusive"
): Promise<void> {
  const fn =
    mode === "shared"
      ? "pg_advisory_xact_lock_shared"
      : "pg_advisory_xact_lock";
  for (const key of [...new Set(keys)].sort()) {
    await (tx as typeof db).execute(
      sql`SELECT ${sql.raw(fn)}(${JOB_LOCK_NAMESPACE}::int, hashtext(${key}))`
    );
  }
}

export class JobLockService {
  /**
   * The scope keys a set of write targets resolves to (#769):
   *  - a record, field mapping or entity → the entity and its instance;
   *  - an instance → itself and every live entity under it;
   *  - a column definition → every entity with a live mapping to it, and
   *    their instances.
   * Org-scoped: a missing object, or one in another org, resolves to nothing
   * (the caller's own 404 fires).
   */
  static async resolveScopeKeys(
    targets: LockTarget[],
    organizationId: string,
    client: DbClient = db
  ): Promise<string[]> {
    const c = client as typeof db;
    const keys = new Set<string>();
    const entityIds = targets.flatMap((t) =>
      t.kind === "record" || t.kind === "fieldMapping"
        ? [t.connectorEntityId]
        : t.kind === "connectorEntity"
          ? [t.id]
          : []
    );
    const instanceIds = targets.flatMap((t) =>
      t.kind === "connectorInstance" ? [t.id] : []
    );
    const columnDefinitionIds = targets.flatMap((t) =>
      t.kind === "columnDefinition" ? [t.id] : []
    );
    const addEntities = (rows: { id: string; instanceId: string }[]) => {
      for (const r of rows) {
        keys.add(entityKey(r.id));
        keys.add(instanceKey(r.instanceId));
      }
    };

    if (entityIds.length > 0) {
      addEntities(
        await c
          .select({
            id: connectorEntities.id,
            instanceId: connectorEntities.connectorInstanceId,
          })
          .from(connectorEntities)
          .where(
            and(
              inArray(connectorEntities.id, entityIds),
              eq(connectorEntities.organizationId, organizationId),
              isNull(connectorEntities.deleted)
            )
          )
      );
    }
    if (instanceIds.length > 0) {
      const instances = await c
        .select({ id: connectorInstances.id })
        .from(connectorInstances)
        .where(
          and(
            inArray(connectorInstances.id, instanceIds),
            eq(connectorInstances.organizationId, organizationId),
            isNull(connectorInstances.deleted)
          )
        );
      const live = instances.map((i) => i.id);
      for (const id of live) keys.add(instanceKey(id));
      if (live.length > 0) {
        addEntities(
          await c
            .select({
              id: connectorEntities.id,
              instanceId: connectorEntities.connectorInstanceId,
            })
            .from(connectorEntities)
            .where(
              and(
                inArray(connectorEntities.connectorInstanceId, live),
                isNull(connectorEntities.deleted)
              )
            )
        );
      }
    }
    if (columnDefinitionIds.length > 0) {
      addEntities(
        await c
          .select({
            id: connectorEntities.id,
            instanceId: connectorEntities.connectorInstanceId,
          })
          .from(fieldMappings)
          .innerJoin(
            connectorEntities,
            eq(connectorEntities.id, fieldMappings.connectorEntityId)
          )
          .where(
            and(
              inArray(fieldMappings.columnDefinitionId, columnDefinitionIds),
              eq(fieldMappings.organizationId, organizationId),
              isNull(fieldMappings.deleted),
              isNull(connectorEntities.deleted)
            )
          )
      );
    }
    return [...keys];
  }

  /** Non-terminal jobs in the org that lock any of the targets (#769). */
  static async findRunning(
    targets: LockTarget[],
    organizationId: string,
    client: DbClient = db
  ): Promise<RunningJobSummary[]> {
    const keys = await JobLockService.resolveScopeKeys(
      targets,
      organizationId,
      client
    );
    return (
      await DbService.repository.jobs.findRunningByScopeKeys(
        keys,
        organizationId,
        client
      )
    ).map(toSummary);
  }

  /**
   * Refuse early, with the same 409, when a running job locks the targets
   * (#769). A pre-flight only, for work worth skipping before it starts (a
   * model call, a large parse): it isn't atomic with anything, so the write
   * itself must still go through `withUnlocked`.
   */
  static async assertNoneRunning(
    target: LockTarget | LockTarget[],
    ctx: { organizationId: string }
  ): Promise<void> {
    const targets = Array.isArray(target) ? target : [target];
    const keys = await JobLockService.resolveScopeKeys(
      targets,
      ctx.organizationId
    );
    const running = await DbService.repository.jobs.findRunningByScopeKeys(
      keys,
      ctx.organizationId
    );
    if (running.length > 0) throw lockedError(running, targets, keys);
  }

  /**
   * Run a write only if no running job locks its targets (#769). Opens a
   * transaction, takes a shared advisory lock on every scope key the targets
   * resolve to, refuses with `409 ENTITY_LOCKED_BY_JOB` (naming the job) if a
   * non-terminal job holds one, then runs `fn` on that transaction. Do the
   * writes on `tx`: the shared lock is held until commit, so a job can't be
   * enqueued over these scopes between the check and the write.
   *
   * Fail-closed by construction: a failed lookup fails the transaction, and
   * the write with it.
   */
  static async withUnlocked<T>(
    target: LockTarget | LockTarget[],
    ctx: { organizationId: string },
    fn: (tx: DbClient) => Promise<T>
  ): Promise<T> {
    const targets = Array.isArray(target) ? target : [target];
    return DbService.transaction(async (tx) => {
      const keys = await JobLockService.resolveScopeKeys(
        targets,
        ctx.organizationId,
        tx
      );
      await lockKeys(tx, keys, "shared");
      const running = await DbService.repository.jobs.findRunningByScopeKeys(
        keys,
        ctx.organizationId,
        tx
      );
      if (running.length > 0) throw lockedError(running, targets, keys);
      return fn(tx);
    });
  }

  /**
   * Start a job that locks scopes (#769). Opens a transaction, takes an
   * exclusive advisory lock on every key the job's scopes resolve to (an
   * entity job also takes its instance; an instance job its entities), refuses
   * with `409 ENTITY_LOCKED_BY_JOB` if a running job overlaps, and inserts the
   * job row in that transaction. The job is queued on BullMQ only after
   * commit, so a worker never sees an uncommitted row.
   *
   * `onSameJob: "reuse"` returns a running job of the same type over exactly
   * the same scopes instead of refusing (revalidation's idempotent enqueue).
   */
  static async enqueueExclusive(
    userId: string,
    params: JobCreateRequestBody,
    opts: { onSameJob?: "refuse" | "reuse" } = {}
  ): Promise<JobSelect> {
    const scopes = jobLockScopes(params.type, params.metadata);
    const declared = scopes.map(lockScopeKey);
    const targets: LockTarget[] = scopes.map((s) =>
      s.kind === "connectorEntity"
        ? { kind: "connectorEntity", id: s.id }
        : { kind: "connectorInstance", id: s.id }
    );
    const outcome = await DbService.transaction(async (tx) => {
      const keys = [
        ...new Set([
          ...declared,
          ...(await JobLockService.resolveScopeKeys(
            targets,
            params.organizationId,
            tx
          )),
        ]),
      ];
      await lockKeys(tx, keys, "exclusive");
      const running = await DbService.repository.jobs.findRunningByScopeKeys(
        keys,
        params.organizationId,
        tx
      );
      if (running.length > 0) {
        const same = [...declared].sort().join(",");
        const reusable =
          opts.onSameJob === "reuse"
            ? running.find(
                (j) =>
                  j.type === params.type &&
                  [...j.lockScopes].sort().join(",") === same
              )
            : undefined;
        if (reusable && running.length === 1) {
          return { job: reusable, created: false };
        }
        throw lockedError(running, targets, keys);
      }
      return {
        job: (await JobsService.insertRow(userId, params, tx)) as JobSelect,
        created: true,
      };
    });
    if (!outcome.created) return outcome.job;
    return (await JobsService.dispatch(outcome.job)) as JobSelect;
  }

  /**
   * Return every non-terminal job locking the given connector
   * instance — `connector_sync` plus both kinds of
   * `layout_plan_commit`. Empty array when the instance is free to
   * mutate. Org-scoped so a leak across orgs is structurally
   * impossible even if the caller forgets to authz the instance
   * itself.
   */
  static async findRunningForConnectorInstance(
    connectorInstanceId: string,
    organizationId: string
  ): Promise<RunningJobSummary[]> {
    const rows =
      await DbService.repository.jobs.findRunningForConnectorInstance(
        connectorInstanceId,
        organizationId
      );
    return rows.map(toSummary);
  }

  /**
   * Every non-terminal job that would block a mutation against one
   * connector entity (#453) — the union of the instance-level locks
   * (`connector_sync`, `layout_plan_commit`, `entity_record_clear`)
   * and the entity-targeted locks (`bulk_transform`, `bulk_geocode`),
   * deduped by job id (an `entity_record_clear` names both its
   * instance and its entity, so it matches both queries).
   *
   * This is exactly the set `assertConnectorEntityUnlocked` would
   * reject — the parity that lets the entity view's disable-with-
   * tooltip agree with the 409 the route would return.
   */
  static async findRunningForConnectorEntity(
    connectorEntityId: string,
    connectorInstanceId: string,
    organizationId: string
  ): Promise<RunningJobSummary[]> {
    const [instanceRows, entityRows] = await Promise.all([
      DbService.repository.jobs.findRunningForConnectorInstance(
        connectorInstanceId,
        organizationId
      ),
      DbService.repository.jobs.findRunningByTargetEntityIds(
        [connectorEntityId],
        organizationId
      ),
    ]);
    const byId = new Map(
      [...instanceRows, ...entityRows].map((row) => [row.id, row])
    );
    return [...byId.values()].map(toSummary);
  }

  /**
   * Return every non-terminal job in the organization, regardless of
   * type. Org deletion (#197) sweeps this list: queued jobs are
   * cancelled, an `active` one blocks the delete with 409.
   */
  static async findRunningForOrganization(
    organizationId: string
  ): Promise<RunningJobSummary[]> {
    const rows =
      await DbService.repository.jobs.findRunningForOrganization(
        organizationId
      );
    return rows.map(toSummary);
  }

  /**
   * Throw `409 ENTITY_LOCKED_BY_JOB` if any non-terminal job locks
   * the connector instance. Call this at the head of every route /
   * service entry point that mutates the instance, its plan, its
   * entities, or its records — the goal is that a single check
   * across the affected mutation paths produces a uniform UX.
   *
   * The thrown error's `details.runningJobs` carries the same
   * `RunningJobSummary[]` shape the GET-running-jobs endpoint
   * returns, so the frontend can reuse one renderer for both the
   * proactive chip and the post-attempt error toast.
   */
  static async assertConnectorInstanceUnlocked(
    connectorInstanceId: string,
    organizationId: string
  ): Promise<void> {
    const runningJobs = await JobLockService.findRunningForConnectorInstance(
      connectorInstanceId,
      organizationId
    );
    if (runningJobs.length === 0) return;
    throw new ApiError(
      409,
      ApiCode.ENTITY_LOCKED_BY_JOB,
      "Connector instance is locked by an in-flight job",
      { runningJobs }
    );
  }

  /**
   * Lock check for mutations against one or more connector entities.
   * Two layers:
   *
   *  1. Instance-level: resolves each entity's parent connector
   *     instance and delegates to `assertConnectorInstanceUnlocked` so
   *     connector-sync / layout-plan-commit jobs lock the entity
   *     transitively. Unique instance ids only — overlapping inputs
   *     don't hit the DB twice.
   *  2. Entity-level: single array-overlap query for non-terminal
   *     `bulk_transform` jobs whose metadata declares any of these
   *     entities as a target (#99). When the throw fires, the error
   *     details enumerate every entity in the input that's blocked
   *     plus the jobs locking them, so the caller can surface the
   *     whole conflict at once rather than one entity at a time.
   *
   * No-op for any id whose entity doesn't exist; the caller's own
   * 404 handling fires for missing rows. Empty input is a no-op.
   *
   * Org-scoped end-to-end — leak across orgs is structurally
   * impossible even if the caller forgets to authz the entities.
   */
  static async assertConnectorEntityUnlocked(
    connectorEntityIds: string[],
    organizationId: string
  ): Promise<void> {
    if (connectorEntityIds.length === 0) return;

    const entities = await Promise.all(
      connectorEntityIds.map((id) =>
        DbService.repository.connectorEntities.findById(id)
      )
    );
    const liveEntities = entities.filter(
      (e): e is NonNullable<typeof e> => e !== null && e !== undefined
    );
    if (liveEntities.length === 0) return;

    // Layer 1: instance-level lock per unique instance.
    const uniqueInstanceIds = Array.from(
      new Set(liveEntities.map((e) => e.connectorInstanceId))
    );
    for (const instanceId of uniqueInstanceIds) {
      await JobLockService.assertConnectorInstanceUnlocked(
        instanceId,
        organizationId
      );
    }

    // Layer 2: entity-level lock (bulk_transform; #85, #99).
    const liveEntityIds = liveEntities.map((e) => e.id);
    const entityLockingJobs =
      await DbService.repository.jobs.findRunningByTargetEntityIds(
        liveEntityIds,
        organizationId
      );
    if (entityLockingJobs.length === 0) return;

    // Enumerate the requested entity ids each locking job blocks.
    const blockedSet = new Set<string>();
    for (const job of entityLockingJobs) {
      const metadataIds =
        (
          job.metadata as {
            targetConnectorEntityIds?: string[];
          }
        )?.targetConnectorEntityIds ?? [];
      for (const id of metadataIds) {
        if (liveEntityIds.includes(id)) blockedSet.add(id);
      }
    }
    const blockedEntities = Array.from(blockedSet).sort();
    const messageLead =
      blockedEntities.length === 1
        ? `Target entity '${blockedEntities[0]}' is locked by an in-flight bulk job`
        : `Target entities ${blockedEntities
            .map((e) => `'${e}'`)
            .join(", ")} are locked by in-flight bulk jobs`;
    throw new ApiError(409, ApiCode.BULK_JOB_TARGET_LOCKED, messageLead, {
      recommendation:
        ApiCodeDefaultRecommendation[ApiCode.BULK_JOB_TARGET_LOCKED],
      details: {
        lockingJobs: entityLockingJobs.map(toSummary),
        blockedEntities,
      },
    });
  }

  /**
   * Lock check for mutations on a single entity record — walks
   * record → connector entity → connector instance and asserts.
   * No-op when the record doesn't exist; the caller's own 404
   * handling fires.
   */
  static async assertEntityRecordUnlocked(
    entityRecordId: string,
    organizationId: string
  ): Promise<void> {
    const record =
      await DbService.repository.entityRecords.findById(entityRecordId);
    if (!record) return;
    await JobLockService.assertConnectorEntityUnlocked(
      [record.connectorEntityId],
      organizationId
    );
  }

  /**
   * Lock check for mutations on a single field mapping — walks
   * mapping → connector entity → connector instance and asserts.
   * No-op when the mapping doesn't exist; the caller's own 404
   * handling fires.
   */
  static async assertFieldMappingUnlocked(
    fieldMappingId: string,
    organizationId: string
  ): Promise<void> {
    const mapping =
      await DbService.repository.fieldMappings.findById(fieldMappingId);
    if (!mapping) return;
    await JobLockService.assertConnectorEntityUnlocked(
      [mapping.connectorEntityId],
      organizationId
    );
  }
}
