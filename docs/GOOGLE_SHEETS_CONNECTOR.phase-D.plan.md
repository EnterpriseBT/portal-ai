# Google Sheets Connector — Phase D Implementation Plan

Companion to `GOOGLE_SHEETS_CONNECTOR.discovery.md` and `.phase-{A,B,C}.plan.md`. Phase D scope:

> **Phase D** — Manual sync. Adds the disappeared-records reconciliation, the identity-strategy guard in `gsheets.adapter.syncEntity`, and the "Sync now" UI affordance. `lastSyncAt` updates; counts include `created/updated/unchanged/deleted`.

Concretely: re-pull the spreadsheet on demand, replay the persisted `LayoutPlan` against the new bytes, upsert + reconcile `entity_records` so the user can see "X added, Y updated, Z removed" since the last sync. **Manual only** — no scheduled cadence in v1, per the discovery's manual-replay decision.

## What already exists (do not rebuild)

- **`entity_records` schema** — `synced_at: bigint NOT NULL` + the index `entity_records_entity_synced_at_idx (connector_entity_id, synced_at)` were added back in the original schema and are exactly what the watermark approach needs.
- **`upsertManyBySourceId` repository method** — already writes `synced_at = data.syncedAt` on every upserted row. Phase D's sync just needs to set the right watermark when calling it.
- **`@portalai/spreadsheet-parsing` `replay()`** — pure function from `LayoutPlan` + `Workbook` → `ExtractedRecord[]`. The file-upload commit pipeline already uses it (`LayoutPlanCommitService`). Sync uses the same primitive.
- **`connector_instance_layout_plans`** — the persisted plan lives here. `repository.connectorInstanceLayoutPlans.findByInstanceId` exists.
- **`GoogleSheetsConnectorService.selectSheet`** (Phase B) — fetches `spreadsheets.get?includeGridData=true`, maps to `WorkbookData`, caches it. Sync's per-run fetch is a peer of this method.
- **`GoogleAccessTokenCacheService.getOrRefresh`** (Phase B) — refresh-token → access-token with single-flight + Redis cache. Sync uses this unchanged.
- **`googleSheetsAdapter`** (Phase A stub) — `toPublicAccountInfo` is implemented; `syncEntity` / `queryRows` / discoverers throw `not-implemented`. Phase D fleshes out a new `syncInstance` method (or implements `syncEntity` properly — see Slice 4).
- **`SyncService.syncEntity(connectorEntityId, userId)`** + the `POST /api/connector-entities/:id/sync` route — work for the existing per-entity sync path. Phase D adds a peer per-instance route since Google Sheets workbooks fan out to multiple entities and we want one fetch per sync.
- **`GoogleSheetsReviewStep` rowPosition banner** (Phase C) — already informs the user at commit time when their plan won't be re-syncable. Phase D adds the *server-side* guard that refuses sync for the same plans, and a frontend disabled-state on the "Sync now" button.

## What's net-new for Phase D

