# Job lock coverage — Spec

Pins the contract for #769: one lock model in which a running job makes every object in its scope read-only, enforced on every write path. Discovery: `docs/JOB_LOCK_COVERAGE.discovery.md`. Issue: [#769](https://github.com/EnterpriseBT/portal-ai/issues/769).

## Key decisions (flag for review)

1. **Scope locks, not per-class locks.** A job locks scopes (`connectorEntity` / `connectorInstance`), and every object resolving into a locked scope is read-only (Discovery D2). A bulk transform's **source** entity is in scope (OQ1).
2. **Scopes are stored on the job row.** A new `jobs.lock_scopes text[]` column is written once at creation from the core registry, with a GIN index, so one generic overlap query replaces today's per-key jsonb SQL. This is the one schema change.
3. **Atomic by advisory locks.** A write takes *shared* transaction-scoped advisory locks on its expanded scope keys, then checks. An enqueue takes *exclusive* ones, checks, and inserts the job row in the same transaction (D5).
4. **One code.** `409 ENTITY_LOCKED_BY_JOB` with `details.runningJobs`. `BULK_JOB_TARGET_LOCKED` and `REVALIDATION_ACTIVE` are removed, with no aliases (D6).
5. **Every non-terminal status locks**, `stalled` included (D7). The check is **fail-closed by construction**: it runs in the write's transaction, so a failed lookup fails the write.
6. **Tools are checked in a new gate**, between the permission and cost gates. A refusal is a typed tool result and isn't charged (D3, OQ6).
7. **Auto-revalidation after a mapping or column-definition edit is enqueued after that edit commits.** A conflict is logged, not thrown (OQ5).
8. **The Entities list row actions are not gated in the UI.** Their 409 surfaces through `serverErrorMessage` in a toast. Gating them would need a per-row running-jobs fan-out; see Out of scope.

## Scope

### In scope

- The core lock-scope registry, `jobs.lock_scopes`, and `JobLockService` rewritten around `withUnlocked` / `enqueueExclusive` / `findRunning`.
- Every mutating REST route that writes a record, field mapping, connector entity, column definition or connector instance, and every job enqueue.
- The nine record, connector-entity and field-mapping tools, and the two bulk tools.
- Guards for routes (route map `locks`) and for tools (`TOOL_AUTHORIZATION.lock`).
- Web: the running-jobs endpoints include every locking job; lock-aware gates on entity, record, connector-instance and column-definition pages and the field-mapping dialogs; labels for every job type; reasons that name the scope.
- Docs: CLAUDE.md "Async Job State & Data Locking" (plus the Copilot mirror), the agent prompt's guidance on a lock refusal, and OpenAPI text.

### Out of scope

- The portal chat lock (`JOB_LOCK_KEYS.portalId`): unchanged, kept as the registry's only remaining key.
- Locking non-entity objects (stations, portals, curated views, tags, groups, RBAC). The route map records each as `locks: { none: <reason> }`.
- Gating row actions in the Entities list (Key decision 8).
- Per-class lock precision.

## Surface

### Core — `packages/core/src/models/job.model.ts`

```ts
export type LockScopeKind = "connectorEntity" | "connectorInstance";
export interface LockScope { kind: LockScopeKind; id: string }

/** "entity:<id>" | "instance:<id>": the form stored in jobs.lock_scopes and hashed for advisory locks. */
export function lockScopeKey(scope: LockScope): string;

/**
 * Exhaustive over JobType, so a new job type fails type-check until it
 * declares its scopes ([] when it writes no entity data).
 */
export const JOB_LOCK_SCOPES: { [T in JobType]: (metadata: JobMetadataFor<T>) => LockScope[] };
export function jobLockScopes(type: JobType, metadata: unknown): LockScope[];
```

| Job type | Scopes |
|---|---|
| `connector_sync`, `layout_plan_commit`, `entity_record_clear` | `[{ connectorInstance: metadata.connectorInstanceId }]` |
| `revalidation`, `bulk_geocode` | `[{ connectorEntity: metadata.connectorEntityId }]` |
| `bulk_transform` | each of `metadata.targetConnectorEntityIds`, plus `metadata.sourceConnectorEntityId` (deduped) |
| `file_upload_parse`, `sql_query`, `dissolve_precompute`, `system_check` | `[]` |

