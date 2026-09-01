# Delete-records action on the entity view — Plan

**TDD-sequenced implementation of the `entity_record_clear` job (type + lock key + processor), the 202 route repoint, the entity running-jobs endpoint, and the typed-confirmation dialog wired into the entity view.**

Spec: `docs/DELETE_RECORDS_ACTION.spec.md`. Discovery: `docs/DELETE_RECORDS_ACTION.discovery.md`. Issue: #453. Builds on **shipped #451** (join-based clear, no id materialisation) and the `JOB_LOCK_KEYS` / running-jobs infrastructure from #85/#99.

Four slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/delete-records-action`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — contract first, then the API behind it, then the reader, then the UI:

- **Slice 1** — the job exists (core schemas + lock key + processor), but nothing enqueues it. The `JOB_LOCK_KEYS` entry alone already makes a hand-inserted clear job lock the instance — the contract test 4 pins that.
- **Slice 2** — the route mints it: 202 repoint + the guard/exclusion integration proof (including the resync-exclusion case the user decided).
- **Slice 3** — the reader: entity running-jobs finder + endpoint + SDK/keys. Pure addition; independent of slice 2's route body but sequenced after so the API arc completes before web starts.
- **Slice 4** — the UI: dialog + EntityDetail wiring + toasts. Consumes slices 2 and 3.

No migration, no seed (the job rides the existing `jobs` table).

---

## Slice 1 — `entity_record_clear`: core contract + processor

The job type exists end-to-end in the worker, unreachable from any route.

**Files**

- Edit: `packages/core/src/models/job.model.ts` — `JobTypeEnum` + `EntityRecordClearMetadataSchema` (incl. `userId`; JSDoc declares the instance lock) + `EntityRecordClearResultSchema` + `JobTypeMap` + `JOB_TYPE_SCHEMAS` + `JOB_LOCK_KEYS` entries.
- New: `apps/api/src/queues/processors/entity-record-clear.processor.ts` — the transaction lifted from `entity-record.router.ts:1471-1490`; header comment records the no-advisory-lock reasoning (spec Key decision 3).
- Edit: `apps/api/src/queues/processors/index.ts` — registration.
- Extend: `packages/core/src/__tests__/models/job.model.test.ts`; new: `apps/api/src/__tests__/queues/processors/entity-record-clear.processor.test.ts` (ESM-mock shape of `revalidation.processor.test.ts`, **with the `entity-record-count.cache` mock — #377**).

**Steps**

1. **Tests (spec cases 1–4).** Metadata parses / rejects missing `connectorInstanceId`; result rejects negative `deleted`; `JOB_TYPE_SCHEMAS.entity_record_clear` resolves; `jobTypesLocking("connectorInstanceId")` includes the new type. Run; fail (enum member absent).
2. **Implement the core edits.** Green. (`JobTypeMap`/`JOB_TYPE_SCHEMAS` are exhaustive mapped types — the compiler walks you to every required entry.)
3. **Tests (spec cases 5–8).** Processor: both repo calls inside one `DbService.transaction`; returns `{ deleted: N }`; `deleted: 0` skips the wide-table mark; a repo throw propagates. Run; fail.
4. **Implement the processor + registration.** Green.
5. Rebuild `packages/core` (`npm run build`) so `apps/api` compiles against the new dist (`project_stale_core_dist_after_branch_switch`); lint + type-check.

**Done when:** cases 1–8 pass; `npm run type-check` green across core + api; no route mentions the type yet.

**Risk:** forgetting a registry entry — mitigated by the exhaustive types (compile error, not runtime surprise).

---

## Slice 2 — route repoint: DELETE → 202 enqueue

The route mints the job; the guards and the instance-lock exclusion get their integration proof.

**Files**

- Edit: `apps/api/src/routes/entity-record.router.ts` — replace the inline transaction (`:1471-1490`) with `JobsService.create` + `HttpService.success(res, { job }, 202)` (mirror of the revalidation enqueue `:1035-1049`); update the `@openapi` block (202 + `$ref`).
- Edit: `packages/core/src/contracts/entity-record.contract.ts` + `contracts/index.ts` — `EntityRecordClearEnqueuedResponseSchema` (`EntityRecordDeleteResponsePayloadSchema` stays for the single-record delete).
- Edit: `apps/api/src/config/swagger.config.ts` — register the enqueued-response component.
- Edit: `apps/web/src/api/entity-records.api.ts:63-67` — `clear()` return type (compile-only; no UI yet).
- Extend: `apps/api/src/__tests__/__integration__/routes/entity-record.router.integration.test.ts`.

**Steps**

1. **Re-grep for `clear()` callers** (`grep -rn "entityRecords.clear\|\.clear()" apps/web/src`) — confirm the zero-caller premise before the cut (spec risk 1).
2. **Integration tests (spec cases 9–14).** 202 + `{ job }` + pending row with full metadata; 409 under a non-terminal `connector_sync`; **self-lock + resync exclusion** (a non-terminal clear job → second DELETE 409s and the sync enqueue 409s); 422 on `write: false`; processor end-to-end tombstones both tables with parents untouched; second run `{ deleted: 0 }`. Run; fail.
3. **Implement** the route body + contract + swagger component + SDK type. Green.
4. Lint + type-check.

**Done when:** cases 9–14 pass; the old 200 `{ deleted }` shape is gone from the clear route; web compiles with the new return type.

**Risk:** an unseen `clear()` caller — retired by step 1's grep; the SDK type change makes any stray usage a compile error anyway.

---

## Slice 3 — entity running-jobs: finder, endpoint, SDK

The read side the UI's disable/tooltip/alert will consume.

**Files**

- Edit: `apps/api/src/services/job-lock.service.ts` — `findRunningForConnectorEntity(connectorEntityId, connectorInstanceId, organizationId)`: union of `findRunningForConnectorInstance` + `findRunningByTargetEntityIds([id])` (`jobs.repository.ts:169`), `toSummary`-mapped, deduped by job id.
- Edit: `apps/api/src/routes/connector-entity.router.ts` — `GET /:id/running-jobs`, mirror of `connector-instance.router.ts:531` (+ `@openapi`).
- Edit: `packages/core/src/contracts/connector-entity.contract.ts` + `contracts/index.ts` — `ConnectorEntityRunningJobsResponseSchema` (reusing the instance contract's `RunningJobSummary` schema).
- Edit: `apps/web/src/api/connector-entities.api.ts` — `runningJobs(id, options?)`; `apps/web/src/api/keys.ts` — `connectorEntities.runningJobs`.
- Extend: `apps/api/src/__tests__/__integration__/routes/connector-entity.router.integration.test.ts`.

**Steps**

1. **Integration tests (spec cases 15–16).** Returns instance-locking jobs (seed a non-terminal `connector_sync`) **and** entity-targeted jobs (seed a `bulk_transform` with `targetConnectorEntityIds`), deduped, empty when idle; 404 for a foreign-org entity. Run; fail.
2. **Implement** finder + route + contract + SDK + key. Green.
3. Lint + type-check (core rebuild if the contract edit hasn't propagated).

**Done when:** cases 15–16 pass; the SDK query compiles; nothing renders it yet.

**Risk:** dedupe subtlety when one job appears in both queries — the test seeds an `entity_record_clear` (instance-locking) targeting the same entity to force the overlap.

---

## Slice 4 — dialog + entity-view wiring

The user-facing affordance: typed confirmation, disable states, lock alert, SSE, double toast, invalidation.

**Files**

- New: `apps/web/src/components/ClearEntityRecordsDialog.component.tsx` — pure UI per the spec's props/behavior contract.
- New: `apps/web/src/__tests__/ClearEntityRecordsDialog.test.tsx`.
- Edit: `apps/web/src/views/EntityDetail.view.tsx` (+ its existing test file) — runningJobs query, SSE-per-job subscription (`ConnectorInstance.view.tsx:141-215` pattern), `isLocked`/`lockedReason`, the `secondaryActions` item with tooltip, `ConnectorInstanceLockAlert` above the Records section, `useToast` wiring, invalidations.

**Steps**

1. **Dialog tests (spec cases 17–27).** The full Dialog & Form Test Checklist plus exact-label gating. Run; fail.
2. **Implement the dialog.** Green.
3. **View tests (spec cases 28–31).** Disabled+tooltip when jobs run; disabled when write-off; 202 → close + `toast.info` + `invalidateQueries(connectorEntities.runningJobs)` (spy via test-utils `queryClient`); server error keeps the dialog open. Run; fail.
4. **Implement the wiring** (container side of `EntityDetail.view.tsx`; SSE terminal → invalidate `entityRecords.root` + `connectorEntities.root` + runningJobs, `toast.success` with `result.deleted` / `toast.error`). Green.
5. Lint + type-check; full `npm run test:unit` in `apps/web`.

**Done when:** cases 17–31 pass; the Dialog & Form checklist is fully covered; the action renders, disables, confirms, toasts.

**Risk:** SSE double-handling if both the instance view and entity view subscribe to the same job — the terminal handler only invalidates + toasts; invalidation is idempotent and the toast dedupe rule drops an exact visible repeat.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | JobType + lock key + processor | spec cases 1–8; core+api type-check |
| 2 | 202 route repoint + guard/exclusion proof | cases 9–14; zero-caller grep |
| 3 | entity running-jobs finder/endpoint/SDK | cases 15–16 |
| 4 | dialog + view wiring + toasts | cases 17–31; web suite green |

## Cross-slice notes

- **Rebuild `packages/core` after slices 1–3's contract edits** before running api/web suites locally — stale dist is the known trap (`project_stale_core_dist_after_branch_switch`).
- **Doc-sync check (same PR):** the entity view gains a destructive action — re-check `apps/web/src/utils/getting-started.util.ts` and `packages/core/src/content/faq.util.ts` for copy that claims records can only be removed by deleting the connector (update if present; slice 4). No tool surfaces change (`connector-entity-delete.tool.ts` is the *entity* delete — untouched). `@openapi` blocks land inside slices 2–3, not as an afterthought.
- **The #377 rule:** every new api unit-test file that imports a repository or processor mocks `entity-record-count.cache.js` — slice 1's processor test names it explicitly.
- **jobs.worker needs no edit** — dispatch is a map lookup; registration in `processors/index.ts` is the whole wire.

## Next step

Implementation starts on this branch — slice 1, tests-first, one commit per slice — once you confirm the plan.