| Piece | File | Purpose |
|---|---|---|
| `entityRecords.softDeleteBeforeWatermark` | `db/repositories/entity-records.repository.ts` (extend) | Single indexed `UPDATE … WHERE synced_at < $watermark`. The watermark reaper. |
| `assertSyncEligibleIdentity(plan)` helper | `apps/api/src/services/sync-eligibility.util.ts` (new) | Pure function. Returns `{ ok }` or `{ ok: false, ineligibleRegions }`. Used by sync route + frontend "Sync now" disable check. |
| `googleSheetsAdapter.syncInstance` | `adapters/google-sheets/google-sheets.adapter.ts` (extend) | The full per-instance sync — fetch + map + replay + watermark upsert + reconcile. Returns `{ recordCounts }`. |
| `SyncService.syncInstance / enqueueSync / assertNoActiveSyncJob` | `services/sync.service.ts` (extend) | Per-instance dispatch + BullMQ enqueue + single-flight guard. |
| `gsheets_sync` job type + processor | `JobTypeEnum`, `JobTypeMap` (core), `queues/processors/gsheets-sync.processor.ts` (new), `queues/processors/index.ts` (extend) | Mirrors `revalidation` — typed metadata + result, declarative registration, reports progress via `bullJob.updateProgress`. |
| `POST /api/connector-instances/:id/sync` route | `routes/connector-instance.router.ts` (extend) | Authenticated, ownership-checked, eligibility + single-flight pre-flight. Returns `{ jobId }` (202). The processor does the actual work. |
| `sdk.connectorInstances.sync(id)` | `apps/web/src/api/connector-instances.api.ts` (extend) | `useAuthMutation` for the new route. Returns `{ jobId }`. |
| `connectorInstance.syncEligible` field | `redactInstance` serializer + contract | Boolean derived from the persisted plan's identity strategies. UI uses it for the disabled-button affordance. `lastSyncAt` is already on the column. |
| "Sync now" button with SSE-driven progress | Connector instance detail view | Mirrors the existing revalidation-button pattern: enqueue, subscribe to job events via `sdk.sse.*`, render progress, toast on completion. |
| New API codes | `constants/api-codes.constants.ts` | `LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY`, `SYNC_ALREADY_RUNNING`. |

## TDD discipline

Same as Phases A-C — red → green → refactor, run via `npm run test:unit` / `npm run test:integration` from `apps/api/` (per `feedback_use_npm_test_scripts`). Keep the per-slice test scope tight; the watermark behavior in particular wants table-level integration tests to verify the actual SQL semantics, not unit tests against a mocked repository.

---

## Slice 1 — `entityRecords.softDeleteBeforeWatermark`

### Goal

The watermark reaper. Soft-deletes every `entity_records` row whose `synced_at` is older than the supplied watermark for a given `connectorEntityId`. The single load-bearing primitive of the disappeared-records reconciliation.

### Red

Extend `apps/api/src/__tests__/__integration__/db/repositories/entity-records.repository.integration.test.ts` (or create if absent) with a focused `softDeleteBeforeWatermark` describe block:

1. **Reaps disappeared rows** — seed 4 rows with `synced_at: 100`. Issue `softDeleteBeforeWatermark(entityId, watermark = 200, deletedBy = "u1")`. All 4 rows now have `deleted IS NOT NULL` and `deleted_by = "u1"`.
2. **Spares fresh rows** — seed 2 rows with `synced_at: 100` and 2 with `synced_at: 250`. Watermark 200 reaps only the 100s; the 250s stay live.
3. **Boundary at exactly the watermark** — `synced_at: 200` with watermark 200 should **not** be reaped (`<` not `<=`). The watermark is "rows touched at or after this run start are safe."
4. **Only the supplied entity** — seed rows on entity A and entity B with the same `synced_at`. Reaping entity A's old rows must not touch entity B's rows.
5. **Idempotent on re-run** — running the same call twice doesn't re-soft-delete already-deleted rows or change their `deleted` timestamp / `deleted_by`. (The query's `WHERE deleted IS NULL` clause covers this.)
6. **Returns the affected rowcount** — for the sync result UI's "X removed" counter.

### Green

Add to `EntityRecordsRepository`:

```ts
async softDeleteBeforeWatermark(
  connectorEntityId: string,
  watermarkMs: number,
  deletedBy: string,
  client: DbClient = db
): Promise<number> {
  const now = Date.now();
  const result = await (client as typeof db)
    .update(this.table)
    .set({ deleted: now, deletedBy } as any)
    .where(
      and(
        eq(entityRecords.connectorEntityId, connectorEntityId),
        lt(entityRecords.syncedAt, watermarkMs),
        this.notDeleted()
      )
    )
    .returning();
  return result.length;
}
```

The existing `entity_records_entity_synced_at_idx (connector_entity_id, synced_at)` index supports this query — confirm via `EXPLAIN` in a manual check that the `Index Scan` is used and not a sequential scan.

