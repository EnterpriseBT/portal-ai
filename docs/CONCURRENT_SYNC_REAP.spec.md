# Concurrent sync passes reap each other's records — Spec

Pins the ownership seam that makes the watermark reap safe. Discovery: `docs/CONCURRENT_SYNC_REAP.discovery.md`. Issue: [#460](https://github.com/EnterpriseBT/portal-ai/issues/460), epic child of [#444](https://github.com/EnterpriseBT/portal-ai/issues/444).

## Key decisions (flag for review)

1. **No reap predicate fixes this** — the reap is safe iff a single pass owns the entity. Carried from discovery; it is why this spec adds a lock rather than a `WHERE` clause.
2. **The lock key is `connectorInstanceId`, not `connectorEntityId`.** Refined from discovery, which said per-entity. A sync is scoped to an instance, so per-entity would never differ *within* sync — but `layout_plan_commit` also reaps, and both job metadatas already carry `connectorInstanceId` (`job.model.ts:93`, `:193`). One key covers both reapers, and it matches CLAUDE.md's existing entity-lock convention verbatim ("for `layout_plan_commit` and `connector_sync` that's `connectorInstanceId`"). Per-instance still isolates tenants.
3. **The lock lives in the processors, not the adapters.** `connector-sync.processor.ts:49` is the single call site for all three sync adapters. A pass that cannot acquire never calls the adapter at all, so adapters stay unaware and no per-adapter site can be missed — the #436/#441 lesson.
4. **Fail-closed:** a pass that cannot prove ownership does nothing. A delayed sync costs time; an optimistic reap costs customer data.
5. **Holder identity is best-effort.** `pg_try_advisory_lock` does not report who holds the lock. Rather than add a lease table, the superseded result names the other running job found via the existing `jobs` query, and omits the field when none is found.

## Scope

### In scope
- A session-scoped advisory-lock primitive on a reserved Postgres connection.
- Wiring it into `connector-sync.processor.ts`. **`layout-plan-commit.processor.ts` was split out to #461 during slice 2** — see below.
- A `superseded` outcome on the job result, and its `ConnectorSyncResult` declaration.
- Chunking `softDeleteBeforeWatermark` so the reap yields (trigger reduction, explicitly not the fix).
- Closing the pre-existing drift between `SyncInstanceResult` and `ConnectorSyncResultSchema` (below).

### Out of scope
- Post-sync count verification (detection, not a fix — its own ticket).
- Making `attempts` count stall re-deliveries (reporting; #441 territory).
- Queue-wide BullMQ stall tuning.
- Healing already-lost data — a re-sync repairs it; no migration.

## Surface

### `apps/api/src/services/sync-lock.service.ts` (new)

```ts
/** Namespace for this app's advisory locks; keeps `hashtext` collisions
 *  with any other advisory-lock user in the same database impossible. */
export const SYNC_LOCK_NAMESPACE = 0x5359_4e43; // "SYNC"

export type SyncLockOutcome<T> =
  | { acquired: true; value: T }
  | { acquired: false };

export class SyncLockService {
  /**
   * Run `fn` while holding an exclusive advisory lock on
   * `connectorInstanceId`. Returns `{acquired: false}` without running `fn`
   * when another live session holds it.
   */
  static async withInstanceLock<T>(
    connectorInstanceId: string,
    fn: () => Promise<T>
  ): Promise<SyncLockOutcome<T>>;
}
```

Implementation contract, all load-bearing:

- Acquire on a **reserved** connection (`connection.reserve()`, postgres.js 3.4.9) — an advisory lock is session-scoped, so taking it on a pooled connection would leak the lock back into the pool.
- `SELECT pg_try_advisory_lock($1, hashtext($2))` — the **two-int form**, namespaced. `try`, never the blocking `pg_advisory_lock`: a pass that would block is a pass that should abort (discovery D3).
- Release in `finally`: `pg_advisory_unlock` **then** release the reservation, both guarded so a failure in either still releases the connection.
- If the process dies, the TCP session drops and Postgres releases the lock — the liveness property this design is chosen for. No TTL, no renewal.
- `fn`'s own throw propagates after the lock is released.

### `apps/api/src/db/client.ts`

```ts
/** Reserve a dedicated connection from the pool. Callers MUST release it.
 *  Exposed for session-scoped advisory locks (#460), which cannot use a
 *  pooled connection. */
export const reserveConnection = () => connection.reserve();
```

The pool is `max: 10` and worker `concurrency` is 2, so at most 2 are held by syncs. The spec states the **invariant** — reserved connections must stay well below `max` — rather than the numbers, so a change to either is caught by reading this line.

### `apps/api/src/queues/processors/connector-sync.processor.ts`

Wrap the existing `adapter.syncInstance` call (`:49`):

```ts
const outcome = await SyncLockService.withInstanceLock(
  instance.id,
  () => adapter.syncInstance!(instance, userId, { progress, jobId })
);
if (!outcome.acquired) {
  return { recordCounts: {created:0,updated:0,unchanged:0,deleted:0},
           superseded: true,
           ...(otherJobId ? { supersededBy: otherJobId } : {}) };
}
return outcome.value;
```

`otherJobId` comes from the existing `jobs` lookup for a non-terminal `connector_sync` on the same instance with a different id; omitted when none is found (a holder can exist without a distinguishable job row).

### `apps/api/src/queues/processors/layout-plan-commit.processor.ts` — **deferred to #461**

The spec originally called for the same wrapper here. Slice 2 found that it is not the same: `LayoutPlanCommitJobResultSchema` (`job.model.ts:249`) requires `connectorInstanceId`, `planId`, `connectorEntityIds` **and** `recordCounts` — every field. A superseded pass has none of them, so it would report `connectorEntityIds: []` with zeroed counts, which is not an *absence* of a result but a **false one**: a user watching the import wizard would be told their commit finished and produced nothing.

The sync path has no such problem — nobody is blocked on a live wizard reading its counts. Since the two passes also share one job row, a superseded pass finishing *after* the real one would overwrite a good result with an empty one; for a sync that costs a misreported count, for a commit it erases the entity ids the frontend needs.

That is a result-shape design decision, not a wiring one, so it is [#461](https://github.com/EnterpriseBT/portal-ai/issues/461) rather than a rushed wrap here. The exposure is real and is stated in that ticket; it is not being quietly dropped.

### `packages/core/src/models/job.model.ts`

`ConnectorSyncResultSchema` currently declares only `recordCounts` — it has **drifted**: `geometry` (#316) and `mirrorDegraded` (#441) are returned and persisted but undeclared. Nothing parses the schema at runtime (it is a type source via `JobTypeMap`), so the drift is silent. Closing it here rather than extending it:

```ts
export const ConnectorSyncResultSchema = z.object({
  recordCounts: z.object({ /* unchanged */ }),
  geometry: z.object({
    repaired: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    rejectedSample: z.array(z.string()),
  }).optional(),
  mirrorDegraded: z.literal(true).optional(),
  /** #460: this pass did no work — another held the instance lock. */
  superseded: z.literal(true).optional(),
  supersededBy: z.string().optional(),
});
```

### `apps/api/src/adapters/adapter.interface.ts`

`SyncInstanceResult` is **unchanged**. A superseded pass never reaches an adapter, so the field belongs to the job result, not the adapter contract — recorded in a comment so the asymmetry with `mirrorDegraded` reads as deliberate.

### `apps/api/src/db/repositories/entity-records.repository.ts`

`softDeleteBeforeWatermark` gains internal chunking. Today one `UPDATE … RETURNING id` covered 431,960 rows and held the event loop long enough to starve BullMQ's lock renewal — the observed trigger.

```ts
async softDeleteBeforeWatermark(
  connectorEntityId: string,
  watermarkMs: number,
  deletedBy: string,
  client: DbClient = db
): Promise<string[]>   // signature unchanged
```

Loops `UPDATE … WHERE id IN (SELECT id FROM entity_records WHERE … LIMIT REAP_CHUNK_SIZE) RETURNING id`, accumulating until a chunk returns 0. `REAP_CHUNK_SIZE = 5_000`, exported. Callers see no change. **Labelled in-file as trigger reduction, not the fix** — a slow reap on a loaded box still stalls.

## Migration / Seed

**None.** No schema change: the lock is advisory, and `superseded` rides the existing `jobs.result` JSONB.

## TDD test plan

### `apps/api/src/__tests__/services/sync-lock.service.test.ts` (unit, connection mocked)
1. Acquires and runs `fn`, returning `{acquired: true, value}`.
2. Returns `{acquired: false}` and **does not call `fn`** when `pg_try_advisory_lock` returns false.
3. Releases the lock and the reservation on the success path.
4. Releases both when `fn` throws, and rethrows.
5. Releases the reservation even when `pg_advisory_unlock` itself throws.
6. Uses the namespaced two-int form (asserted on the issued SQL).

### `apps/api/src/__tests__/__integration__/services/sync-lock.integration.test.ts` (real DB)
7. Two concurrent `withInstanceLock` calls on one id: exactly one runs `fn`.
8. Different instance ids do not block each other.
9. **The lock releases when the holding session ends** — hold on one connection, end it, then acquire from another. This is the liveness property the whole design rests on, so it is asserted against a real server, not a mock.

### `apps/api/src/__tests__/queues/processors/connector-sync.processor.test.ts` (extend)
10. Lock acquired → adapter called, its result returned unchanged.
11. Lock not acquired → **adapter never called**, result is `superseded: true` with zeroed counts.
12. `supersededBy` names the other running job when one exists; omitted when not.
13. The job still reports `completed`, not `failed` — nothing failed (#441's principle).

### `apps/api/src/__tests__/__integration__/db/repositories/entity-records-reap.integration.test.ts`
14. Chunked reap returns exactly the ids it soft-deleted, matching the unchunked result on the same fixture.
15. Never touches rows at or above the watermark.
16. Returns `[]` on nothing to reap.
17. A reap spanning multiple chunks returns every id once (no duplicates, no gaps).

### `apps/api/src/__tests__/__integration__/adapters/concurrent-sync-reap.integration.test.ts`
18. **The regression test.** Two interleaved passes over one entity, where pass A's writes land after pass B has read: with the lock, every source record is still live afterwards. Asserted on row counts — the #442 lesson that plan/timing assertions do not survive a fixture.

**Totals ≈ 18 cases.** Run via `npm run test:unit` / `npm run test:integration` from `apps/api` — never raw jest.

## Acceptance criteria

- Two concurrent sync passes over one connector instance cannot both run; the second does no work and reports `superseded`.
- A superseded pass reports a non-failed terminal status.
- When a lock-holding process dies, a later pass acquires the lock without operator action.
- A sync's reap no longer issues a single statement over the whole reap set.
- After an interleaved double pass, every record present in the source is live.
- No schema migration is required.
- `ConnectorSyncResultSchema` declares every field the sync actually returns.

## Risks & rollback

- **Pool exhaustion** — a reserved connection per running sync. Bounded by worker concurrency (2) against `max: 10`; the invariant is stated at `reserveConnection`. Detected as connection-acquisition timeouts. Rollback: revert the wrapper; the lock is advisory so nothing persists.
- **A wedged holder blocks progress.** Accepted in discovery: a takeover protocol would re-introduce the liveness guessing this design removes. Visible as repeated `superseded` results, which is why the field exists.
- **Fail-closed on lock infrastructure** — if Postgres is unreachable the sync cannot run regardless, so there is no separate fail-open path to design.
- **The chunked reap is not the fix.** If it is mistaken for one and the lock is dropped, the loss returns under a slower reap. The in-file label and this line are the guard.

## Files touched

- New: `services/sync-lock.service.ts`; two integration test files; one unit test file.
- Edit: `db/client.ts` (`reserveConnection`), `queues/processors/connector-sync.processor.ts`, `queues/processors/layout-plan-commit.processor.ts`, `db/repositories/entity-records.repository.ts` (chunking), `adapters/adapter.interface.ts` (comment only), `packages/core/src/models/job.model.ts` (schema drift + `superseded`).

## Next step

`docs/CONCURRENT_SYNC_REAP.plan.md` — four slices: the lock primitive and its release-on-death behaviour; the processor wiring and superseded outcome; the reap chunking; the interleaved-passes regression test. Each a commit on `fix/concurrent-sync-reap`.
