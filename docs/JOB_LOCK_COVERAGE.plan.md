# Job lock coverage — Plan

**This plan implements, test-first, one lock model for running jobs and puts every write path behind it:**
- the core lock-scope registry and `jobs.lock_scopes`;
- `JobLockService.withUnlocked` / `enqueueExclusive` on advisory locks;
- every REST route and agent write tool behind them;
- one 409 code, with route and tool guards;
- lock-aware web gates.

Spec: `docs/JOB_LOCK_COVERAGE.spec.md`. Discovery: `docs/JOB_LOCK_COVERAGE.discovery.md`. Issue: #769. It builds on shipped #760 (`RecordWriteService`), #761, #764 and #765 (the revalidation processor and batch writes).

It has eight slices. Each sits behind a green test suite and leaves the repo compilable. They land as **commits on `fix/769-job-lock-coverage` / PR #771**, one feature in one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package, never jest directly (`feedback_use_npm_test_scripts`). Integration needs `AUTH_API_RATE_LIMIT_PER_MIN=1000000`.

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice runs the same loop:
1. write the failing tests;
2. make the smallest change that turns them green;
3. run the focused suites;
4. at the boundary, run `npm run lint && npm run type-check` (plus the root `npm run build` after a core change, per memory);
5. move to the next slice.

Sequencing rationale. The new lock model lands **beside** the old asserts, call sites move over family by family, and the old API and codes are deleted only once nothing calls them. The tree stays green throughout.
- **Slice 1:** the data the model runs on (registry and column). Nothing reads it yet.
- **Slice 2:** the service (`withUnlocked`, `enqueueExclusive`, `findRunning`), additive, proven at service level, including the race.
- **Slice 3:** record and field-mapping routes, the ones behind the #764 finding, plus revalidation's enqueue.
- **Slice 4:** every other mutating route and enqueue path, the running-jobs endpoints, and the route-map guard. After it, every route uses the new model.
- **Slice 5:** the tool lock gate. After it, the agent can't race a job.
- **Slice 6:** delete the old asserts and codes, and have plain job creation refuse scoped types. This is safe only once slices 3–5 have moved every caller.
- **Slice 7:** web.
- **Slice 8:** docs sync.

---

## Slice 1 — Lock-scope registry and `jobs.lock_scopes`

This slice adds the data the model runs on: what each job type locks, stored on its row. Nothing reads it yet.

**Files**

- Edit: `packages/core/src/models/job.model.ts`:
  - `LockScopeKind`, `LockScope`, `lockScopeKey`, `JOB_LOCK_SCOPES` (exhaustive over `JobType`), `jobLockScopes`;
  - `RunningJobSummarySchema`;
  - `JobSchema.lockScopes`;
  - JSDoc on each `*MetadataSchema` naming its scopes.

  `JOB_LOCK_KEYS` is untouched this slice.
- New: `packages/core/src/__tests__/models/job-lock-scopes.test.ts`.
- Edit: `apps/api/src/db/schema/jobs.table.ts`, `zod.ts`, `type-checks.ts`: the `lock_scopes` column.
- New: `apps/api/drizzle/0120_job-lock-scopes.sql` plus the journal and snapshot, via `npm run db:generate -- --name job-lock-scopes`, then hand-add the backfill and the partial GIN index.
- Edit: `apps/api/src/services/jobs.service.ts`: split `create` into `insertRow(userId, params, client)` and `dispatch(job)`. `insertRow` sets `lockScopes`, and `create` = `insertRow` + `dispatch`.

**Steps**

1. **Tests (spec: core ≈ 8; API integration "migration" case; one `jobs.service` unit case).**
   - **Core:** each job type's scopes, `lockScopeKey`, bulk_transform's source deduped against a target, and the registry exhaustive.
   - **API unit:** `insertRow` stores `lockScopes` from the registry.
   - **API integration:** a non-terminal job row inserted with the pre-migration shape gets its backfilled scopes, and terminal rows keep `'{}'`.

   Run; they fail.
2. **Implement** the registry, the column, and the migration with its backfill. Also update every `JobSchema` fixture or `model.update` site that must now set `lockScopes`: `JobModelFactory` gets a default of `[]`, so the create path doesn't break (memory: "Required model field breaks the create path"). Green.
3. `npm run lint:migrations`, `npm run db:migrate` locally, root `npm run build`, lint and type-check.

**Done when:** the core registry tests pass; a job row created through `JobsService.create` carries `lock_scopes`; the migration test passes.

**Risk:** the required model field. Grep `JobSchema.parse`, `model.update` and job fixtures in api and web tests, and run the root build.

---

## Slice 2 — `JobLockService`: resolve, find, `withUnlocked`, `enqueueExclusive`

This slice adds the new lock API beside the old one. No route calls it yet.

**Files**