### Refactor

The `(connectorEntityId, watermarkMs, deletedBy)` triple shows up in the sync flow's per-entity loop too. If the loop ends up duplicating these args across upsert + reap calls, factor out a per-entity helper. Don't pre-extract.

---

## Slice 2 — `assertSyncEligibleIdentity` shared helper

### Goal

A pure function over a `LayoutPlan` that returns whether the plan is sync-eligible (no region uses `rowPosition` identity). Both the server-side guard and the frontend "Sync now" disable check use it.

### Red

New file `apps/api/src/__tests__/services/sync-eligibility.util.test.ts`:

1. Empty plan (`regions: []`) → `{ ok: true }`. Edge case but plausible.
2. All-`column`-identity plan → `{ ok: true }`.
3. All-`composite`-identity plan → `{ ok: true }`.
4. One region with `rowPosition` identity → `{ ok: false, ineligibleRegionIds: [r2] }`.
5. Mixed (one `column`, one `rowPosition`) → `{ ok: false, ineligibleRegionIds: [r2] }`.
6. Multiple `rowPosition` regions → all listed in `ineligibleRegionIds`.
7. Strategy `kind` field tested by string equality (`region.identityStrategy.kind === "rowPosition"`), case-sensitive.

### Green

New file `apps/api/src/services/sync-eligibility.util.ts`:

```ts
export interface SyncEligibility {
  ok: boolean;
  ineligibleRegionIds: string[];
}
export function assertSyncEligibleIdentity(plan: LayoutPlan): SyncEligibility {
  const bad = plan.regions
    .filter((r) => r.identityStrategy?.kind === "rowPosition")
    .map((r) => r.id);
  return bad.length === 0
    ? { ok: true, ineligibleRegionIds: [] }
    : { ok: false, ineligibleRegionIds: bad };
}
```

### Refactor

The frontend wants the same logic — it could either:

- **Reimplement** in the connector instance detail view (3 lines). Risk: drift if the rule changes.
- **Surface as a derived field** on the connector instance API response. Cleaner; one source of truth.

Decision: **derived field** (Slice 5 surfaces it). The pure helper lives in the API; the API computes the boolean once per request and ships it on the wire.

---

## Slice 3 — Range-scoped re-fetch (or full-grid for v1)

### Goal

Re-fetch the workbook from Google for an existing pending/active connector instance. The discovery doc proposes range-scoped reads (`spreadsheets.values.batchGet` per persisted region) for large-sheet efficiency, but the existing `selectSheet` already uses the full-grid `spreadsheets.get?includeGridData=true`. v1 reuses the same path for sync; the range-scoped optimization is a follow-up when measured cost makes it worth doing.

### Red

Extend `apps/api/src/__tests__/services/google-sheets-connector.service.test.ts` (the existing service test):

1. **`fetchWorkbookForSync` exists and reads the cached `instance.config.spreadsheetId`**. Mock `fetch` to return a stub `spreadsheets.get` body. Returns the mapped `WorkbookData`.
2. **Refreshes the access token via `GoogleAccessTokenCacheService`** — the same path `selectSheet` uses.
3. **Throws `GoogleAuthError("fetchSheet_failed")` on Sheets 4xx** — same surface as `selectSheet`.
4. **Updates `lastSyncAt` is NOT done here** — the adapter's `syncInstance` owns that update so the timestamp covers the whole sync, not just the fetch.

### Green

Add `GoogleSheetsConnectorService.fetchWorkbookForSync(connectorInstanceId, organizationId)` that mirrors the inner half of `selectSheet` (the part after the access token, up to the workbook map). It does **not** write to the workbook cache — the cache is for the interactive editor session only; sync is a one-shot read that doesn't need to persist.

### Refactor

`selectSheet` and `fetchWorkbookForSync` will share ~30 lines of fetch + map logic. Extract a private `fetchWorkbookFromSpreadsheetId(accessToken, spreadsheetId)` helper. **Don't share the cache write** — the two callers' caching policies are different.

