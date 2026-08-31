# Delete-records action on the entity view — Discovery

**Issue:** [EnterpriseBT/portal-ai#453](https://github.com/EnterpriseBT/portal-ai/issues/453)

**Why this exists.** `DELETE /api/connector-entities/{id}/records` clears every record of an entity, and `sdk.entityRecords.clear()` wraps it — but nothing in `apps/web` calls it. A user who wants to empty an entity (re-import a mis-mapped dataset, clear test data before a real sync) must instead delete the whole connector instance, losing the entity, its field mappings, and the wide table. #451 (which blocked this) has landed: the route now soft-deletes via a server-side join, measured live at **66s for a 400,920-record entity** with no id materialisation. This is the ticket that gives that route a UI path — a confirmed, guarded, lock-aware "Delete records" action on the entity view.

## The current shape

### The entity view

`apps/web/src/views/EntityDetail.view.tsx` — `EntityDetailViewUI` (pure, `:161`) + `EntityDetailView` container (`:528`), routed from `routes/entities.$entityId.index.tsx`.

| Piece | Location | Note |
|---|---|---|
| Header actions | `EntityDetail.view.tsx:259-293` | `PageHeader` with Edit (`primaryAction`) and a Delete-entity `secondaryActions` item, both gated on `isWriteEnabled` |
| Records toolbar | `EntityDetail.view.tsx:368-408` | "Re-validate All" + "Create" on the Records `PageSection` |
| Record count | `EntityDetail.view.tsx:314` | `MetadataList` renders `recordCount.toLocaleString()` from `sdk.entityRecords.count` (`:554`) |
| Write gating | `EntityDetail.view.tsx:706` | `instance?.enabledCapabilityFlags?.write === true` from `sdk.connectorInstances.get` (`:550`) |
| Destructive precedent | `EntityDetail.view.tsx:621-641` | `handleDelete`: mutate → close dialog → invalidate `connectorEntities/entityRecords/fieldMappings/entityGroups` roots → navigate |
| No toast, no lock query | — | the view raises no toasts and runs no running-jobs query today |

### The route and its guards

`apps/api/src/routes/entity-record.router.ts:1453` — `entityRecordRouter.delete("/")`. All three guards already exist (`:1461-1469`): `resolveEntityOrThrow` → `assertWriteCapability` (422 `CONNECTOR_INSTANCE_WRITE_DISABLED`, `resolve-capabilities.util.ts:47-77`) → `JobLockService.assertConnectorInstanceUnlocked` (409 `ENTITY_LOCKED_BY_JOB` with `details.runningJobs`, `job-lock.service.ts:94-107`) → `RevalidationService.assertNoActiveJob` (**409 `REVALIDATION_ACTIVE`** — a second code the UI must accept). Body (`:1471-1490`): one transaction, `entityRecords.softDeleteByConnectorEntityId` + `wideTable.markDeletedByConnectorEntity`, returns `{ deleted }` (`entity-record.contract.ts:174`). The entity-aware lock check `JobLockService.assertConnectorEntityUnlocked` (`job-lock.service.ts:137`) exists and is used by `connector-entity.router.ts:846`.

### SDK, keys, dialogs, lock UI

| Piece | Location | Note |
|---|---|---|
| `clear()` | `apps/web/src/api/entity-records.api.ts:63-67` | bare `useAuthMutation` DELETE; the **calling view owns invalidation** (house style) |
| Query keys | `apps/web/src/api/keys.ts:99-117`, `:47-55` | `entityRecords.root/list/count/get`, `connectorEntities.root/…` |
| Typed-confirm exemplar | `components/DeleteOrganizationDialog.component.tsx` | form-as-paper Modal, `useDialogAutoFocus`, type-the-name equality check, `FormAlert` — but no `validateWithSchema` |
| Impact-summary exemplar | `components/DeleteConnectorEntityDialog.component.tsx:42-94` | shows counts before deleting |
| Lock-state precedent | `views/ConnectorInstance.view.tsx:131-229, :361-375` | `sdk.connectorInstances.runningJobs` → SSE per job → invalidate on terminal → `isLocked`/`lockedReason` feeding disabled buttons with tooltips |
| Running-jobs endpoint | `connector-instance.router.ts:531` | **instance-scoped only** — no entity-scoped variant exists (repo support does: `jobs.repository.ts:169`) |

### Job machinery (if the clear becomes a job)

New JobType = `JobTypeEnum` + metadata/result schemas + `JobTypeMap` + `JOB_TYPE_SCHEMAS` (exhaustive — compile error if missed) in `packages/core/src/models/job.model.ts:39-652`, a processor + one line in `queues/processors/index.ts:20`. Closest shape: `revalidation` (entity-scoped, enqueued from this same router at `:1035`, idempotent "already active" no-op). Batched purge idiom: `entity-record-retention-purge.processor.ts` (`PURGE_BATCH_SIZE = 10_000`). HTTP budget: ALB `idle_timeout` = **180s** (`infra/cloudformation/backend.yml:436`), raised from 60 for synchronous XLSX parse with an in-file comment already calling that bucket tech debt.

## The design space

### Decision 1 — synchronous route or queued job

The issue deferred this pending #451's number. The number is in: 66s at 400K rows, against a 180s ALB budget.

**A. Keep the route synchronous.** UI holds a pending state on the mutation for however long the clear takes.

**B. New `entity_record_clear` job type.** Route becomes a 202 enqueue (the `clear()` SDK action has zero callers, so the response-shape change is a clean cut); processor runs the same join-delete transaction; `JOB_LOCK_KEYS` gives the entity lock for free; SSE terminal event drives invalidation + completion toast.

**C. Threshold hybrid** — sync under N records, job above.

| | A (sync) | B (job) | C (hybrid) |
|---|---|---|---|
| 400K today | 66s blocked request — fits 180s | 202 in ms; work off-request | fits |
| 1.5M tomorrow | extrapolates past the ALB budget — hard fail | unchanged | job path |
| Lock semantics | route guards only; nothing marks the entity locked *during* the clear | job row + `JOB_LOCK_KEYS` lock the entity for the duration, visible to every other surface | two behaviors |
| Durable outcome | lost if the task restarts mid-request | job row records who/when/deleted-count | split record |
| Build cost | none | JobType + schemas + processor + SSE wiring in the view | both, plus a threshold to justify |
| UX | minutes-long spinner in a dialog | close dialog on enqueue, toast, live lock alert, completion toast | inconsistent |

**Lean: B — confirmed at review.** 1.5M-row entities are a real target, not a hypothetical (user, 2026-08-31), which takes option A off the table on the ALB budget alone. The acceptance criteria also demand what only a job provides: "clearing while a job is non-terminal is refused" cuts both ways — a running *clear* must lock against a resync, and only a job row makes the clear visible to the lock system. `revalidation` is the template — same router, same entity scope.

### Decision 2 — how the view knows the entity is locked

**A. Reuse `sdk.connectorInstances.runningJobs`** (the view already has `connectorInstanceId`) — covers instance-level locks; entity-only jobs (`bulk_transform`, `bulk_geocode`, the new clear) surface only as a post-attempt 409.

**B. New `GET /api/connector-entities/:id/running-jobs`**, mirroring the instance route but calling the entity-aware repo query (`jobs.repository.ts:169`), so the disable-with-tooltip matches exactly what `assertConnectorEntityUnlocked` would reject.

| | A | B |
|---|---|---|
| Parity with the 409 | partial | exact |
| New surface | none | one small route + SDK entry + key |
| Tooltip content | instance jobs only | every job that would block, by name |

**Lean: B.** The deliverable says the tooltip names the running job; a disable that misses entity-scoped jobs invites the exact "button worked yesterday, 409 today" confusion the rule exists to prevent. The route is a thin wrapper over an existing repo method.

### Decision 3 — confirmation dialog shape

**A. Typed confirmation of the entity label** (à la `DeleteOrganizationDialog`), plus an impact line showing the live record count (à la `DeleteConnectorEntityDialog`). Validation via `validateWithSchema` with a Zod schema requiring the exact label — bringing the typed-confirm pattern into compliance with the Form & Dialog rules the org dialog predates.

**B. Typed confirmation of the record count.** Rejected quickly: the count changes under the user (syncs land), making the confirmation flaky by design.

**Lean: A.** Stable token, both exemplars combined, and the first `validateWithSchema`-compliant typed-confirm becomes the reference implementation.

## Tradeoff comparison

| | D1: queued job | D2: entity running-jobs route | D3: typed label + impact count |
|---|---|---|---|
| Spread to spec | Yes — route contract (202), JobType schemas, lock key | Yes — new endpoint contract | Yes — dialog contract only |
| Packages touched | core + api + web | api + web | web |
| Reversible later | route could regain a sync fast-path | additive | additive |

## Recommendation

1. Add JobType `entity_record_clear` (metadata: `connectorEntityId`, `connectorInstanceId`, `organizationId`; result: `{ deleted }`) modeled on `revalidation`, with the processor running the existing join-delete transaction from `entity-record.router.ts:1471-1490`, batched per the retention-purge idiom if measurement demands it. **Its `JOB_LOCK_KEYS` entry keys `connectorInstanceId`** — the same key `connector_sync` and `layout_plan_commit` use — so a running clear locks the whole connector instance and a resync attempt anywhere on it is refused by the existing `assertConnectorInstanceUnlocked` with zero new mechanism (decided at review: a mid-clear resync is the scenario to prevent, and sibling-entity convenience does not outweigh it).
2. Repoint `DELETE /api/connector-entities/{id}/records` to validate the existing three guards, enqueue the job, and return 202 `{ jobId }` — a clean cut of the response shape (zero SDK callers today).
3. Add `GET /api/connector-entities/:id/running-jobs` mirroring the instance route over `jobs.repository.ts:169`, an SDK entry, and a `queryKeys.connectorEntities.runningJobs` key.
4. Add `ClearEntityRecordsDialog.component.tsx`: Form & Dialog Pattern throughout, typed entity-label confirmation via `validateWithSchema`, impact line with the live record count, `FormAlert` accepting both `ENTITY_LOCKED_BY_JOB` and `REVALIDATION_ACTIVE`.
5. Wire the action as a `secondaryActions` item on the entity `PageHeader` next to Delete-entity, disabled with a tooltip when (a) any running job would lock the entity (from the new query, SSE-refreshed per the ConnectorInstance.view precedent) or (b) `isWriteEnabled` is false.
6. On 202: close the dialog, `toast.info` "Clearing N records…", invalidate `connectorEntities.runningJobs`; on the SSE terminal event: invalidate `entityRecords.root` + `connectorEntities.root`, `toast.success` with the deleted count (`toast.error` with the job error on failure).

## Open questions

1. **Does the clear processor need `SyncLockService.withInstanceLock` (#460/#461)?** It deletes *everything* rather than reaping by watermark, so a stall re-delivered second pass double-soft-deletes idempotently. **Lean: no advisory lock** — record the reasoning in the processor header instead; the job-lock key already excludes concurrent syncs at enqueue time.
2. **Does the entity view **Does the entity view also gain the `ConnectorInstanceLockAlert`-style inline alert while the clear runs?** The Async Job State rules say entity-detail views with running-job exposure surface lock state inline. **Lean: yes, reuse `ConnectorInstanceLockAlert` (it already takes a plain `runningJobs` array) fed from the new entity query.**

## Enterprise-scale considerations

- **Concurrency & correctness** — Lean: the instance-keyed job-lock makes a running clear mutually exclusive with syncs/imports across the whole connector at enqueue time on every surface, and the clear itself is idempotent (soft-delete of already-soft-deleted rows is a no-op), so stall re-delivery needs no advisory lock (open question 1 records why).
- **Accuracy & auditability** — Lean: the job row is the durable record — who cleared, when, `{ deleted }` count — which a synchronous route never had; no separate ledger warranted for a recoverable soft-delete.
- **Failure modes** — Lean: fail-closed by construction (all three route guards precede the enqueue; a worker death is caught by the #441/#464 machinery and surfaces on the job row). Redis down → enqueue fails → `FormAlert` in the still-open dialog.
- **Scale & unbounded growth** — Lean: the join-delete is server-side with no id marshalling (#451); the processor inherits that, and the 202 decouples clear duration from the HTTP budget entirely — the 1.5M-row future costs nothing extra.
- **Multi-tenancy** — Lean: org scoping rides the existing `resolveEntityOrThrow` guard; the running-jobs route copies the instance route's org check. No new isolation surface.
- **Contract stability** — Lean: `{ jobId }` on 202 and `{ deleted }` on the job result are the same shapes every other job uses, so tier gating or quota metering can wrap the enqueue later without re-plumbing.
- **Data lifecycle** — Lean: cleared rows are parent-live tombstones and age out under #442's `ENTITY_RECORD_RETENTION_DAYS` (30d) — the retention system this feature's output feeds already exists; nothing new to design.

## What this doesn't decide

- **Filtered/selective deletion** — different query surface, different confirmation semantics; explicitly out of scope on the ticket.
- **Undo / restore UI** — rows are recoverable by hand for 30 days (#442 window); a restore surface is its own feature.
- **A `portalai` CLI clear command** — waived in the PRD (2026-08-31 amendment); operator path can be its own ticket.
- **Retiring the ALB 180s idle-timeout debt** — this ticket removes one long-synchronous consumer; the XLSX parse comment's "revisit" stays open.
- **A generic entity-scoped SSE channel** — the per-job SSE + invalidation precedent from ConnectorInstance.view is reused as-is.

## Next step

`docs/DELETE_RECORDS_ACTION.spec.md` (contracts: the 202 response, the `entity_record_clear` schemas + lock key, the entity running-jobs endpoint, the dialog's behavior table) and `docs/DELETE_RECORDS_ACTION.plan.md`. Likely slicing: (1) JobType + processor + repointed route with guards, integration-tested; (2) entity running-jobs endpoint + SDK + keys; (3) dialog + view wiring + toasts + lock alert, unit-tested per the Dialog & Form checklist; (4) smoke doc.
