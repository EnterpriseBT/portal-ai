# Delete-records action on the entity view — Spec

**Issue:** [EnterpriseBT/portal-ai#453](https://github.com/EnterpriseBT/portal-ai/issues/453) · **Discovery:** `docs/DELETE_RECORDS_ACTION.discovery.md`

Pins the contract for giving `DELETE /api/connector-entities/{id}/records` a UI path: the clear becomes a queued **`entity_record_clear`** job that locks the whole connector instance (`JOB_LOCK_KEYS`, same key as `connector_sync`), a new entity-scoped running-jobs endpoint powers the disable-with-tooltip, and a typed-confirmation dialog + double toast wire it into the entity view.

## Key decisions (flag for review)

1. **Queued job, not synchronous** — 1.5M-row entities are a real target (user, 2026-08-31); 66s@400K already brushes the 180s ALB budget.
2. **A running clear locks the entire connector instance** via the existing `JOB_LOCK_KEYS` infrastructure — a mid-clear resync is refused by `assertConnectorInstanceUnlocked` with zero new mechanism (user, 2026-08-31).
3. **No advisory lock in the processor** — the clear deletes everything rather than reaping by watermark, so a stall re-delivered second pass double-soft-deletes idempotently; the processor header records this reasoning (#460/#461 context).
4. **Clean-cut response change** — the route's 200 `{ deleted }` becomes 202 `{ job }`; `sdk.entityRecords.clear()` has zero callers, so nothing migrates (house rule: no compat aliases).
5. **Double toast** — `info` on enqueue, `success`/`error` on the SSE terminal event (user, 2026-08-31).

## Scope

### In scope
1. JobType `entity_record_clear`: metadata/result schemas, `JobTypeMap`, `JOB_TYPE_SCHEMAS`, `JOB_LOCK_KEYS` (`packages/core`).
2. Processor `entity-record-clear.processor.ts` + registration (`apps/api`).
3. Repoint the DELETE route to enqueue (guards unchanged) (`apps/api`).
4. `GET /api/connector-entities/:id/running-jobs` + `JobLockService.findRunningForConnectorEntity` (`apps/api`).
5. Contracts: enqueue response + entity running-jobs response (`packages/core`).
6. Web: SDK updates, `queryKeys.connectorEntities.runningJobs`, `ClearEntityRecordsDialog`, EntityDetail wiring (action, disable/tooltip, lock alert, SSE, toasts, invalidation).

### Out of scope
Filtered deletion · undo/restore UI · `portalai` CLI command (PRD waiver) · changing the instance-delete cascade · progress percent granularity inside the processor (0→100 is acceptable for v1) · retiring the ALB idle-timeout debt.

## Surface

### JobType + schemas — `packages/core/src/models/job.model.ts`

`JobTypeEnum` (`:39`) gains `"entity_record_clear"`. New schemas beside `RevalidationMetadataSchema` (`:66`):

```ts
/**
 * entity_record_clear (#453) — soft-deletes every record of one connector
 * entity plus its er__<id> wide-table mirror.
 * LOCKS: `connectorInstanceId` (via JOB_LOCK_KEYS) — a running clear must
 * exclude syncs/imports/other clears across the whole instance.
 */
export const EntityRecordClearMetadataSchema = z.object({
  connectorEntityId: z.string(),
  connectorInstanceId: z.string(),
  organizationId: z.string(),
});
export type EntityRecordClearMetadata = z.infer<typeof EntityRecordClearMetadataSchema>;

export const EntityRecordClearResultSchema = z.object({
  deleted: z.number().int().nonnegative(),
});
export type EntityRecordClearResult = z.infer<typeof EntityRecordClearResultSchema>;
```

- `JobTypeMap` (`:546`) gains the pair; `JOB_TYPE_SCHEMAS` (`:584`) gains the entry (exhaustive map — omitting it is a compile error).
- `JOB_LOCK_KEYS` (`:652`) gains `entity_record_clear: { connectorInstanceId: "connectorInstanceId" }` — identical to `connector_sync`; `jobTypesLocking("connectorInstanceId")` then includes it, so `findRunningForConnectorInstance` and `assertConnectorInstanceUnlocked` see running clears with **no further change**.

### Processor — `apps/api/src/queues/processors/entity-record-clear.processor.ts` (new)

```ts
export const entityRecordClearProcessor: TypedJobProcessor<"entity_record_clear"> =
  async (bullJob) => { /* metadata: EntityRecordClearMetadata */ };
```

Body = the transaction currently inline in the route (`entity-record.router.ts:1471-1490`), verbatim semantics: `entityRecords.softDeleteByConnectorEntityId(connectorEntityId, userId, tx)` → count; if `count > 0`, `wideTable.markDeletedByConnectorEntity(connectorEntityId, tx)`; return `{ deleted: count }`. `userId` = the job row's `createdBy` (passed via metadata is unnecessary — the worker exposes the row; use `bullJob.data` + the jobs repo read the worker already does, or simplest: add `userId` to the metadata schema — **decided: metadata carries `userId: z.string()`** so the processor stays a pure function of `bullJob.data`). Header comment records Key decision 3 (no advisory lock: idempotent full-delete, no watermark reap). Register in `apps/api/src/queues/processors/index.ts:20`.

### Route repoint — `apps/api/src/routes/entity-record.router.ts:1453`

`entityRecordRouter.delete("/")` keeps its three guards in order (`resolveEntityOrThrow` → `assertWriteCapability` → `assertConnectorInstanceUnlocked` → `RevalidationService.assertNoActiveJob`), then replaces the inline transaction with:

```ts
const job = await JobsService.create(userId, {
  organizationId,
  type: "entity_record_clear",
  metadata: { connectorEntityId, connectorInstanceId: entity.connectorInstanceId, organizationId, userId },
});
return HttpService.success(res, { job }, 202);
```

— the exact shape of the revalidation enqueue in the same file (`:1035-1049`). Duplicate-clear idempotency needs no service: the first clear's job row locks the instance, so a second DELETE hits the 409 guard. `@openapi` block: 200→**202** with `$ref` to the enqueued-response component (register in `swagger.config.ts`); 409 (`ENTITY_LOCKED_BY_JOB` / `REVALIDATION_ACTIVE`) and 422 documented.

### Entity running-jobs — route + lock service

**`JobLockService.findRunningForConnectorEntity`** (new, `apps/api/src/services/job-lock.service.ts`, beside `findRunningForConnectorInstance:60`):

```ts
static async findRunningForConnectorEntity(
  connectorEntityId: string,
  connectorInstanceId: string,
  organizationId: string
): Promise<RunningJobSummary[]>
```

Union of the two existing queries — `jobs.findRunningForConnectorInstance(connectorInstanceId, orgId)` + `jobs.findRunningByTargetEntityIds([connectorEntityId], orgId)` (`jobs.repository.ts:169`) — mapped through `toSummary`, deduped by job id. Exactly the set `assertConnectorEntityUnlocked` (`:137`) would reject, which is the parity Decision 2 (discovery) demands.

**`GET /api/connector-entities/:id/running-jobs`** (`apps/api/src/routes/connector-entity.router.ts`, new) — mirrors `connector-instance.router.ts:531` verbatim: resolve entity, 404 on missing/foreign-org, respond `{ runningJobs }` via the new finder. `@openapi` block referencing the same running-jobs component the instance route uses.

### Contracts — `packages/core/src/contracts/`

- ~~A new `EntityRecordClearEnqueuedResponseSchema`~~ **Corrected in slice 2:** `JobCreateResponsePayloadSchema` (`job.contract.ts:43`, `{ job: JobSchema }`) already exists and is the enqueued shape every job route returns — the clear reuses it; no contract change lands. `EntityRecordDeleteResponsePayloadSchema` (`:174`, `{ deleted }`) **stays** — the single-record delete route still returns it; the clear stops using it.
- `connector-entity.contract.ts`: `ConnectorEntityRunningJobsResponseSchema` — same shape as `ConnectorInstanceRunningJobsResponseSchema` (`connector-instance.contract.ts:208`), reusing its `RunningJobSummary` schema import rather than redefining it.

### Web SDK + keys

- `apps/web/src/api/entity-records.api.ts:63-67` — `clear()` return type becomes `EntityRecordClearEnqueuedResponsePayload` (url/method unchanged).
- `apps/web/src/api/connector-entities.api.ts` — add `runningJobs(id, options?)` `useAuthQuery` mirroring `connector-instances.api.ts:134`.
- `apps/web/src/api/keys.ts` — add `connectorEntities.runningJobs: (id) => [...]` beside the instance variant (`:64`).

### `ClearEntityRecordsDialog` — `apps/web/src/components/ClearEntityRecordsDialog.component.tsx` (new)

Pure UI component per the Component File Policy (no container needed — the view wires it). Props:

```ts
interface ClearEntityRecordsDialogUIProps {
  open: boolean;
  entityLabel: string;
  recordCount: number;          // impact line: "This will delete N records."
  isPending: boolean;
  serverError: ServerError | null;
  onConfirm: () => void;
  onClose: () => void;
}
```

Behavior contract (Form & Dialog Pattern, full checklist): `Modal` with `slotProps.paper.component="form"` + `onSubmit`; `useDialogAutoFocus(open)` on the confirmation field; typed confirmation = the exact `entityLabel`, validated via `validateWithSchema` with `ClearEntityRecordsConfirmSchema = z.object({ confirmation: z.literal(entityLabel) })` built per-render (`z.literal` carries the expected value into the error message); errors shown only after blur/submit; `focusFirstInvalidField()` on invalid submit; submit disabled while `isPending`; action buttons `type="button"`; `<FormAlert serverError={serverError} />` (renders `ENTITY_LOCKED_BY_JOB`, `REVALIDATION_ACTIVE`, and `CONNECTOR_INSTANCE_WRITE_DISABLED` equally — codes are display data); reset confirmation state on reopen (adjust-state-during-render à la `DeleteOrganizationDialog.component.tsx:36-43`).

### EntityDetail wiring — `apps/web/src/views/EntityDetail.view.tsx`

- **Query:** `sdk.connectorEntities.runningJobs(entityId)` in the container; `isLocked = runningJobs.length > 0`, `lockedReason` from `running-job-label.util.ts` (the `ConnectorInstance.view.tsx:226-229` precedent).
- **SSE:** per running job, subscribe to `/api/sse/jobs/:id/events`; on terminal: invalidate `connectorEntities.runningJobs(entityId)`, `entityRecords.root`, `connectorEntities.root`; if the terminal job is an `entity_record_clear` raise `toast.success("Deleted N records from <label>")` from `result.deleted`, or `toast.error(job.error)` on failure (`ConnectorInstance.view.tsx:141-215` pattern).
- **Action:** `secondaryActions` gains `Delete records…` next to the existing entity Delete (`:283-293`), `disabled: isLocked || !isWriteEnabled`, wrapped in `<Tooltip>` naming the running job or "Writes are disabled for this connector".
- **Alert:** render `ConnectorInstanceLockAlert` (existing pure UI, takes `runningJobs`) above the Records section while `isLocked`.
- **On confirm:** `clearMutate()` → on 202: close dialog, `toast.info("Clearing N records…")`, invalidate `connectorEntities.runningJobs(entityId)` (the lock alert appears immediately). Server error: dialog stays open, `FormAlert` renders `toServerError(mutation.error)`.

## Migration / Seed

**One migration, no seed** — `jobs.type` is a Postgres enum (`jobTypeEnum`, `apps/api/src/db/schema/jobs.table.ts:21`), so the new type needs `ALTER TYPE "job_type" ADD VALUE 'entity_record_clear'` (`drizzle/0088_add-entity-record-clear-job-type.sql`, generated via `npm run db:generate -- --name add-entity-record-clear-job-type`). No table, column, or seed changes. *(Corrected during slice 1 — the draft spec wrongly said "no migration"; the dual-schema type-check caught it.)*

## TDD test plan

Run via npm scripts per package: `cd packages/core && npm run test:unit`; `cd apps/api && npm run test:unit && npm run test:integration`; `cd apps/web && npm run test:unit`.

### Layer 1 — core (`packages/core/src/__tests__/models/job.model.test.ts`, extend)
1. `EntityRecordClearMetadataSchema` parses a full metadata object; rejects a missing `connectorInstanceId`.
2. `EntityRecordClearResultSchema` rejects a negative `deleted`.
3. `JOB_TYPE_SCHEMAS.entity_record_clear` resolves both schemas (registry completeness).
4. `jobTypesLocking("connectorInstanceId")` includes `entity_record_clear` — the lock-key contract Decision 2 rests on.

### Layer 2 — processor unit (`apps/api/src/__tests__/queues/processors/entity-record-clear.processor.test.ts`, new — ESM-mock shape of `revalidation.processor.test.ts`, **including the `entity-record-count.cache` mock, #377**)
5. Soft-deletes records then marks the wide table, both inside one `DbService.transaction`.
6. Returns `{ deleted: N }` from the repo count.
7. `deleted: 0` → wide-table mark **not** called (mirrors the route's short-circuit).
8. Repo throw propagates (BullMQ owns retries) — no swallowed error.

### Layer 3 — api integration (`apps/api/src/__tests__/__integration__/routes/entity-record.router.integration.test.ts` extend + `.../connector-entity.router.integration.test.ts` extend)
9. `DELETE …/records` → 202, `{ job }` payload, job row `pending` with the full metadata.
10. With a non-terminal `connector_sync` job on the instance → 409 `ENTITY_LOCKED_BY_JOB`, no job created.
11. With a non-terminal `entity_record_clear` job on the instance → second DELETE 409s (self-locking) **and** the sync-enqueue route 409s (resync exclusion — Key decision 2).
12. `write: false` instance → 422 `CONNECTOR_INSTANCE_WRITE_DISABLED`, no job created.
13. Processor end-to-end against seeded rows: both tables tombstoned (`deleted IS NULL` counts = 0), entity/instance/field-mapping rows untouched, result `{ deleted: N }`.
14. Second processor run → `{ deleted: 0 }` (idempotent).
15. `GET /api/connector-entities/:id/running-jobs` → instance-locking jobs **and** entity-targeted (`bulk_transform`) jobs, deduped; empty array when idle.
16. Same route → 404 for a foreign-org entity.

### Layer 4 — web (`apps/web/src/__tests__/ClearEntityRecordsDialog.test.tsx` new; `EntityDetail` wiring cases in the view's existing test file)
17–27. The full Dialog & Form Test Checklist (renders when open / not when closed; confirm on submit; Enter submits; Cancel calls `onClose`; pending state; `FormAlert` with/without error; validation errors on invalid submit; `aria-invalid`; `required`) plus: submit blocked until the typed label matches exactly.
28. Action disabled with tooltip when `runningJobs` is non-empty; enabled when empty and writable.
29. Action disabled when `isWriteEnabled` is false.
30. Successful 202 closes the dialog, raises `toast.info`, invalidates `connectorEntities.runningJobs` (spy on `invalidateQueries` via the test-utils `queryClient`).
31. Server error keeps the dialog open with `FormAlert` rendered.

**Totals ≈ 31 cases** (4 core, 4 processor unit, 8 api integration, ~15 web).

## Acceptance criteria

- [ ] From the entity view, a user can clear all records without deleting the instance, entity, or field mappings; both `entity_records` and `er__<id>` read 0 live rows afterward, all parents `deleted IS NULL`.
- [ ] The DELETE route returns 202 `{ job }`; the job row records who/when/`{ deleted }` (durable audit of the destructive act).
- [ ] While the clear runs, the instance is locked: resync, second clear, and every other instance-locked mutation 409 with `ENTITY_LOCKED_BY_JOB`; the entity view's action is already disabled with a tooltip naming the job, and the lock alert shows inline.
- [ ] Typed confirmation gates the destructive act; cancel or mismatch performs no write; server errors keep the dialog open in `FormAlert`.
- [ ] Enqueue raises `toast.info`; the SSE terminal event raises `toast.success` with the deleted count (or `toast.error`) and refreshes the record count without a manual reload.
- [ ] A 1.5M-row clear neither times out an HTTP request nor OOMs the 512 MB task (work is off-request; ids never leave Postgres, #451).
- [ ] `npm run lint`, `type-check`, and both test suites green; every new/changed route carries a correct `@openapi` block.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Response-shape cut breaks an unseen caller of `clear()` | Verified zero callers (issue, 2026-08-24; re-grep in slice 1); the SDK type change makes any future misuse a compile error. |
| A running clear blocks unrelated sibling-entity work | Deliberate (Key decision 2, user-confirmed): resync safety outweighs sibling convenience; the lock releases on the terminal status. |
| Worker dies mid-clear | #441/#464 machinery: `pending` on retry budget, `lost_executions` on stall; the clear is idempotent so a re-run converges (test 14). |
| Jobs queue (concurrency 2) occupied by a long clear | Same budget a sync already spends; the clear is one join-delete transaction, measured 66s@400K. |
| Two toasts read as noise | User-confirmed choice; dedupe rule in the toast provider drops exact repeats. |
| Missed `JOB_TYPE_SCHEMAS`/`JobTypeMap` registration | Exhaustive mapped types — omission is a compile error. |

**Rollback:** `git revert` — no migration, no seed, no env change. In-flight clear jobs at rollback time fail on the unknown type; acceptable (no production data yet, and the route stops minting them).

## Files touched

**`packages/core`** — edit: `models/job.model.ts` (enum, schemas, map, registry, lock keys), `contracts/entity-record.contract.ts`, `contracts/connector-entity.contract.ts`, `contracts/index.ts`; tests: `__tests__/models/job.model.test.ts`.

**`apps/api`** — new: `queues/processors/entity-record-clear.processor.ts` + its unit test; edit: `queues/processors/index.ts`, `routes/entity-record.router.ts` (route body + `@openapi`), `routes/connector-entity.router.ts` (running-jobs route), `services/job-lock.service.ts` (`findRunningForConnectorEntity`), `config/swagger.config.ts` (component registration); integration tests extended per Layer 3.

**`apps/web`** — new: `components/ClearEntityRecordsDialog.component.tsx` + test; edit: `api/entity-records.api.ts`, `api/connector-entities.api.ts`, `api/keys.ts`, `views/EntityDetail.view.tsx` (+ its test file).

No new dependency, env var, migration, or infra change.

## Next step

`docs/DELETE_RECORDS_ACTION.plan.md` — likely four TDD slices, each a green commit on this branch: (1) core JobType + lock key + processor + registration (Layers 1–2); (2) route repoint + integration coverage (Layer 3, tests 9–14); (3) entity running-jobs endpoint + lock-service finder + SDK/keys (tests 15–16); (4) dialog + EntityDetail wiring + toasts (Layer 4). `/smoke` then refreshes the manual checklist from this spec's acceptance criteria.