---

## Slice 4 — `googleSheetsAdapter.syncInstance` (the meat)

### Goal

The full per-instance sync: load plan → guard identity → fetch workbook → replay → per-entity upsert+reap → update `lastSyncAt`. Returns a `SyncResult`-shaped tally.

### Red

New file `apps/api/src/__tests__/__integration__/services/google-sheets-sync.integration.test.ts`. These are full integration tests — the watermark behavior demands real SQL.

1. **Initial sync after Phase C commit** — seed an instance + plan + records (created via the commit pipeline). Re-run sync against the same workbook (mocked Google response). Returns `{ created: 0, updated: 0, unchanged: N, deleted: 0 }`. No DB changes.
2. **Sync detects added rows** — the second mock response has 1 extra row. Returns `{ created: 1, updated: 0, unchanged: N, deleted: 0 }`. The new row is in `entity_records`.
3. **Sync detects updated rows** — second mock changes one cell value in an existing row. Returns `{ created: 0, updated: 1, unchanged: N-1, deleted: 0 }`. The row's `data` reflects the new value.
4. **Sync detects deleted rows (watermark reap)** — second mock omits one row. Returns `{ created: 0, updated: 0, unchanged: N-1, deleted: 1 }`. The omitted row is soft-deleted (`deleted IS NOT NULL`).
5. **Sync refuses on rowPosition identity** — seed an instance whose plan has a `rowPosition` region. Sync throws `ApiError(409, LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY)`. Records untouched. `lastSyncAt` not updated.
6. **Concurrent rows on different entities** — two entities under one instance, both stale. Sync reaps each entity's stale rows independently using its own watermark. Watermark is `runStartedAt` captured ONCE at sync entry, shared across all entities.
7. **Refresh-failed propagates** — mock `getOrRefresh` to throw `GoogleAuthError("refresh_failed")`. Sync throws `ApiError(502, GOOGLE_OAUTH_REFRESH_FAILED)`. Instance status was already flipped to `error` by the cache service (Phase B Slice 3); sync just propagates.
8. **`lastSyncAt` updates on success** — read the instance row before/after; `lastSyncAt` advances to ≥ `runStartedAt`.
9. **`lastErrorMessage` cleared on success** — if a previous sync failed and stored an error message, a successful sync clears it.

### Green

```ts
async syncInstance(
  instance: ConnectorInstance,
  userId: string
): Promise<SyncResult> {
  const runStartedAt = Date.now();

  // 1. Load plan + run guard.
  const planRow = await DbService.repository.connectorInstanceLayoutPlans
    .findCurrentByInstanceId(instance.id);
  if (!planRow) throw new ApiError(404, ApiCode.LAYOUT_PLAN_NOT_FOUND, ...);
  const eligibility = assertSyncEligibleIdentity(planRow.plan);
  if (!eligibility.ok) {
    throw new ApiError(
      409,
      ApiCode.LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY,
      `Plan has ${eligibility.ineligibleRegionIds.length} region(s) using row-position identity; not eligible for sync`
    );
  }

  // 2. Fetch workbook.
  const workbook = await GoogleSheetsConnectorService.fetchWorkbookForSync(
    instance.id,
    instance.organizationId
  );

  // 3. Replay per region (per existing commit pipeline shape).
  const records = replay({ workbook, plan: planRow.plan, deps: ... });

  // 4. Per connectorEntity: upsert with synced_at = runStartedAt, then reap.
  const tally = { created: 0, updated: 0, unchanged: 0, deleted: 0 };
  const entities = await DbService.repository.connectorEntities
    .findByConnectorInstanceId(instance.id);
  for (const entity of entities) {
    const entityRecords = records.filter((r) => r.connectorEntityId === entity.id);
    const writeResult = await writeEntityRecords({
      ...entityRecords,
      syncedAt: runStartedAt,
      userId,
    });
    tally.created += writeResult.created;
    tally.updated += writeResult.updated;
    tally.unchanged += writeResult.unchanged;
    tally.deleted += await DbService.repository.entityRecords
      .softDeleteBeforeWatermark(entity.id, runStartedAt, userId);
  }

  // 5. Update lastSyncAt + clear lastErrorMessage.
  await DbService.repository.connectorInstances.update(instance.id, {
    lastSyncAt: Date.now(),
    lastErrorMessage: null,
    updatedBy: userId,
  });

  return tally;
}
```