- **`JOB_LOCK_KEYS`** shrinks to `{ bulk_transform: { portalId }, bulk_geocode: { portalId } }`, the portal chat lock only. Its `connectorInstanceId` and `targetConnectorEntityIds` fields and `lockingTypes` users for them are removed.
- **`JobSchema`** gains `lockScopes: z.array(z.string())`.
- **Each job type's `*MetadataSchema` JSDoc** states its scopes.
- **`RunningJobSummary`** moves to core as `RunningJobSummarySchema = { id, type, status, startedAt: number | null, created, lockScopes: string[] }`, so the API and web share one shape.

### DB — `apps/api/src/db/schema/jobs.table.ts`

- `lockScopes: text("lock_scopes").array().notNull().default(sql\`'{}'\`)`.
- A partial GIN index, `jobs_lock_scopes_live_idx ON jobs USING gin (lock_scopes) WHERE status IN ('pending','active','awaiting_confirmation','stalled')`.
- `zod.ts` and `type-checks.ts` are updated per the dual-schema rule.

### API — `JobLockService` (`apps/api/src/services/job-lock.service.ts`)

```ts
export type LockTarget =
  | { kind: "record"; connectorEntityId: string }          // create/import/update/delete/clear
  | { kind: "fieldMapping"; connectorEntityId: string }    // resolved from the mapping by the caller
  | { kind: "connectorEntity"; id: string }
  | { kind: "connectorInstance"; id: string }
  | { kind: "columnDefinition"; id: string };

/** Expands targets to scope keys: an entity → itself + its instance; an instance →
 *  itself + its live entities; a column definition → every entity with a live
 *  mapping to it, + their instances. Org-scoped; a missing object resolves to []. */
static resolveScopeKeys(targets: LockTarget[], organizationId: string, client: DbClient): Promise<string[]>;

/** Non-terminal jobs in the org whose lock_scopes overlap the keys. */
static findRunning(targets: LockTarget[], organizationId: string, client?: DbClient): Promise<RunningJobSummary[]>;

/** Opens a transaction, takes pg_advisory_xact_lock_shared(JOB_LOCK_NAMESPACE, hashtext(key))
 *  on each resolved key in sorted order, throws 409 if findRunning is non-empty, then runs
 *  fn(tx). The caller's writes go on tx. */
static withUnlocked<T>(targets: LockTarget | LockTarget[], ctx: { organizationId: string },
  fn: (tx: DbClient) => Promise<T>): Promise<T>;

/** Opens a transaction, takes EXCLUSIVE advisory locks on the new job's expanded scope keys
 *  (sorted), checks findRunning, and inserts the job row (with lockScopes) in that transaction;
 *  after commit, dispatches it to BullMQ. A conflicting job → 409, except onSameJob: "reuse"
 *  returns a running job of the same type and identical lockScopes instead (revalidation's
 *  idempotent enqueue). */
static enqueueExclusive(userId: string, params: JobCreateRequestBody,
  opts?: { onSameJob?: "refuse" | "reuse" }): Promise<JobSelect>;
```

- **Advisory namespace.** `JOB_LOCK_NAMESPACE` is a new 32-bit constant, distinct from `SyncLockService`'s instance and upgrade namespaces (`sync-lock.service.ts:7-48`), so no key collides.
- **The 409.** `new ApiError(409, ApiCode.ENTITY_LOCKED_BY_JOB, "<Label> is running on this <entity|connector>; try again when it finishes.", { recommendation, details: { runningJobs } })`. The message names the first job's label and the narrowest scope it shares with the target.
- **Removed:**
  - `JobLockService`: `assertConnectorInstanceUnlocked`, `assertConnectorEntityUnlocked`, `assertEntityRecordUnlocked`, `assertFieldMappingUnlocked`, `findRunningForConnectorInstance`, `findRunningForConnectorEntity`;
  - `RevalidationService`: `findActiveJob`, `assertNoActiveJob`, `assertNoActiveJobForColumnDefinition`; `RevalidationService.enqueue` becomes `enqueueExclusive(…, { onSameJob: "reuse" })`;
  - `SyncService.assertNoActiveSyncJob`;
  - `JobsRepository.findRunningByTargetEntityIds` and its instance counterpart.
