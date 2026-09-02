# Honest connector-sync progress — Spec

**Issue:** [EnterpriseBT/portal-ai#458](https://github.com/EnterpriseBT/portal-ai/issues/458) · **Discovery:** `docs/CONNECTOR_SYNC_PROGRESS.discovery.md`

Replace the asymptotic page-count curve with a progress contract that distinguishes *known* from *guessed*: adapters report `{ processed, total? }` record counts (or an asserted `{ percent }` for real phase milestones), the transport persists the detail in a new `jobs.progress_detail` jsonb and derives the integer percent only when a total is known, every read surface (SSE snapshot/update, REST job reads, web meters) carries the detail, and an optional per-endpoint `totalCount` pre-flight fetches the denominator where the API can supply one (ArcGIS `returnCountOnly=true`).

## Key decisions (flag for review)

1. **D1 — persist in a dedicated `jobs.progress_detail` jsonb column** (one additive migration), not `metadata` (the lock contract) and not an SSE-only side channel (the bulk pattern's reconnect blind spot).
2. **D2 — one callback, one open shape:** `SyncInstanceOptions.progress` becomes `(update: SyncProgressUpdate) => void`, `{ percent?, processed?, total? }`. Clean cut, no compat overload.
3. **D3 — totals come from per-endpoint config** (`totalCount: { queryParams, responsePath }`), not provider sniffing. The pre-flight is strictly fail-open: any failure → unknown total, never a sync failure.
4. **D4 — display:** fraction primary + determinate bar when a total is known; count + indeterminate bar when not; derived percent is capped at 99 until the adapter's terminal `{ percent: 100 }` (records done ≠ reap/mirror done). Multi-endpoint: cumulative `processed` always; a `total` only when *every* endpoint produced one.
5. **Q1 — `jobs.progress` keeps meaning percent.** With no total it advances only on asserted milestones (0 at start, 100 at completion — the 95 finalize tick is deleted along with the curve); surfaces that have detail prefer it. The worker still normalizes bare-number progress from the other five processors, so nothing else changes behavior.
6. **Q2/Q3/Q5 (deferred):** bulk `batch`-event convergence, ArcGIS inference pre-fill of `totalCount`, and ETA are out of scope; the shapes are additive-open for all three.

## Scope

### In scope

1. `JobProgressDetailSchema` + `JobSchema.progressDetail` (`packages/core/src/models/job.model.ts`); `progressDetail` on `JobSnapshotEventSchema` / `JobUpdateEventSchema` (`packages/core/src/contracts/job.contract.ts`).
2. `jobs.progress_detail` jsonb column + migration; drizzle-zod/type-check ripple.
3. `SyncProgressUpdate` on `adapter.interface.ts`; processor forwards the object; `jobs.worker.ts` accepts number *or* object; `JobEventsService.updateProgress` derives/persists/publishes.
4. REST adapter: curve deleted; per-page (and per-1000-records streaming) cumulative record reporting; `totalCount` pre-flight per endpoint.
5. `totalCount` on `ApiEndpointConfigBaseSchema` + `api_endpoint_configs.total_count` column + router flatten/reconstruct + `ApiEndpointForm` optional fields.
6. Milestone adapters (`google-sheets`, `microsoft-excel`) migrate mechanically to `{ percent: N }`.
7. Web: `useJobStream` carries `progressDetail`; `Progress` (core UI) gains indeterminate support; `ConnectorInstanceSyncFeedback`, `JobDetail.view`, `Job.component` render per D4.

### Out of scope

- Bulk jobs' custom `batch` event migration; ETA; inference pre-fill of `totalCount`; any change to streaming chunking; phase labels beyond the existing copy.

## Surface

### `packages/core/src/models/job.model.ts`

```ts
/** Structured progress persisted per job (#458). `total: null` = genuinely
 *  unknown — surfaces must render a count, never a synthetic percent. */
export const JobProgressDetailSchema = z.object({
  processed: z.number().int().nonnegative(),
  total: z.number().int().positive().nullable(),
});
export type JobProgressDetail = z.infer<typeof JobProgressDetailSchema>;
```

`JobSchema` (currently `job.model.ts:717-734`) gains, after `progress`:

```ts
progressDetail: JobProgressDetailSchema.nullable(),
```

### `packages/core/src/contracts/job.contract.ts`

- `JobSnapshotEventSchema` (`:62-70`) gains `progressDetail: JobProgressDetailSchema.nullable()`.
- `JobUpdateEventSchema` (`:75-82`) gains `progressDetail: JobProgressDetailSchema.nullable().optional()` (custom events built by `publishCustomEvent` omit it).

### `apps/api/src/db/schema/jobs.table.ts`

After `progress` (`:44`):

```ts
progressDetail: jsonb("progress_detail").$type<{ processed: number; total: number | null }>(),
```

Nullable — a job that never reports detail keeps `NULL`. drizzle-zod (`zod.ts`) and `type-checks.ts` assertions for `Job` update automatically via the existing pairs; the new field must appear on both sides or `type-check` fails (dual-schema rule).

### `apps/api/src/adapters/adapter.interface.ts`

Replace `progress?: (percent: number) => void` (`:153`) with:

```ts
/** One progress report. Exactly one of the two modes per call:
 *  - `{ percent }` — a phase milestone the adapter ASSERTS (0 start, 100 done,
 *    or sheets/excel-style fixed milestones). Never a guess.
 *  - `{ processed, total? }` — cumulative records processed across the whole
 *    run; `total` only when a count pre-flight succeeded for EVERY endpoint. */
export interface SyncProgressUpdate {
  percent?: number;
  processed?: number;
  total?: number;
}
// on SyncInstanceOptions:
progress?: (update: SyncProgressUpdate) => void;
```

### `apps/api/src/queues/processors/connector-sync.processor.ts:92-94`

```ts
progress: (update) => {
  void bullJob.updateProgress(update);
},
```

BullMQ accepts `number | object`; connector-sync now always sends the object.

### `apps/api/src/queues/jobs.worker.ts:317-322`

The number-only guard becomes normalization — the other five processors keep passing bare numbers:

```ts
worker.on("progress", async (bullJob, progress) => {
  const update =
    typeof progress === "number"
      ? { percent: progress }
      : (progress as SyncProgressUpdate | null);
  if (!update || (update.percent == null && update.processed == null)) return;
  const JobEventsService = await getJobEventsService();
  await JobEventsService.updateProgress(bullJob.data.jobId, update);
});
```

### `apps/api/src/services/job-events.service.ts` — `updateProgress` (`:214-229`)

New signature `updateProgress(jobId: string, update: SyncProgressUpdate): Promise<void>`:

- **Derive percent:** `update.percent`, else when `update.total` is a positive number: `Math.min(99, Math.round((update.processed / update.total) * 100))` — capped at 99 because records-done precedes reap/mirror; only an asserted `{ percent: 100 }` reads 100. When neither → percent undefined.
- **Detail:** `update.processed != null ? { processed: update.processed, total: update.total ?? null } : undefined`.
- **Persist:** one `jobs.update(...)` setting `updated` always, `progress` only when percent is defined, `progressDetail` only when detail is defined — **with `.returning()`**, so the publish reads the post-update row instead of a possibly-stale in-hand value (the `JobUpdateEvent.progress` field stays required, and a detail-only update must publish the row's current percent, not 0).
- **Publish:** `JobUpdateEvent` as today plus `progressDetail` from the returned row.

`Repository.update` returns the updated row already or the repo gains a returning variant — whichever exists; the contract is *one* round trip, publish-from-row. `publishCustomEvent` (`:192-209`) is unchanged.

### `apps/api/src/routes/job-events.router.ts:76-85`

Snapshot gains `progressDetail: job.progressDetail` (typed via the model — no cast beyond the existing `result` one). `@openapi` component for the snapshot/update event schemas in `swagger.config.ts` updated from the Zod source.

### `apps/api/src/adapters/rest-api/rest-api.adapter.ts`

**Delete** the curve block (`:255-296`'s `slicePct`/`basePct`/`intra` math and the `:255-261` comment), the `progress?.(95)` tick (`:298`), and `syncOneEndpoint`'s `reportPage` parameter (`:353-359`, call sites `:453/:473/:491`).

**`syncInstance` becomes:**

1. `progress?.({ percent: 0 })` at start (`:228`).
2. **Count pre-flight (before the endpoint loop):** for each endpoint whose `config.totalCount` is set, issue one request — same `path`/`method`/`headers`/auth/`bodyTemplate` as the endpoint, with `totalCount.queryParams` merged over the endpoint's `queryParams` (count params win) via the existing `buildUrl` (`:129`) — and read an integer from `totalCount.responsePath` (dotted path, same extraction used for `recordsPath`). Per-endpoint outcome: a nonnegative integer, or unknown. `grandTotal = every endpoint yielded a count ? sum : undefined`. **Fail-open:** any thrown fetch, non-2xx, unparsable or negative value logs a `warn` (`event: "rest-api.sync.count-preflight-failed"`) and yields unknown — never throws, never charges the outcome.
3. Per endpoint, pass `syncOneEndpoint` a reporter `reportProcessed?: (endpointProcessed: number) => void` that emits `progress?.({ processed: processedBase + endpointProcessed, ...(grandTotal !== undefined ? { total: grandTotal } : {}) })`, where `processedBase` accumulates completed endpoints' record counts.
4. `progress?.({ percent: 100 })` after the instance update (`:305`).

**`syncOneEndpoint`:** calls `reportProcessed?.(counts.recordIndex)` where `reportPage` fired today — per paginated page (`:491`), and in the streaming branch every `STREAM_PROGRESS_EVERY = 1000` records inside the for-await loop (`:455-457`) plus once after drain (replacing `:472-473`) — so a single streamed 400K-record page no longer reports only twice.

### `packages/core/src/models/api-connector.model.ts`

`ApiEndpointConfigBaseSchema` (`:186-200`) gains:

```ts
/** Optional pre-sync total-count probe (#458): the endpoint re-requested with
 *  these query params merged in (they win), reading an integer record count
 *  from `responsePath`. ArcGIS: { queryParams: { returnCountOnly: "true" }, responsePath: "count" }. */
totalCount: z
  .object({
    queryParams: z.record(z.string(), z.string()),
    responsePath: z.string().min(1),
  })
  .optional(),
```

No new refinement (valid with any method/pagination).

### `apps/api/src/db/schema/api-endpoint-configs.table.ts`

```ts
totalCount: jsonb("total_count").$type<{ queryParams: Record<string, string>; responsePath: string }>(),
```

`api-endpoints.router.ts` create (`:515-533`) and patch (`:776`) paths map `body.config.totalCount ?? null` ↔ the column, alongside the existing pagination flatten; the read path reattaches it onto the model shape.

### `apps/web/src/workflows/RestApiConnector/ApiEndpointForm.component.tsx`

A collapsed **"Record total (optional)"** section: reuse the existing query-param key/value editor for `totalCount.queryParams` and a text field for `totalCount.responsePath`, with helper text naming the ArcGIS example. Both-or-neither validation (a lone `responsePath` or lone params set fails the step's Zod parse — enforced by the schema shape: the object requires both fields). Cleared section → `totalCount` omitted.

### `packages/core/src/ui/Progress.tsx`

New optional `indeterminate?: boolean` prop → `variant="indeterminate"` (today hardcoded `variant="determinate"` at `:47`); `value` ignored when set. Existing consumers unchanged.

### `apps/web/src/utils/job-stream.util.ts`

- `JobStreamState` (`:21-30`) gains `progressDetail: JobProgressDetail | null` (initial `null`).
- `snapshot` handler (`:136-156`): set from `data.progressDetail`.
- `update` handler (`:158-184`): monotonic on `processed` — take the incoming detail only when `incoming.processed >= prev.progressDetail?.processed ?? -1` (same stale-event rationale as the percent clamp at `:170-171`).
- `awaitJobCompletion`'s number-typed `onProgress` (`:341-348`) is unchanged — its consumers are percent-milestone jobs.

### Web render surfaces (D4 rules, shared logic)

A small helper `formatJobProgress(detail: JobProgressDetail | null, percent: number)` in `apps/web/src/utils/job-progress.util.ts` (new) returns one of three shapes the components render:

| Case | Bar | Copy |
|---|---|---|
| `detail?.total` | determinate, `min(99, processed/total*100)` (100 only from terminal percent) | `"123,954 of 397,960 records"` (locale-formatted) |
| `detail` without `total` | indeterminate | `"123,954 records so far"` |
| no detail | determinate at `percent` (today's behavior) | `"${Math.round(percent)}%"` where percent text exists today |

- `ConnectorInstanceSyncFeedback.component.tsx:82-91` — live phase gains the copy line + bar mode; new UI prop `progressDetail: JobProgressDetail | null` threaded from `use-connector-instance-sync.util.ts` (`useJobStream` state).
- `JobDetail.view.tsx` (`:48/:100/:129`) — fraction replaces the percent text when detail exists; indeterminate bar when total unknown.
- `Job.component.tsx` (`:68-91`) — `JobCard` reads `job.progressDetail` (persisted, so lists render it with no stream open).

### Error codes / OpenAPI

No new `ApiCode` (pre-flight is fail-open; nothing user-facing throws). `swagger.config.ts` re-registers `Job`, snapshot/update event, and endpoint-config component schemas from their Zod sources.

## Migration

`cd apps/api && npm run db:generate -- --name add-progress-detail-and-endpoint-total-count` — one migration, two additive nullable columns:

1. `ALTER TABLE jobs ADD COLUMN progress_detail jsonb;`
2. `ALTER TABLE api_endpoint_configs ADD COLUMN total_count jsonb;`

No backfill (existing rows legitimately have no detail/probe), no ordering constraints, no seed change. **Seed: none.**

## TDD test plan

Run per package: `cd packages/core && npm run test:unit`; `cd apps/api && npm run test:unit && npm run test:integration`; `cd apps/web && npm run test:unit`. Touched-files only locally.

### `packages/core`

1. `JobProgressDetailSchema` accepts `{processed, total: null}` and `{processed, total: n>0}`; rejects negative `processed`, zero/negative `total`.
2. `JobSchema` parses with `progressDetail: null` and with a populated detail.
3. Snapshot/update contract schemas accept and omit (update only) `progressDetail`.
4. `ApiEndpointConfigSchema` accepts a valid `totalCount`, rejects one missing `responsePath` or with empty `responsePath`; config without `totalCount` still parses.

### `apps/api` — adapter (`__tests__/adapters/rest-api/rest-api.adapter.test.ts`)

5. **Replaces the #94 curve regression (`:761-796`):** a 3-page paginated sync calls `progress` with `{percent: 0}`, then `{processed}` strictly increasing per page (cumulative records, not pages), then `{percent: 100}`; no 95 tick, no percent between.
6. With `totalCount` configured and the probe returning a count, every per-page update carries `{processed, total}`; the probe request merged `totalCount.queryParams` over the endpoint's and hit the same path.
7. Probe failure (non-2xx / thrown / non-numeric at `responsePath`) → sync completes normally, updates carry no `total`, a warn is logged.
8. Two endpoints, one with a count and one without → no update carries `total`; `processed` accumulates across endpoints (second endpoint's reports include the first's records).
9. Two endpoints, both with counts → `total` = sum on every update.
10. Streaming branch: N-record stream reports `{processed}` at least every 1000 records and once after drain.

### `apps/api` — transport

11. `connector-sync.processor.test.ts` (`:95-104` updated): `opts.progress({processed: 5, total: 10})` forwards the object to `bullJob.updateProgress`.
12. `jobs.worker.test.ts`: a numeric progress event normalizes to `{percent}`; an object passes through; `null`/empty-object events are dropped without calling the service.
13. `job-events.service` tests: `{percent: 42}` writes `progress=42`, `progressDetail` untouched; `{processed: 50, total: 200}` writes `progress=25` + detail; `{processed: 199999, total: 200000}` and `{processed: 200000, total: 200000}` both cap at 99; `{processed: 7}` (no total) leaves `progress` unchanged, writes detail `{processed: 7, total: null}`, and the published event carries the row's existing percent.
14. Integration (`job-events.service.integration.test.ts`): detail round-trips the DB; the published `JobUpdateEvent` parses against the widened schema.
15. SSE router: snapshot includes `progressDetail` (null and populated).
16. `api-endpoints.router` integration: create/patch with `totalCount` round-trips the jsonb column; omitted → `NULL`; read path returns it in `config`.

### `apps/web`

17. `job-stream.util.test.ts`: snapshot seeds `progressDetail`; update replaces it monotonically (a lower `processed` is ignored); absent field leaves `null`.
18. `job-progress.util` (new): the three-case table above, including the 99 cap and locale formatting.
19. `ConnectorInstanceSyncFeedback.test.tsx`: fraction copy + determinate bar with total; "records so far" + indeterminate without; percent-only fallback unchanged.
20. `JobDetailView.test.tsx` / `JobsView.test.tsx` (JobCard): render from `job.progressDetail`.
21. `ApiEndpointForm` test: totalCount section round-trips values into the submitted config; empty section omits the key.
22. Core UI `Progress` test/story: `indeterminate` renders MUI indeterminate variant.

**Totals ≈ 30 cases** (4 core, 12 api, 6 web render, plus ~8 assertions folded into existing suites being updated). No dedicated migration test — additive nullable columns are covered by the dual-schema type-checks and the round-trip integrations (13–16).

## Acceptance criteria

- [ ] A long paginated sync with no configured total shows a monotonically increasing record count and an indeterminate bar — **no percentage is displayed anywhere for it mid-run**.
- [ ] The same sync with `totalCount` configured shows "X of Y records" and a determinate bar that tracks records, reaching 100 only at completion.
- [ ] Reload/reconnect mid-sync (snapshot path) and the jobs list/detail views show the same counts as the live stream — the detail is persisted, not stream-only.
- [ ] A failing count probe never fails or delays a sync beyond the one probe request; the run degrades to the count-only display.
- [ ] Multi-endpoint syncs show cumulative records; a percent/total appears only when every endpoint had a count.
- [ ] Google-sheets and microsoft-excel syncs behave exactly as before (milestone percents).
- [ ] The other five processors' numeric progress still renders (worker normalization).
- [ ] `npm run build && npm run type-check && npm run lint` clean; all suites green; migration applies on a fresh and an existing DB.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| A stray non-conforming object hits `updateProgress` (BullMQ progress is untyped). | Worker normalization drops updates with neither `percent` nor `processed`; service treats absent fields as no-ops (test 12). |
| Detail-only updates publishing `progress: 0` regress the meter for reconnecting clients. | `updateProgress` publishes from the post-UPDATE returned row; web keeps the monotonic clamp as a second guard. |
| Count probe against a slow/hostile API stalls the sync start. | Probe uses the adapter's existing per-request fetch timeout; one request per endpoint, fail-open on timeout. |
| Probe count disagrees with reality (rows added/removed mid-sync). | Display clamps at 99 until terminal; `processed` may exceed `total` visually capped — copy still shows true counts. Accepted: the total is labeled by behavior, not promised exact. |
| `jobs.progress` semantics change surprises a consumer that polls the integer. | Only connector-sync changes what it writes there (0 → 100); all in-repo consumers are updated in this PR; no external API consumers exist. |

**Rollback:** revert the PR; the two nullable columns are inert for old code (Drizzle ignores unknown columns) and can be dropped in a follow-up migration if desired. Fail-mode posture: the probe and all detail handling are **fail-open** — worst case is a less-informative meter, never a failed or blocked sync.

## Files touched

**`packages/core`** — edit: `models/job.model.ts`, `models/api-connector.model.ts`, `contracts/job.contract.ts`, `ui/Progress.tsx`; tests under `__tests__/`.

**`apps/api`** — edit: `adapters/adapter.interface.ts`, `adapters/rest-api/rest-api.adapter.ts`, `queues/processors/connector-sync.processor.ts`, `queues/jobs.worker.ts`, `services/job-events.service.ts`, `routes/job-events.router.ts`, `routes/api-endpoints.router.ts`, `db/schema/jobs.table.ts`, `db/schema/api-endpoint-configs.table.ts`, `db/schema/zod.ts` (if shapes are re-exported), `config/swagger.config.ts`, `adapters/google-sheets/google-sheets.adapter.ts`, `adapters/microsoft-excel/microsoft-excel.adapter.ts`; new: the migration; tests updated per plan.

**`apps/web`** — new: `utils/job-progress.util.ts`; edit: `utils/job-stream.util.ts`, `utils/use-connector-instance-sync.util.ts`, `components/ConnectorInstanceSyncFeedback.component.tsx`, `components/Job.component.tsx`, `views/JobDetail.view.tsx`, `workflows/RestApiConnector/ApiEndpointForm.component.tsx` (+ its validation util); tests updated per plan.

No new dependency, no env var, no seed change.

## Next step

`docs/CONNECTOR_SYNC_PROGRESS.plan.md` — likely four TDD slices, each a green commit on this branch: (1) contract + transport (core schemas, column + migration, interface, processor, worker normalization, `updateProgress` derive/persist/publish, SSE snapshot); (2) REST adapter — curve deletion, record-count reporting incl. streaming cadence, `totalCount` probe + endpoint-config column/router/model; (3) milestone-adapter migration + `ApiEndpointForm` totalCount section; (4) web rendering — `job-progress.util`, `Progress` indeterminate, the three surfaces + `useJobStream` detail state.