The `writeEntityRecords` helper is essentially what `LayoutPlanCommitService.writeRecords` already does. Phase D either:

- **Imports** `writeRecords` from the commit service (exposing it as a static), OR
- **Lifts** the shared bits into a new `apps/api/src/services/record-write.util.ts` that both commit and sync consume.

Refactor decision: lift, since the sync caller wants a slightly different syncedAt source (the `runStartedAt` watermark, not `Date.now()` per-record). The lifted helper takes `syncedAt` as a parameter; commit passes `Date.now()`, sync passes the watermark.

### Refactor

After the lift, `LayoutPlanCommitService.writeRecords` becomes a thin wrapper that calls the shared util with `syncedAt: Date.now()`. The shared util's tests cover both code paths.

---

## Slice 5 — `gsheets_sync` job type + processor + route + serializer surface

### Goal

Sync runs **as a typed BullMQ job**, not inline. Mirrors the existing `revalidation` job pattern so the frontend gets progress events through SSE for free, the route is a fast-return enqueue (no HTTP timeout for large sheets), and the workflow is consistent across long-running operations.

### Red

- New file `apps/api/src/__tests__/__integration__/queues/gsheets-sync.processor.integration.test.ts`:
  1. **End-to-end happy path** — enqueue a job for a google-sheets instance with mocked Google response, await completion, verify the job row in postgres has `status="completed"` and `result` matches `{ recordCounts: { created, updated, unchanged, deleted } }`.
  2. **Progress events fire** — assert `bullJob.updateProgress` is called at meaningful checkpoints (workbook fetched, replay done, per-entity reconciled).
  3. **Eligibility refusal** — job for a `rowPosition`-identity plan ends `status="failed"` with the stored error message naming `LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY`. No records touched.
  4. **Refresh-failure surfaces as job failure** — refresh-token revoked → job ends `failed` with the GoogleAuthError message; instance status is already `error` (set by the cache service).