- **`JobsService.create`** splits into `insertRow(userId, params, client)`, which sets `lockScopes = jobLockScopes(type, metadata).map(lockScopeKey)`, and `dispatch(job)` (the BullMQ add plus `bullJobId`). `create` = `insertRow` + `dispatch`, kept for jobs without scopes. Every scoped job type is created only through `enqueueExclusive`; a unit test asserts `create` refuses a type whose scopes are non-empty.
- **`NON_TERMINAL_JOB_STATUSES`**'s comment is corrected: `stalled` locks.

### API — error codes (`api-codes.constants.ts`)

`BULK_JOB_TARGET_LOCKED` and `REVALIDATION_ACTIVE` are removed, along with their recommendations. `ENTITY_LOCKED_BY_JOB`'s recommendation: "Wait for the running job to finish, or cancel it from Jobs."

### API — routes

Every mutating handler that writes a lockable object wraps its writes in `withUnlocked(target, …, tx => …)`; every job-starting handler uses `enqueueExclusive`.

| Routes | Target / enqueue |
|---|---|
| Records: `POST …/records`, `POST …/records/import`, `PATCH …/records/:recordId`, `DELETE …/records/:recordId` | `{ record, connectorEntityId }` |
| `DELETE …/records` (clear) | `enqueueExclusive(entity_record_clear)` |
| `POST …/records/revalidate` | `enqueueExclusive(revalidation, { onSameJob: "reuse" })` |
| `POST /api/field-mappings`, `PATCH|DELETE /api/field-mappings/:id` | `{ fieldMapping, connectorEntityId }`, then auto-revalidation after commit (Key decision 7) |
| `PATCH|DELETE /api/column-definitions/:id` | `{ columnDefinition, id }`, then auto-revalidation per affected entity after commit |
| `POST /api/connector-entities` | `{ connectorInstance, id }` |
| `PATCH|DELETE /api/connector-entities/:id` and the api-endpoints entity routes | `{ connectorEntity, id }` |
| `PATCH|DELETE /api/connector-instances/:id`, layout-plan PATCH | `{ connectorInstance, id }` |
| Sync, recommit | `enqueueExclusive(connector_sync | layout_plan_commit)` |

The list is the known set. The route-map guard below makes the full set exhaustive.

`GET /api/connector-instances/:id/running-jobs` and `GET /api/connector-entities/:id/running-jobs` return `{ runningJobs: RunningJobSummary[] }` from `findRunning` with the matching target, so revalidation and entity-scoped jobs show up. New: `GET /api/column-definitions/:id/running-jobs` (target `columnDefinition`), with the same shape, `@openapi`-documented, authorized like the column-definition GET.

### API — route-map guard (`apps/api/src/__tests__/config/route-authorization.map.ts`)

```ts
export type RouteLocks =
  | { target: LockTarget["kind"] }
  | { enqueues: JobType }
  | { none: string };          // the reason no job reads or writes what it changes
export type RouteAuthorization = ({ kind: "authorized"; by: string } | { kind: "exempt"; reason: string })
  & { locks?: RouteLocks };
```

`route-authorization.test.ts` fails when:
- a non-GET route lacks `locks`;
- a GET route has `locks`;
- a `none` reason has fewer than 10 characters.

### API — tool gate

- **`TOOL_AUTHORIZATION`** entries (`packages/core/src/registries/builtin-toolpacks.ts:1746`) gain a required `lock`, typed `{ target: LockTarget["kind"]; itemsArg: string; idField: string; resolve?: "fieldMappingEntity" | "recordEntity" } | { enqueues: JobType }`:
  - create and record tools read `items[].connectorEntityId` or `items[].connectorInstanceId`;
  - update and delete tools resolve the item id to its entity (`resolve`);
  - the bulk tools declare `enqueues` and call `enqueueExclusive` themselves.
