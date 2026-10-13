# Job lock coverage — Discovery

**Issue:** [EnterpriseBT/portal-ai#769](https://github.com/EnterpriseBT/portal-ai/issues/769)

**Why this exists.** CLAUDE.md ("Async Job State & Data Locking") says that while a job is running, the entities it owns are read-only across the stack: every mutation answers `409 ENTITY_LOCKED_BY_JOB`, and the UI disables the action, naming the job. The code doesn't hold to that. Each route picks its own checks, revalidation and sync each have a private check outside the registry, the agent's write tools check nothing, and "locked" comes back as three different codes. So a record can be edited by the agent mid-revalidation, a REST import can land mid-bulk-transform, and a column definition can change under a sync. The result is overwritten edits and job output computed from data that changed underneath it, which is the #764 code-review finding that started this.

The rule this work enforces, in the user's words: **you can't modify an object while a job that affects that class of objects is running.** This is the one lock model that decides "does a running job affect this object?" in one place, and that every write path asks.

## The current shape

### Lock mechanism

| Piece | Location | Note |
|---|---|---|
| Registry | `packages/core/src/models/job.model.ts:686-733` (`JOB_LOCK_KEYS`, `jobTypesLocking`) | maps a job type to the **metadata keys** it locks: `connectorInstanceId`, `targetConnectorEntityIds`, `portalId`; `revalidation` and `system_check` are listed as non-locking (`:702`) |
| `JobLockService` | `apps/api/src/services/job-lock.service.ts` | `assertConnectorInstanceUnlocked` (`:131`, returns `ENTITY_LOCKED_BY_JOB`) and `assertConnectorEntityUnlocked` (`:170`, instance check plus target entities, returns **`BULK_JOB_TARGET_LOCKED`** at `:226`); `assertEntityRecordUnlocked` (`:242`) and `assertFieldMappingUnlocked` (`:261`) are **never called** |
| Queries | `apps/api/src/db/repositories/jobs.repository.ts:29-34`, `:78`, `:210` | `NON_TERMINAL_JOB_STATUSES` includes `stalled` (the comment at `:25` says it's excluded); the jsonb keys are hard-coded in SQL |
| Revalidation's own lock | `apps/api/src/services/revalidation.service.ts:15-59` | only `pending`/`active`, filters in JS, **not org-scoped**, `REVALIDATION_ACTIVE`; `assertNoActiveJobForColumnDefinition` fans out over mappings |
| Sync single-flight | `SyncService.assertNoActiveSyncJob` | a separate check, before the instance lock on the sync route |

### What each job writes and reads

| Job | Writes | Reads (an edit would corrupt the output) | Locks today |
|---|---|---|---|
| `connector_sync` | connector_entities, field_mappings, `er__` DDL, entity_records + wide rows, a watermark reap, `connector_instances.lastSyncAt` (`layout-plan-commit.service.ts:381,399,417,777-832`) | column_definitions (`:206`) | instance |
| `layout_plan_commit` | same pipeline, under `SyncLockService.withInstanceLockWait` (`layout-plan-commit.processor.ts:68-87`) | same | instance |
| `entity_record_clear` | one entity's records + wide rows (`entity-record-clear.processor.ts:44,53`) | — | instance |
| `revalidation` | one entity's record validity + wide values (`revalidation.processor.ts:106,117`) | field_mappings, column_definitions, records | **none in the registry** |
| `bulk_transform` | records + wide rows of each target entity (`bulk-transform.service.ts:353`) | the **source** entity's wide table | targets only |
| `bulk_geocode` | one wide column of one entity (`bulk-geocode.processor.ts:222`) | another column of the same entity | entity |
| `file_upload_parse`, `sql_query`, `dissolve_precompute`, `system_check` | no entity data | — | none |

### Write paths and their checks

**REST routes:**
- **Record routes** (`entity-record.router.ts`: create `:799`, import `:990`, PATCH `:1336`, DELETE `:1512`, clear `:1655`) check the instance plus revalidation. They don't see a bulk job on the entity.
- **Revalidate** (`:1194`) checks the instance only.
- **Field mappings:** POST checks the instance plus revalidation; PATCH and DELETE check the entity plus revalidation.
- **Column-definition** PATCH and DELETE (`:651`, `:1050`) check revalidation only.
- **Connector-entity** POST and PATCH check the instance only, and DELETE checks the entity. None of them checks revalidation.
- **Connector-instance** PATCH and DELETE check the instance only.

**Agent tools.** Every tool goes through `wrapWithPermissionGate` → `wrapWithCostGate` → `wrapWithModelOutputCap` (`services/tools.service.ts:921,933,971`). The permission gate is driven by `TOOL_AUTHORIZATION` (`builtin-toolpacks.ts:1746`), which already names each write tool's `resourceType`, `itemsArg` and `idField`. `ToolCapability` has `writes`/`locks` (`tool-capability.model.ts:143-150`), and `entityLockKeys()` (`tool-capabilities.ts:111`) is read by nothing. Lock checks:
- **The nine record, connector-entity and field-mapping tools check no job lock.** The field-mapping tools also never trigger the revalidation the route does.
- **Only `transform_entity_records` and `bulk_geocode_records` check** (`:353`, `:121`).

**Job enqueue.** Every enqueue is a read-then-`JobsService.create`, with no index or lock on `jobs`. The auto-revalidations after a field-mapping or column-definition PATCH (`field-mapping.router.ts:823`, `column-definition.router.ts:796`) swallow errors and check nothing. Recommit (`connector-instance-layout-plans.router.ts:643`) and `sql_query` check nothing before enqueueing.

### Web

- **Running-jobs endpoints:** `GET connector-instances/:id/running-jobs` (`connector-instance.router.ts:602`) and `GET connector-entities/:id/running-jobs` (`connector-entity.router.ts:405`). **Neither returns revalidation.**
- **Views that read them:** `ConnectorInstance.view.tsx`, `EntityDetail.view.tsx`, `EntityRecordDetail.view.tsx` and `EditLayoutPlan.view.tsx`. They build `connectorLockReason` (`utils/running-job-label.util.ts:49`, which always says "on this connector") into the `ActionGate` helpers (`entity-actions.util.ts:56,120`, `connector-instance-actions.util.ts:39`). The alerts dismiss on SSE terminal events.
- **Not lock-aware:** `ColumnDefinitionDetail.view.tsx` (field-mapping create, edit and delete), `Entities.view.tsx`, and the field-mapping dialogs.
- **Missing labels:** `runningJobLabel` has none for clear, bulk_transform or bulk_geocode.

### Error codes

`ENTITY_LOCKED_BY_JOB` (`api-codes.constants.ts:201`), `REVALIDATION_ACTIVE` (`:246`) and `BULK_JOB_TARGET_LOCKED` (`:731`). Outside tests and OpenAPI prose, **no code reads them by name**, web included, so consolidating them is cheap.

### Guard precedents

- **Route authorization:** `route-authorization.map.ts` plus its test walks `app._router.stack` (`express-route-inventory.util.ts`) and fails on an unclassified or stale route.
- **Tools:** `tools.service.test.ts:964` (every tool is cost-gated) and `:1044` (write capabilities ↔ `TOOL_AUTHORIZATION`, both directions).
- **Web:** `action-gate.guard.test.ts` scans source with a shrink-only allowlist.

## The design space

### Decision 1 — Where "does a running job affect this object?" is decided

**A. Fill the gaps per route.** Add the missing asserts route by route and tool by tool. This is the smallest diff, but it's how the gaps happened, and nothing stops the next route from missing one.

**B. A central lock model.** Core declares, per job type, the **scope** it locks. Core also declares, per object class, how an object **resolves to scopes**. One server function, `JobLockService.assertUnlocked(target, ctx)`, resolves the target, finds non-terminal jobs locking any of those scopes, and refuses. Every write path calls it with a typed target.

**C. Database enforcement.** A trigger on each locked table checks `jobs` on every write. It catches everything, including writes we forget, but workers would need a bypass (they *are* the holder), the error isn't a typed 409 with the job named, and it puts business rules in triggers, which this codebase doesn't do.

| | A | B | C |
|---|---|---|---|
| A new write path can miss it | yes | only if the guard misses it | no |
| Worker writes | unaffected | unaffected (checks live at routes/tools) | need a bypass |
| Typed 409 naming the job | per site | one place | hard |
| Size | small, repeated | medium, one time | medium, novel |

**Lean: B.** One decision point plus a guard (Decision 4) is the only shape where coverage can't drift again. C's "catches everything" is attractive, but the bypass and the error surface cost more than the guard does.

### Decision 2 — The granularity of a lock

**A. Per object class.** Each job declares the classes it locks (bulk_geocode: records only; revalidation: records, mappings, column definitions). This is the most precise, and the hardest to get right: deleting the target field mapping mid-geocode breaks the geocode even though "mappings" weren't declared.

**B. Per scope.** A job locks a **scope** (one connector entity, or every entity of a connector instance), and while any job holds a scope, every object that resolves into it is read-only: records, field mappings, the entity itself, and column definitions mapped into it. Read-dependencies count (a transform's source entity is in scope).

| | A per class | B per scope |
|---|---|---|
| Matches "affects that class of objects" | literally | conservatively: everything a job could depend on |
| Risk of an unlisted dependency | real (the mapping-delete case) | none within the scope |
| Over-locking | none | tags/labels on the entity (not job-relevant) stay writable by exclusion, see Open question 3 |
| Size of the registry | job × class matrix | job → scope list |

**Lean: B.** The failures behind #769 were all an unlisted dependency, so a scope lock is the safe default. Object classes still exist, but only to say how a target resolves to scopes.

Scopes per job type:
- `connector_sync`, `layout_plan_commit`, `entity_record_clear`: their instance (today's behaviour, kept).
- `revalidation`, `bulk_geocode`: their entity.
- `bulk_transform`: its target entities **and its source entity**.
- `file_upload_parse`, `sql_query`, `dissolve_precompute`, `system_check`: no scope.

How each object class resolves to scopes:
- **record** → its entity;
- **field mapping** → its entity;
- **connector entity** → itself and its instance;
- **connector instance** → itself and all its entities;
- **column definition** → every entity with a live mapping to it.

### Decision 3 — Agent tools: where the check runs

**A. In each tool's `execute`.** It works, but it's nine more hand-written call sites.

**B. In the permission-gate wrap.** `TOOL_AUTHORIZATION` already says which argument holds the ids and what resource they are. It gains a `lockTarget` (class + id path), and `wrapWithPermissionGate` (or a sibling `wrapWithLockGate` beside it) calls `assertUnlocked` for every item before `execute`. The refusal goes out through the gate's existing typed `{ error: { code, message } }`.

**Lean: B.** Every built-in and custom-tool path already goes through `buildAnalyticsTools`, so this is one place, and a refusal comes before the cost gate, so a refused call is never charged. The existing `:1044` capability ↔ authorization test extends to "every write tool declares a lock target".

### Decision 4 — Guarding coverage in CI

**A. Routes:** extend `route-authorization.map.ts` entries with `locks: <objectClass> | { none: <reason> }` for every mutating route, and have its test fail on a mutating route without one. **B.** A separate lock map file.

**Lean: A for routes.** One map, one inventory walk, and a mutation already has to be classified there. Runtime coverage still needs tests: the map says a route locks, not that the handler calls the check. So each class gets one integration test per route family that holds a job row and expects the 409. For tools, the `lockTarget` field and the `:1044`-style test.

### Decision 5 — Atomicity of check-then-write and check-then-enqueue

Today every check is a read, so a write can pass its check, a job is enqueued, and the write then lands while the job runs. Two enqueues can also race.

**A. Accept the window.** It's milliseconds, prototype-grade.

**B. Transaction-scoped advisory locks per scope.**
- A **write** takes `pg_advisory_xact_lock_shared(scope)` in its transaction, then checks. An **enqueue** takes `pg_advisory_xact_lock(scope)` (exclusive), checks for conflicting jobs, then inserts the job row.
- So a write that passed its check holds the scope until it commits, and an enqueue waits for it. Once the job row exists, every later write sees it.
- Two enqueues serialize.

**C. A unique partial index on `jobs`.** Scopes live in jsonb arrays, so there's no clean index key.

**Lean: B.** It closes both races with the Postgres primitive the codebase already trusts for #460 (`SyncLockService`), without a schema change. The cost is one advisory-lock call per write, plus writes running in a transaction, which the record write model (#760) already does. Keys are a hash of `(scope kind, id)`, as `SyncLockService` keys today. A shared lock taken by a write is never upgraded in the same transaction (see Open question 5).

### Decision 6 — One error code

**Lean: one `409 ENTITY_LOCKED_BY_JOB`** with `details.runningJobs` (`id`, `type`, `startedAt`, and the scope it locks). `BULK_JOB_TARGET_LOCKED` and `REVALIDATION_ACTIVE` are retired, with no aliases (house rule: clean cuts for internal renames). Nothing outside tests reads them by name. `RevalidationService`'s private check and `SyncService.assertNoActiveSyncJob` fold into the central check: revalidation and sync are just job types with scopes.

### Decision 7 — Which statuses lock

`NON_TERMINAL_JOB_STATUSES` includes `stalled`, and revalidation's check covers only `pending`/`active`.

**Lean: every non-terminal status locks, `stalled` included.** That's fail-closed. A stranded job is reaped by the reconciliation sweep (#391), and cancel remains the user's way out. The misleading comment at `jobs.repository.ts:25` is fixed.

## Tradeoff comparison

| | D1 central model | D2 scope locks | D3 lock in the gate | D4 route map + tool field | D5 advisory locks | D6 one code |
|---|---|---|---|---|---|---|
| Closes the agent gap | — | — | yes | guarded | — | — |
| Closes the REST gaps | yes | yes | — | guarded | — | — |
| Closes the races | — | — | — | — | yes | — |
| Contract change | additive (core registry) | — | typed tool error | — | — | yes (codes retired) |
| Carries into spec | yes | yes | yes | yes | yes | yes |

## Recommendation

1. **Scopes in core.** `job.model.ts` replaces `JOB_LOCK_KEYS` with a **lock-scope registry**: per job type, a function from its metadata to the scopes it locks (`{ kind: "connectorInstance" | "connectorEntity", id }[]`). Revalidation, bulk_transform's source and every entity-writing job are included. Each job type's metadata JSDoc states its scopes.
2. **One check.** `JobLockService.assertUnlocked(target, ctx)` takes a typed target (`record` | `fieldMapping` | `connectorEntity` | `connectorInstance` | `columnDefinition`, plus id or parent id). It:
   - resolves the target to scopes;
   - takes a shared advisory lock on each scope in the caller's transaction;
   - finds non-terminal jobs (every non-terminal status, org-scoped) locking any of them;
   - throws `409 ENTITY_LOCKED_BY_JOB` with `details.runningJobs`.
3. **Enqueue.** `JobLockService.enqueueExclusive(job, ctx)` is the one enqueue path for scoped jobs. It takes exclusive advisory locks on the new job's scopes, refuses on a conflicting non-terminal job with the same 409, and inserts the job row in the same transaction. It's used by sync, recommit, clear, revalidate (manual and auto), and the bulk tools.
4. **Routes.** Every mutating route that writes a lockable class calls `assertUnlocked` for its target, replacing today's mix of `assertConnectorInstanceUnlocked`, `assertConnectorEntityUnlocked`, `RevalidationService.assertNoActive*` and `SyncService.assertNoActiveSyncJob`. `route-authorization.map.ts` entries gain `locks`, and its test fails a mutating route without one.
5. **Tools.** `TOOL_AUTHORIZATION` gains `lockTarget` per write tool. The tool gate calls `assertUnlocked` per item before `execute` and before the cost gate. It refuses with the typed `{ error: { code: "ENTITY_LOCKED_BY_JOB", message, runningJobs } }`, so the agent can relay which job to wait for.
6. **One code.** `BULK_JOB_TARGET_LOCKED` and `REVALIDATION_ACTIVE` are removed, and tests and OpenAPI text move to `ENTITY_LOCKED_BY_JOB`.
7. **Web.**
   - **Endpoints:** both running-jobs endpoints return every job whose scopes cover the object, through the same resolver, revalidation included.
   - **Lock-aware views:** `ColumnDefinitionDetail` (and its field-mapping actions), `Entities.view` row actions and the field-mapping dialogs read them.
   - **Labels:** `runningJobLabel` gets labels for every job type, and the lock reason names the scope ("…is running on this entity" / "…on this connector").

## Open questions

1. **Should bulk_transform lock its source entity?** It only reads the source, but an edit mid-run makes the output inconsistent, and the user's rule says "affects". A long transform then blocks edits to its source. **Lean: yes.** Consistency of the job's output wins, and cancel is the way out.
2. **Should read-only jobs (`sql_query`, `dissolve_precompute`) lock anything?** **Lean: no.** They write no entity data, and a query reads one consistent snapshot. Locking every entity a portal query touches would freeze editing during analysis.
3. **What about entity tags, groups, curated views and stations that reference an entity?** No job reads or writes them. **Lean: out of scope, explicitly exempt in the route map** (`locks: { none: "no job reads or writes tags" }`), so the exemption is recorded rather than silent.
4. **Column-definition edits fan out.** A column definition used by 40 entities is refused if any of them has a running job, which on a busy org could be often. **Lean: accept it.** A type or validation change rewrites all 40 entities' validity, so it should wait. The 409 names the job and the entity.
5. **The auto-revalidation after a field-mapping or column-definition edit.** The edit holds a shared lock and then wants to enqueue (exclusive) on the same scope, which is a lock upgrade inside one transaction and deadlock-prone with a second editor. **Lean: enqueue after the write commits, through `enqueueExclusive` in its own transaction.** If a job slipped in between, the enqueue's 409 is logged and the running job's own revalidation covers it (today's `.catch` swallow becomes explicit). The field-mapping *tools* gain the same auto-revalidation the route has.
6. **Should the agent's refusal be a 409 thrown into the tool or a typed result?** **Lean: a typed result** from the gate, like permission refusals, so the agent relays "Re-validation is running on Customers (started 2 min ago)" rather than an error trace, and nothing is charged.
7. **Do worker-internal writes need an exemption?** **Lean: no.** Workers write through repositories, not through routes or tools, so they never meet the check. A worker that calls a route-level service that does check (none found in the survey) would be a bug the integration tests catch.

## Enterprise-scale considerations

- **Concurrency & correctness.** Lean: advisory shared/exclusive locks per scope close both races (write vs enqueue, and enqueue vs enqueue) on every API instance, because the lock lives in Postgres, not in process. Check-then-act becomes atomic.
- **Accuracy & auditability.** Lean: the `jobs` row stays the record of truth for who holds a lock. The 409 names the job, so a refused user can see why and for how long. No new ledger is needed.
- **Failure modes.** Lean: **fail-closed.** If the job lookup errors, the write is refused (`503`, retryable), not allowed, because allowing it is exactly the corruption this prevents. A stuck job is bounded by the reconciliation sweep (#391) and cancel. Prototype-grade fail-open is rejected here.
- **Scale & unbounded growth.** Lean: per write, one indexed lookup on non-terminal jobs, bounded by the few running jobs per org. A column-definition fan-out resolves entity ids in one query. `jobs` needs an index on `(organization_id, status)` partial on non-terminal, if the plan shows a seq scan; that would be measured, not assumed.
- **Multi-tenancy.** Lean: every lookup is org-scoped (revalidation's check isn't today). Advisory lock keys are per scope id, so one org's jobs never block another's writes.
- **Contract stability.** Lean: one 409 shape with `details.runningJobs` is the stable contract for the web and the agent. The scope registry is the extension point for new job types (adding one means declaring its scopes, or the guard fails).
- **Data lifecycle.** N/A because locks end at terminal status, and no retention or time windows are introduced.

## What this doesn't decide

- **Per-class lock precision** (Decision 2A). If a scope lock proves too coarse in practice, it can be refined later without changing the call sites.
- **Locking non-entity objects** (stations, portals, RBAC). No job writes them today. A future job that does declares a new scope kind.
- **UI copy beyond naming the job and its scope.**
- **Cancelling a job from the lock alert:** the Jobs page already does it.

## Next step

`docs/JOB_LOCK_COVERAGE.spec.md` pins the following:
- the registry types and `assertUnlocked` / `enqueueExclusive` signatures;
- the advisory-lock key scheme;
- the 409 shape;
- the route-map `locks` field and the tools' `lockTarget`;
- the web endpoint shape.

`docs/JOB_LOCK_COVERAGE.plan.md` then slices it roughly as:
1. the core scope registry;
2. the server check and enqueue with advisory locks, and the code consolidation;
3. REST routes plus the route-map guard;
4. tools through the gate plus their guard;
5. enqueue paths, including auto-revalidation;
6. web endpoints, gates and labels.

Each slice is a green, testable commit on `fix/769-job-lock-coverage`.