- Extend `apps/api/src/__tests__/__integration__/routes/connector-instance.router.integration.test.ts`:
  5. **`POST /api/connector-instances/:id/sync` returns `{ jobId }`** — fast-return, no waiting on the sync. Verifies a `jobs` row was created with `type="gsheets_sync"`, `status="pending"`, `metadata.connectorInstanceId` matches.
  6. **404 / 403** — same envelope as the rest of `connector-instances`.
  7. **400 `LAYOUT_PLAN_NOT_FOUND`** — when the instance has no committed plan (sync called before the workflow committed). The processor doesn't need to be reached for this — the route validates pre-enqueue.
  8. **`syncEligible` field on the redacted instance shape** — `GET /api/connector-instances/:id` includes `syncEligible: true` for a normal plan; `false` for `rowPosition`. `false` for instances with no plan. `undefined` for sandbox/file-upload (those don't sync).
  9. **Single-flight check** — calling `POST /:id/sync` while a job is `pending` or `active` for that instance returns `409 SYNC_ALREADY_RUNNING` with the in-flight `jobId`. Reuse `RevalidationService.assertNoActiveJob` shape — there's already a precedent.

### Green

**1. Add the job type.**

`packages/core/src/models/job.model.ts`:

```ts
export const JobTypeEnum = z.enum(["system_check", "revalidation", "gsheets_sync"]);

export const GsheetsSyncMetadataSchema = z.object({
  connectorInstanceId: z.string().min(1),
});
export type GsheetsSyncMetadata = z.infer<typeof GsheetsSyncMetadataSchema>;

export const GsheetsSyncResultSchema = z.object({
  recordCounts: z.object({
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative(),
  }),
});
export type GsheetsSyncResult = z.infer<typeof GsheetsSyncResultSchema>;
```

Add `gsheets_sync: { metadata: GsheetsSyncMetadata, result: GsheetsSyncResult }` to `JobTypeMap`.

**2. The processor.**

New file `apps/api/src/queues/processors/gsheets-sync.processor.ts`. Mirrors `revalidation.processor.ts`'s shape — typed handler, `bullJob.updateProgress(...)` at the four checkpoints (load plan / fetch workbook / replay / reap+update), returns `{ recordCounts }`. The actual work delegates to `SyncService.syncInstance` from Slice 4.

Register in `processors/index.ts`:

```ts
export const processors: Record<string, JobProcessor> = {
  system_check: systemCheckProcessor,
  revalidation: revalidationProcessor,
  gsheets_sync: gsheetsSyncProcessor,
};
```

**3. The route.**

`POST /api/connector-instances/:id/sync` in `connector-instance.router.ts`:

```ts
async (req, res, next) => {
  const { userId, organizationId } = req.application!.metadata;
  await resolveOwnedInstance(req.params.id, organizationId);

  // Pre-flight: refuse if the plan is sync-ineligible. Surfacing the
  // 409 here (rather than via a failed job) keeps the failure mode
  // out of the SSE event stream for predictable issues — only Google
  // API failures should reach the job's error surface.
  await assertEligibleForSync(req.params.id);

  // Single-flight: same connectorInstanceId can't have two active jobs.
  await SyncService.assertNoActiveSyncJob(req.params.id);

  const job = await SyncService.enqueueSync(req.params.id, userId);
  return HttpService.success(res, { jobId: job.id }, 202);
}
```

`SyncService.enqueueSync(connectorInstanceId, userId)`:

```ts
1. Insert `jobs` row with type="gsheets_sync", status="pending", metadata.
2. Add to BullMQ jobsQueue with the same jobId.
3. Return the row.
```

`SyncService.assertNoActiveSyncJob(connectorInstanceId)` — queries `jobs` for `type="gsheets_sync"`, `status IN ("pending", "active")`, metadata's `connectorInstanceId` match. Throws 409 with the existing job's id.

**4. Serializer surface.**

Extend `redactInstance` (Phase A Slice 9) with the `syncEligible` derived field, computed from `assertSyncEligibleIdentity(plan)` after looking up the current plan row. Add to `PublicAccountInfo` schema or as a peer field.

Add `LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY` and `SYNC_ALREADY_RUNNING` to `ApiCode`.

### Refactor

- The redaction-time plan lookup is cheap for GET-by-id but **n+1 for list endpoints**. Skip on list (`syncEligible: undefined` for list responses; UI's connector list doesn't show the sync button anyway). Batch later if Phase E's connector-list-with-status view appears.
- `SyncService.assertNoActiveSyncJob` mirrors `RevalidationService.assertNoActiveJob`. If a third job-with-single-flight surfaces, lift the pattern into a generic `assertNoActiveJobByMetadata(jobType, metadataMatch)` helper.

---

## Slice 6 — Frontend SDK + "Sync now" + SSE progress

### Goal

A "Sync now" button on the connector instance detail view that:

1. Triggers a sync via the new route (returns `{ jobId }`).
2. Subscribes to the existing SSE channel for that jobId.
3. Renders progress (`bullJob.updateProgress` events show as a determinate progress bar or step indicator).
4. On `completed`, reads the `recordCounts` from the job's result and shows a toast.
5. On `failed`, surfaces the error with a Reconnect CTA placeholder (Phase E).
6. Disabled with tooltip when `!syncEligible`.

### Red

- Extend `apps/web/src/__tests__/api/connector-instances.api.test.ts`:
  1. `sdk.connectorInstances.sync(id)` posts to `/api/connector-instances/{id}/sync` and returns `{ jobId }`.
- New test for the connector instance detail view:
  2. **Renders a "Sync now" button when `syncEligible: true`.** Click triggers the mutation.
  3. **Disabled with tooltip** ("This connector uses positional row IDs and can't be re-synced — re-edit the regions to add an identifier column") when `syncEligible: false`.
  4. **Subscribes to SSE on jobId received** — uses the existing `sdk.sse.subscribeToJob(jobId)` (or whatever its current name is) hook.
  5. **Renders a progress indicator** while the job is `active`. Progress percentages from `event.progress` reflect in the UI.
  6. **Success toast on `completed`** — `Sync complete: 1 added, 2 updated, 5 unchanged, 0 removed`. Reads from the job's stored `result.recordCounts`.
  7. **Failure toast on `failed`** — surfaces `event.errorMessage` with a Reconnect CTA placeholder.
  8. **Single-flight 409 surfaces gracefully** — if a sync is already running, reuse the in-flight jobId from the 409 response and continue subscribing instead of erroring. (UI experience: "Sync already in progress" → live progress.)
  9. **Cleanup on unmount** — closing the detail view mid-sync unsubscribes from SSE so we don't leak EventSource connections.

### Green

- `apps/web/src/api/connector-instances.api.ts` — add `sync: (id) => useAuthMutation<{ jobId }, void>({...})`.
- Detail view (`apps/web/src/views/ConnectorInstance.view.tsx` or wherever the per-instance UI lives) — add the button. State machine driven by SSE events: `idle | starting | active | completed | failed`. Wire to the existing SSE consumer pattern (mirror what `RevalidationButton` or its analog already does for `revalidation` jobs).
- Tooltip text + disabled state from `instance.syncEligible`.

### Refactor

- The "Sync now" + "Reconnect" buttons will share orchestration with `RevalidationButton`. If a third connector-instance action button surfaces by Phase E, lift to a shared `ConnectorJobButton` that takes `{ jobType, label, onResult }`.
- The progress/result UX is currently inline in the detail view. If the connector list view wants to show "syncing…" badges, the SSE subscription pattern needs to become a hook callable from anywhere — defer to Phase E unless the list-status view materializes earlier.

---

## End-to-end verification gate

After Slices 1-6 land, run the full sync flow against real Google APIs:

1. Start fresh — commit a Google Sheets connector instance with a `column` identity (e.g. an `id` column). Note `recordCounts` from commit.
2. **Same-data sync.** Click "Sync now" → SSE shows progress 0 → 100% → toast reads `Sync complete: 0 added, 0 updated, N unchanged, 0 removed`. No DB churn.
3. **Add a row in the spreadsheet.** Click "Sync now" → toast reads `1 added, ...`. New row visible in records list.
4. **Edit a cell.** Click "Sync now" → `0 added, 1 updated, ...`. Updated value visible.
5. **Delete a row.** Click "Sync now" → `0 added, 0 updated, ..., 1 removed`. Row no longer in records list (soft-deleted).
6. **`lastSyncAt` displayed on the instance card.** Updates each time the job completes.
7. **rowPosition guard.** Edit the persisted plan (or commit a new instance whose region uses positional ids) → "Sync now" button is disabled with the tooltip text. Hitting the API directly with curl returns 409 + `LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY`.
8. **Single-flight.** Click "Sync now" twice rapidly. Second click latches onto the in-flight job (UI shows continuous progress); the API returns 409 with the existing jobId on the second POST.
9. **Refresh-token revocation.** Revoke Portal.ai's permission in Google account settings. Click "Sync now" → SSE delivers `failed` event → toast shows the failure → instance status flips to `error`. (Reconnect flow is Phase E.)
10. **Job persistence.** Refresh the browser mid-sync — the "Sync now" UI re-attaches to the in-flight job's SSE stream by querying the connector-instance's active sync (extending the redacted shape with `activeSyncJobId?: string`, or a side-fetch). Progress resumes seamlessly.

If all ten pass, Phase D is done. The connector is production-ready end-to-end except for the reconnect flow (Phase E) and the deferred large-sheet optimizations.

---

## Out of scope for Phase D

- **Scheduled / repeating cadence.** Discovery doc explicitly defers this; only manual-only sync ships in D.
- **Reconnect / `invalid_grant` recovery flow** (Phase E). Sync surfaces the `error` state; the UI for re-authorizing without losing committed records is a separate phase.
- **Range-scoped fetch** (`spreadsheets.values.batchGet` per region). Discovery doc proposes this for large-sheet handling. v1 reuses the full-grid fetch from `selectSheet`; profile actual sync times before adding the optimization.
- **Chunked replay in row-bands.** Same — only matters for very large regions; not a v1 blocker.
- **Sync runs against the cached workbook.** Sync always re-fetches from Google; the `gsheets:wb:{id}` cache is for the interactive editor session, not for sync. A user who clicks "Sync now" expects fresh Google data, not the in-Redis snapshot.
- **Webhooks.** Drive push notifications stay deferred (discovery decision: no webhooks).
- **Commit-as-a-typed-job.** Same architectural fit as sync — both run the same `replay() → per-entity upsert → watermark reap` pipeline, both can be slow on large sheets, both want progress UX, both should reattach across page refresh. The shared `writeRecords` util that Slice 4 extracts is reusable as-is, so promoting commit becomes ~150 LoC in the route + a `commit_records` processor + a frontend SSE handler swap. Deferred to a follow-up phase because: (a) the file-upload commit path is heavily-tested working code, and refactoring its response contract warrants a focused PR with its own test sweep rather than riding alongside Phase D's surface area; (b) typical small-sheet commits work fine inline today, so the async win is for big sheets where measured commit times push past acceptable inline budget. Sync-as-job lands first as the validation; commit follows once we have real data on commit durations.

## Risks specific to Phase D

- **Replay determinism.** The watermark approach relies on `replay()` producing the same `sourceId` for the same row across runs. `column` and `composite` identity strategies do this by definition; `rowPosition` doesn't, which is exactly why the guard refuses it. Verify in Slice 4's tests that re-syncing the same workbook produces zero churn (test 1).
- **Per-entity watermark concurrency.** All entities under one instance share the same `runStartedAt` watermark, so a sync-in-flight that completes after a *second* sync starts won't accidentally reap the second sync's records. Slice 4 test 6 covers the multi-entity case; the multi-sync case is prevented at the route layer — `SyncService.assertNoActiveSyncJob` rejects with 409 + the in-flight jobId, and the UI latches onto the existing job's SSE stream rather than starting a new one (Slice 6 test 8).
- **Replay against a stale plan.** If the user edited the spreadsheet's column structure such that the persisted plan's region bounds no longer match (renamed columns, moved regions), `replay()` may produce zero records or warnings. v1 surfaces this as a successful sync with `0 added, 0 updated, 0 unchanged, all-existing-deleted` (the watermark reaps everything). Pathological but technically correct. Phase E's drift-recovery UX surfaces it: "Last sync removed everything; check the spreadsheet structure."
- **Soft-delete cascade.** `entity_records` is referenced by analytics + entity-group membership. Soft-deleting via the watermark sets `deleted IS NOT NULL`; the existing soft-delete-aware queries skip deleted rows (`WHERE deleted IS NULL`) so analytics naturally exclude them. **Confirm** that no SELECT-from-`entity_records` query forgets to filter on `deleted` — grep for raw SELECTs in Slice 1's refactor pass.
- **`syncEligible` field on the wire.** Adding a derived boolean to the connector-instance read shape breaks the existing contract test if it's strict. Slice 5 also touches the contract; adjust the corresponding contract schema in `@portalai/core/contracts`.