- **`wrapWithLockGate(tools, ctx, authFor)`** (new, `apps/api/src/services/lock-gate.service.ts`) is applied in `ToolService.buildAnalyticsTools` after `wrapWithPermissionGate` and before `wrapWithCostGate`. For a `target` lock it runs `withUnlocked(targets, ctx, () => original(input, options))`, so the shared locks are held for the tool's whole execution. A 409 becomes:

  ```ts
  { error: { code: "ENTITY_LOCKED_BY_JOB", message, runningJobs } }   // typed result, never a throw
  ```

  An `ApiError(409, ENTITY_LOCKED_BY_JOB)` thrown inside `execute` (by `enqueueExclusive`) is converted the same way.
- **The field-mapping update and delete tools** trigger the same post-commit auto-revalidation as the route.
- **`system.prompt.ts`** tells the agent to relay a lock refusal (the job and scope) and not to retry until the job finishes.

### Web

- **`running-job-label.util.ts`:** `runningJobLabel` covers every `JobType`, via an exhaustive switch. `connectorLockReason` is replaced by `jobLockReason(jobs: RunningJobSummary[], here: LockScope)`, which returns "<Label> is running on this entity" when a job's `lockScopes` include `entity:<here.id>`, else "…on this connector".
- **SDK:** `sdk.columnDefinitions.runningJobs(id)` (`useAuthQuery`, `queryKeys.columnDefinitions.runningJobs(id)`).
- **Views and gates:**
  - `EntityDetail.view` drops the local `isRevalidating` lock (a running revalidation now comes from the server list).
  - `EntityRecordDetail.view` and `ConnectorInstance.view` use `jobLockReason`.
  - `ColumnDefinitionDetail.view` gates edit and delete and its field-mapping create, edit and delete actions on the column definition's running jobs.
  - `EditFieldMappingDialog` and `DeleteFieldMappingDialog` receive a `lockedReason` prop and render a disabled submit with the reason.
  - All gates go through the existing `ActionGate` helpers, with `disable{reason}`.
- **Alerts** dismiss on the SSE terminal event, as today.

## Migration

`npm run db:generate -- --name job-lock-scopes`, with the `.sql`, `meta/_journal.json` and snapshot committed together:
1. Add `lock_scopes text[] NOT NULL DEFAULT '{}'`.
2. A data step backfills non-terminal jobs from `metadata`:
   - `instance:` + `connectorInstanceId` for sync, layout_plan_commit and clear;
   - `entity:` + `connectorEntityId` for revalidation and bulk_geocode;
   - `entity:` + each target and the source for bulk_transform.
3. The partial GIN index.

It's expand-only, with no destructive DDL, so `lint:migrations` passes. Terminal jobs keep `'{}'`, which is correct since they lock nothing.

## Seed

None.

## TDD test plan

Run `npm run test:unit` / `npm run test:integration` from `packages/core`, `apps/api` and `apps/web`. Integration needs `AUTH_API_RATE_LIMIT_PER_MIN=1000000`.

### Core (`packages/core/src/__tests__/models/job-lock-scopes.test.ts`, new): ~8

- Each job type's scopes from sample metadata: the instance types, the entity types, bulk_transform with its source deduped against a target, and the scope-less types.
- `lockScopeKey` format.
- The registry is exhaustive: one case per `JobType`.

### API unit

- `job-lock.service.test.ts`, rewritten (~12):
  - `resolveScopeKeys` for each target kind, including column-definition fan-out and a missing object;
  - `withUnlocked` takes shared locks in sorted order, throws the 409 shape, and runs `fn` on the same tx;
  - `enqueueExclusive` refuses on overlap, `reuse` returns the running job, and dispatch runs after commit only;
  - `create` refuses a scoped type.
- `lock-gate.service.test.ts`, new (~7):
  - a target lock wraps `execute` in `withUnlocked`;
  - item ids are resolved through `resolve`;
  - a 409 becomes the typed result;
  - a thrown 409 from `execute` is converted;
  - an `enqueues` lock skips the pre-check;
  - refused calls never reach the cost gate.