- Edit: `apps/api/src/services/job-lock.service.ts`: `LockTarget`, `JOB_LOCK_NAMESPACE`, `resolveScopeKeys`, `findRunning`, `withUnlocked`, `enqueueExclusive` (with `onSameJob`), and the 409 builder (the message names the job label and the narrowest scope). The old asserts stay.
- Edit: `apps/api/src/db/repositories/jobs.repository.ts`: `findRunningByScopeKeys(keys, organizationId, client)` (the `lock_scopes && $keys` overlap on non-terminal statuses), and the corrected `NON_TERMINAL_JOB_STATUSES` comment.
- Edit: `apps/api/src/__tests__/services/job-lock.service.test.ts`: the new unit cases.
- New: `apps/api/src/__tests__/__integration__/services/job-lock.integration.test.ts`.

**Steps**

1. **Tests (spec: `job-lock.service.test.ts` ≈ 12; the service-level integration cases).**
   - **Resolution:**
     - `resolveScopeKeys` for each target kind, including a column definition fanning out to two entities on two instances, and a missing object resolving to `[]`;
     - `findRunning` across every non-terminal status, ignoring terminal ones;
     - org isolation.
   - **`withUnlocked`:**
     - it takes shared locks in sorted order;
     - `fn` runs on the same tx;
     - the 409 shape carries `details.runningJobs` with `lockScopes`.
   - **`enqueueExclusive`:**
     - it refuses on an overlapping scope (entity job vs instance job, both directions);
     - `reuse` returns the running job;
     - dispatch happens only after commit.
   - **Race test (deterministic), modelled on #760's row-lock test:**
     - transaction A holds `withUnlocked` on an entity, and B's `enqueueExclusive` waits;
     - after A commits, B's job row exists and a new `withUnlocked` refuses;
     - and the reverse order.

   Run; they fail.
2. **Implement.** Green.
3. Lint and type-check.

**Done when:** every case above passes, and nothing outside the tests calls the new API yet.

