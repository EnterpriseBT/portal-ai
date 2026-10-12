/**
 * #769: the one job-lock model (CLAUDE.md §"Async Job State & Data Locking").
 *
 * A running job locks the scopes core's `JOB_LOCK_SCOPES` gives its type (one
 * connector entity, or a whole connector instance), stored on its row as
 * `jobs.lock_scopes`. A write names what it changes as a `LockTarget`, which
 * resolves to scope keys; while a non-terminal job holds any of them, the
 * write answers `409 ENTITY_LOCKED_BY_JOB` with `details.runningJobs`.
 *
 *  - `withUnlocked` wraps a write: shared advisory locks on its keys, the
 *    check, then the write, in one transaction.
 *  - `enqueueExclusive` starts a scoped job: exclusive locks, the check, and
 *    the job row in one transaction, queued after commit.
 *  - `findRunning` feeds the running-jobs endpoints and the UI's gates.
 *  - `assertNoneRunning` is a non-atomic pre-check for work worth skipping
 *    (a model call, a fetch) before the write re-checks.
 *
 * Every REST write route declares its target in the route-authorization map,
 * and every agent write tool in `TOOL_AUTHORIZATION.lock`; guards fail CI on
 * one that doesn't.
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

/**
 * A running job as the lock surfaces report it. `lockScopes` is narrowed to
 * the keys the caller asked about (`visible`): a job's scopes come from its
 * metadata, which is its creator's (#692), so a reader learns only that it
 * holds what they're looking at, never its other entities.
 */
function toSummary(row: JobSelect, visible: string[]): RunningJobSummary {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    startedAt: row.startedAt,
    created: row.created,
    lockScopes: row.lockScopes.filter((k) => visible.includes(k)),
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
      details: { runningJobs: running.map((r) => toSummary(r, keys)) },
    }
  );
}

type LockMode = "shared" | "exclusive";

/** Take a transaction-scoped advisory lock on each key, in sorted order so
 *  two lockers never deadlock on each other's keys. A key asked for in both
 *  modes is taken exclusive. */
async function lockKeys(
  tx: DbClient,
  keys: string[] | Map<string, LockMode>,
  mode: LockMode = "shared"
): Promise<void> {
  const modes =
    keys instanceof Map
      ? keys
      : new Map(keys.map((k): [string, LockMode] => [k, mode]));
  for (const key of [...modes.keys()].sort()) {
    const fn =
      modes.get(key) === "exclusive"
        ? "pg_advisory_xact_lock"
        : "pg_advisory_xact_lock_shared";
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
    ).map((r) => toSummary(r, keys));
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
      // The job's own scopes are taken exclusive. An instance job also takes
      // its entities exclusive (it writes them all); an entity job takes its
      // instance only shared, so it conflicts with instance-wide jobs and
      // writes to its own entity, not with work on sibling entities.
      const modes = new Map<string, LockMode>();
      for (const target of targets) {
        const resolved = await JobLockService.resolveScopeKeys(
          [target],
          params.organizationId,
          tx
        );
        for (const key of resolved) {
          const mode: LockMode =
            target.kind === "connectorInstance" || key.startsWith("entity:")
              ? "exclusive"
              : "shared";
          if (modes.get(key) !== "exclusive") modes.set(key, mode);
        }
      }
      for (const key of declared) modes.set(key, "exclusive");
      const keys = [...modes.keys()];
      await lockKeys(tx, modes);
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
    return rows.map((r) => toSummary(r, []));
  }
}