- `tools.service.test.ts` (~3): every tool is lock-gated; every write capability has a `TOOL_AUTHORIZATION.lock`; gate order is permission → lock → cost.
- `route-authorization.test.ts` (~3): non-GET without `locks` fails; GET with `locks` fails; the "bites" case.
- `revalidation.service.test.ts`, `api-codes.constants.test.ts`, and the bulk-tool tests, updated for the removed APIs and codes (~6 changed).

### API integration (`apps/api/src/__tests__/__integration__/services/job-lock.integration.test.ts`, new, plus route suites): ~24

- **Per target kind, a seeded non-terminal job row refuses the write with a 409 naming it** (records, field mapping, connector entity, connector instance, column-definition fan-out). The same writes succeed once the job is `completed`.
- **Each job type locks its scope:** a revalidation blocks a record PATCH; a bulk_geocode blocks a field-mapping delete; a bulk_transform blocks edits to its **source**; a sync blocks a column-definition PATCH on a mapped entity.
- **Every non-terminal status locks** (one case each); terminal statuses don't.
- **Org isolation:** a job in org B never blocks a write in org A.
- **Race (deterministic):**
  - transaction A holds `withUnlocked` on an entity, and `enqueueExclusive` for a revalidation on it waits;
  - once A commits, the job row exists and a second write is refused;
  - and the reverse: an enqueue holding its exclusive lock blocks a write's shared lock.
- **Enqueue conflicts:** revalidate during a bulk transform on the entity is a 409; revalidate twice gives `reuse` (the same job id); sync during clear is a 409.
- **Auto-revalidation:** after a field-mapping PATCH commits it enqueues; when a job holds the entity it logs and doesn't throw.
- **Tools** (through `buildAnalyticsTools`): `entity_record_update` during a revalidation returns the typed refusal, writes nothing, and isn't charged.
- **Running-jobs endpoints** include a revalidation and an entity-scoped job; the new column-definition endpoint lists jobs on mapped entities.
- **Migration:** a non-terminal job row from before the migration is locked after the backfill.

### Web unit (~12)

- `running-job-label.util.test.ts`: a label for every type; `jobLockReason` for entity vs connector scope.
- `EntityDetailView`, `EntityRecordDetail` and `ColumnDefinitionDetail` tests: a running revalidation disables the actions with the reason.
- `EditFieldMappingDialog` / `DeleteFieldMappingDialog`: a `lockedReason` disables submit, Enter doesn't submit, and the reason renders.
- The existing `ClearEntityRecordsDialog` and `auth-mutation-permission-denied` tests updated for the removed codes.

**Totals ≈ 75 cases** (≈ 8 core, ≈ 31 API unit, ≈ 24 API integration, ≈ 12 web).

## Acceptance criteria

- [ ] Any non-terminal job (every non-terminal status) refuses every REST write to an object in its scope with `409 ENTITY_LOCKED_BY_JOB` naming the job. This covers records, field mappings, connector entities, connector instances and column definitions (through every entity that maps them).
- [ ] A revalidation, a bulk geocode and a bulk transform (target and source) lock their entities. A sync, a layout-plan commit and a clear lock their whole connector.
- [ ] The agent's record, connector-entity and field-mapping tools return a typed `ENTITY_LOCKED_BY_JOB` refusal during such a job, write nothing, and aren't charged.
- [ ] A job can't be started while a conflicting job holds an overlapping scope (409). Re-validate All while one is already running returns the running job.
- [ ] A write and a job start on the same scope can't interleave: the write either completes before the job row exists or is refused.
- [ ] A job in another org never blocks a write.
- [ ] `BULK_JOB_TARGET_LOCKED` and `REVALIDATION_ACTIVE` no longer exist.
- [ ] CI fails on a mutating route without a `locks` classification and on a write tool without a `lock`.
- [ ] In the app, while a revalidation runs on an entity, its detail page shows the lock alert and disables Edit, Create, Delete records and Re-validate All with "Revalidation is running on this entity". The record page, the column-definition page and the field-mapping dialogs behave the same.
- [ ] Every job type has a label.