**Risk:** advisory-lock behaviour on the postgres-js pool. The race test must fail with the locks removed (verify, as #760's did).

---

## Slice 3 — Record and field-mapping routes; revalidation enqueue

This slice moves the record and field-mapping write paths onto the new model.

**Files**

- Edit: `apps/api/src/routes/entity-record.router.ts`:
  - **create, import, PATCH, DELETE:** call `withUnlocked({ kind: "record" })`, with the writes on its tx (`RecordWriteService.patchRecord` already takes a tx);
  - **clear:** `enqueueExclusive(entity_record_clear)`;
  - **revalidate:** `enqueueExclusive(revalidation, reuse)`.
- Edit: `apps/api/src/services/revalidation.service.ts`: `enqueue` goes through `enqueueExclusive(…, { onSameJob: "reuse" })`. `findActiveJob` and the asserts stay until slice 6.
- Edit: `apps/api/src/routes/field-mapping.router.ts`: POST, PATCH and DELETE call `withUnlocked({ kind: "fieldMapping" })`. Auto-revalidation moves after commit: it runs `enqueueExclusive`, and on a 409 it logs and doesn't throw.
- Edit: the matching route integration suites (`entity-record.router`, `field-mapping.router`, `revalidation`).

**Steps**

1. **Tests (spec integration: record and field-mapping per-target cases; "revalidation blocks a record PATCH"; "bulk_geocode blocks a field-mapping delete"; "bulk_transform blocks edits to its source"; enqueue conflicts for revalidate and clear; auto-revalidation).**
   - Seed a non-terminal job row with `lock_scopes` and expect the 409 naming it. The same write succeeds after the job is set `completed`.
   - Existing tests that expect `REVALIDATION_ACTIVE` or `BULK_JOB_TARGET_LOCKED` from these routes switch to `ENTITY_LOCKED_BY_JOB`.

   Run; they fail.
2. **Implement.** Green. Rerun the #760/#761/#764 revalidation suites.
3. Lint and type-check.

**Done when:** the record and field-mapping routes refuse during any job in scope, and revalidate and clear enqueue exclusively.

**Risk:** some route writes don't take a client today. Thread `tx` through the service call (most repositories take `client`); don't open a second transaction inside `fn`.

---

## Slice 4 — Every other mutating route; enqueue paths; running-jobs endpoints; route-map guard

After this slice, every REST write path uses the new model, and CI enforces it.

**Files**

- Edit:
  - `column-definition.router.ts`: PATCH and DELETE call `withUnlocked({ kind: "columnDefinition" })`, with per-entity auto-revalidation after commit; add the new `GET /:id/running-jobs` (`@openapi`).
  - `connector-entity.router.ts`: POST (instance target), PATCH and DELETE (entity target); the `running-jobs` GET uses `findRunning`.
  - `connector-instance.router.ts`: PATCH and DELETE (instance target); sync goes through `enqueueExclusive(connector_sync)`; the `running-jobs` GET uses `findRunning`.
  - `connector-instance-layout-plans.router.ts`: plan PATCH (instance target); recommit goes through `enqueueExclusive(layout_plan_commit)`.
  - `api-endpoints.router.ts`: entity-config writes use the entity target.
- Edit: `apps/api/src/__tests__/config/route-authorization.map.ts`: the `RouteLocks` type, plus a `locks` entry on every non-GET route (`target`, `enqueues`, or `none: <reason>` for stations, portals, views, tags, groups, RBAC, billing and so on). Edit `route-authorization.test.ts` with the three guard rules and a "bites" case.
- Edit: the route integration suites for the routers above.

**Steps**

1. **Tests (spec integration: connector-entity, connector-instance and column-definition fan-out cases; "sync blocks a column-definition PATCH"; "sync during clear → 409"; the running-jobs endpoints including revalidation; the new column-definition endpoint; guard unit ≈ 3).** Run; they fail.
2. **Implement** the routes and endpoints. Then classify the whole route map: the guard lists every unclassified mutating route, and each gets a target or a recorded `none` reason. Green.
3. Lint and type-check.

**Done when:** the route-map guard passes, with every non-GET route classified, and every case above passes.

**Risk:** this is the largest slice, around 100 map entries. Most are `none` for non-entity domains. If review shows it's too big, split it into routes (4a) and the guard (4b).

---

## Slice 5 — The tool lock gate

After this slice, the agent's write tools can't race a job, and CI enforces it.

**Files**

- Edit: `packages/core/src/registries/builtin-toolpacks.ts`: the `ToolAuthorization` type gains a required `lock`, filled for all 11 write tools (`target` with `itemsArg`, `idField` and `resolve`, or `enqueues`).
- New: `apps/api/src/services/lock-gate.service.ts`, `wrapWithLockGate`, plus `apps/api/src/__tests__/services/lock-gate.service.test.ts`.
- Edit: `apps/api/src/services/tools.service.ts`: apply it between the permission gate and the cost gate.
- Edit: `tools/transform-entity-records.tool.ts` and `bulk-geocode-records.tool.ts`: `enqueueExclusive` in place of `assertConnectorEntityUnlocked` + `JobsService.create`.
- Edit: `tools/field-mapping-update.tool.ts` and `-delete.tool.ts`: post-commit auto-revalidation.
- Edit: `apps/api/src/prompts/system.prompt.ts`, plus `system.prompt.test.ts` if it pins wording, to say how to relay a lock refusal.
- Edit: `apps/api/src/__tests__/services/tools.service.test.ts`: every tool is lock-gated; every write capability has a `lock`; the gate order.

**Steps**

1. **Tests (spec: `lock-gate.service.test.ts` ≈ 7; `tools.service.test.ts` ≈ 3; the integration case "`entity_record_update` during a revalidation → typed refusal, nothing written, not charged"; bulk-tool tests updated).** Run; they fail.
2. **Implement.** Green.
3. Root `npm run build` (core changed), then lint and type-check.

**Done when:** the tool guard passes, and the integration refusal case passes with no usage charge recorded.

**Risk:** the gate holds a connection for the length of a tool call (spec Risks). Note the pool observation in the smoke run.

---

## Slice 6 — Delete the old model; one code; scoped jobs only through `enqueueExclusive`

This slice removes the old lock APIs and codes. It's safe only now: slices 3–5 moved every caller.

**Files**

- Edit:
  - `job-lock.service.ts`: remove `assertConnectorInstanceUnlocked`, `assertConnectorEntityUnlocked`, `assertEntityRecordUnlocked`, `assertFieldMappingUnlocked`, and `findRunningFor*`.
  - `revalidation.service.ts`: remove `findActiveJob` and the `assertNoActive*` checks.
  - `sync.service.ts`: remove `assertNoActiveSyncJob`.
  - `jobs.repository.ts`: remove `findRunningByTargetEntityIds` and the instance query.
  - `job.model.ts`: `JOB_LOCK_KEYS` reduced to `portalId`.
  - `api-codes.constants.ts`: remove `BULK_JOB_TARGET_LOCKED` and `REVALIDATION_ACTIVE`, with their recommendations; set the `ENTITY_LOCKED_BY_JOB` recommendation.
  - `jobs.service.ts`: `create` throws for a type with non-empty scopes.
- Edit: every test still naming the removed APIs or codes:
  - api: `revalidation.service.test.ts`, `api-codes.constants.test.ts`, and the bulk-tool tests;
  - core: `api.contract.test.ts`;
  - web: the `ClearEntityRecordsDialog` and `auth-mutation-permission-denied` fixtures.
- Edit: OpenAPI prose that cites the old codes (`api-endpoints.router.ts`, `entity-record.router.ts`, `connector-entity.router.ts`).

**Steps**

1. **Tests:** a unit test that `create` refuses a scoped type, and a grep-style unit assertion that no source under `apps/api/src` or `apps/web/src` names the removed codes. Run; they fail.
2. **Delete and update.** Green across the api unit and integration suites (the full touched set) and the web unit suites that referenced the codes.
3. Root build, lint and type-check.

**Done when:** nothing references the removed APIs or codes, and every scoped job is created through `enqueueExclusive`.

**Risk:** a missed enqueue site now throws instead of skipping its lock. The `create` guard makes that loud in tests, which is the point.

---

## Slice 7 — Web: labels, scope-aware reasons, lock-aware gates

After this slice, the UI disables actions during any job in scope and names it.

**Files**

- Edit: `apps/web/src/utils/running-job-label.util.ts`: an exhaustive `runningJobLabel`; `jobLockReason(jobs, here)` replaces `connectorLockReason`.
- Edit: `entity-actions.util.ts` and `connector-instance-actions.util.ts`: take the reason from `jobLockReason`.
- Edit: `apps/web/src/api/column-definitions.api.ts` and `keys.ts`: `runningJobs`.
- Edit:
  - `EntityDetail.view.tsx`: drop the local `isRevalidating` lock.
  - `EntityRecordDetail.view.tsx` and `ConnectorInstance.view.tsx`: use the new reason.
  - `ColumnDefinitionDetail.view.tsx`: its gates.
  - `EditFieldMappingDialog` and `DeleteFieldMappingDialog`: a `lockedReason` prop.
- Edit: the matching tests and stories.

**Steps**

1. **Tests (spec web ≈ 12):**
   - a label for every type;
   - `jobLockReason` naming the entity vs the connector;
   - a running revalidation disabling the entity, record and column-definition actions with the reason;
   - the dialogs: submit disabled, Enter doesn't submit, the reason rendered.

   Run; they fail.
2. **Implement.** Green.
3. Lint and type-check, with `action-gate.guard.test.ts` and `dialog-enter-submit.guard.test.ts` green.

**Done when:** the web cases pass and the guards hold.

**Risk:** none beyond the guards.

---

## Slice 8 — Docs sync

Bring the docs in line with the new lock model.

**Files**

- Edit: `CLAUDE.md` "Async Job State & Data Locking" (plus `.github/copilot-instructions.md`). It should say:
  - a job declares its scopes in `JOB_LOCK_SCOPES`;
  - writes go through `withUnlocked` and enqueues through `enqueueExclusive`;
  - every non-terminal status locks;
  - there is one 409;
  - the route map's `locks` and the tools' `lock` are enforced in CI.

  Also update "When you add a new long-running job" steps 1–2.
- Edit: OpenAPI text on routes that changed codes (anything not done in slice 6).

**Steps**

1. **Tests:** `lint:doc-pointers` and any doc-pinning test pass.
2. **Edit.**
3. Lint.

**Done when:** the docs describe the model that shipped.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | Registry, `lock_scopes`, migration, `insertRow`/`dispatch` | core tests + migration test + root build |
| 2 | `withUnlocked` / `enqueueExclusive` / `findRunning` | service unit + integration, the race |
| 3 | Record and field-mapping routes, revalidation enqueue | route integration |
| 4 | All other routes, enqueues, endpoints, route-map guard | guard + integration |
| 5 | Tool lock gate, bulk tools, prompt, tool guard | gate unit + tools guard + integration |
| 6 | Old API and codes removed; `create` refuses scoped types | full touched suites |
| 7 | Web labels, reasons, gates | web unit + web guards |
| 8 | CLAUDE.md / Copilot mirror / OpenAPI | doc checks |

## Cross-slice notes

- **Core changes ripple.** After slices 1, 5 and 6, run the root `npm run build` before pushing (memory: a core model field breaks web and site fixtures, and per-package type-check misses it).
- **Migration.** Commit the `.sql`, `_journal.json` and snapshot together. `npm run dev` doesn't migrate, so run `npm run db:migrate` before the smoke walk.
- **The old asserts and the new API coexist through slices 2–5.** A route may briefly call neither or both only within its own slice. Every slice boundary is green.
- **Existing tests that pin the old codes** move to `ENTITY_LOCKED_BY_JOB` in the slice that moves their route, and the code definitions go in slice 6.
- **Doc surfaces** (CLAUDE.md, the Copilot mirror, `system.prompt.ts`, OpenAPI) are part of this PR: slices 5 and 8.
- **Smoke.** The smoke walk later needs real running jobs. A long revalidation on a seeded entity gives a dependable window. The local environment can suspend long jobs (memory), so seed sizes accordingly.

## Next step

Implementation starts on `fix/769-job-lock-coverage` with slice 1, tests first, one commit per slice, once this plan is confirmed.