## Risks & rollback

- **Over-locking frustrates users.** Long jobs, especially a transform's source or a column definition used widely, block edits. Detection: 409 rates in logs. The 409 names the job, and cancel is on the Jobs page. Rollback is per job type: drop a type's scopes in `JOB_LOCK_SCOPES`, with no migration.
- **Connection-pool pressure from the tool gate.** The gate holds a transaction open for a tool's whole run, so a tool call uses two connections. Agent calls are low concurrency, but this is measured in the smoke run; if needed, the record tools can move to the caller's tx.
- **Deadlock.** Keys are always taken in sorted order. Writes take shared and enqueues exclusive locks, and no transaction upgrades (auto-revalidation runs after commit). The race test covers both orders.
- **Fail mode: fail-closed.** The check and the write share a transaction, so a lock-lookup failure fails the write (500/503 as today). It never allows an unchecked write. That is the intended cost/safety trade: a refused edit is retryable, while a corrupted job output isn't.
- **Rollback:** revert the PR. The migration is additive; `lock_scopes` is ignored by old code.

## Files touched

- **Core:**
  - `packages/core/src/models/job.model.ts`
  - `packages/core/src/registries/builtin-toolpacks.ts` (`lock` on `TOOL_AUTHORIZATION`, and its type)
  - new test `packages/core/src/__tests__/models/job-lock-scopes.test.ts`
- **API schema:**
  - `apps/api/src/db/schema/jobs.table.ts`, `zod.ts`, `type-checks.ts`
  - `apps/api/drizzle/0120_job-lock-scopes.sql`, plus meta
- **API services:**
  - `apps/api/src/services/job-lock.service.ts`, `jobs.service.ts`, `revalidation.service.ts`, `sync.service.ts`
  - new `apps/api/src/services/lock-gate.service.ts`
  - `apps/api/src/services/tools.service.ts`
- **API repository and codes:** `apps/api/src/db/repositories/jobs.repository.ts`, `apps/api/src/constants/api-codes.constants.ts`
- **API routes:**
  - `apps/api/src/routes/`: `entity-record.router.ts`, `field-mapping.router.ts`, `column-definition.router.ts`, `connector-entity.router.ts`, `connector-instance.router.ts`, `connector-instance-layout-plans.router.ts`, `api-endpoints.router.ts`
  - `apps/api/src/config/swagger.config.ts` (if a shape is registered)
- **API tools:** `entity-record-*`, `connector-entity-*`, `field-mapping-*`, `transform-entity-records`, `bulk-geocode-records` (`.tool.ts`)
- **API prompt:** `apps/api/src/prompts/system.prompt.ts`
- **API tests:**
  - `apps/api/src/__tests__/config/route-authorization.map.ts` and `.test.ts`
  - new `job-lock.integration.test.ts`
  - the suites named above
- **Web:**
  - `apps/web/src/utils/running-job-label.util.ts`, `entity-actions.util.ts`, `connector-instance-actions.util.ts`
  - `apps/web/src/api/column-definitions.api.ts`, `keys.ts`
  - views: `EntityDetail`, `EntityRecordDetail`, `ConnectorInstance`, `ColumnDefinitionDetail`
  - `EditFieldMappingDialog` and `DeleteFieldMappingDialog` components, and their tests
- **Docs:** `CLAUDE.md` ("Async Job State & Data Locking"), `.github/copilot-instructions.md`

## Next step

`docs/JOB_LOCK_COVERAGE.plan.md` sequences this in about seven TDD slices on `fix/769-job-lock-coverage`:
1. the core registry and `jobs.lock_scopes` migration;
2. `JobLockService` (`resolveScopeKeys` / `findRunning` / `withUnlocked` / `enqueueExclusive`) and the job creation split;
3. record and field-mapping routes, plus the code consolidation;
4. column-definition, connector-entity, connector-instance and layout-plan routes, enqueue paths, and the route-map guard;
5. the tool lock gate, tools and prompt;
6. web endpoints, labels and gates;
7. the CLAUDE.md and OpenAPI docs sync.
