# Honest connector-sync progress — Discovery

**Issue:** [EnterpriseBT/portal-ai#458](https://github.com/EnterpriseBT/portal-ai/issues/458)

**Why this exists.** The connector-sync meter is driven by an asymptotic page-count curve (`intra = 1 - exp(-pagesEmitted/20)`, `apps/api/src/adapters/rest-api/rest-api.adapter.ts:279-280`) that saturates at 90% from ~page 120 regardless of data volume — a 397,960-record layer read 90% from 31% of its data onward, and that confidently-wrong number misdirected the #435 investigation. The curve exists because cursor/link pagination genuinely can't know a total up front (#94), but the contract collapses *guess* and *known quantity* into one bare integer with no way to tell them apart. This is the contract change that makes the progress channel carry what is actually known — a records-processed count, an optional total, and a percent only when one is honest.

## The current shape

### Producer (adapters)

| Piece | Location | Note |
|---|---|---|
| The curve | `rest-api.adapter.ts:255-296` | `slicePct = 90 / endpoints.length`; per-page `progress(basePct + intra*slicePct)`; fixed ticks 0 / 95 / 100 |
| `pagesEmitted` | `rest-api.adapter.ts:279` | A *page* count, not records — streaming-eligible endpoints emit only ~2 "pages" (`:353-359`) |
| Pagination iterators | `apps/api/src/adapters/rest-api/pagination/` | Pull generators (`types.ts:16-52`); end-of-data only by inspecting each response; **no mode reports a grand total**, no count header/field is parsed anywhere |
| Contract | `adapter.interface.ts:148-165` | `SyncInstanceOptions.progress?: (percent: number) => void`; sole non-test constructor is the processor |
| Other adapters | `google-sheets.adapter.ts:93-180`, `microsoft-excel.adapter.ts:96-183` | Fixed milestone percents (0/10/40/80/95/100), no per-record signal |

### Transport & persistence

| Piece | Location | Note |
|---|---|---|
| Forwarding | `connector-sync.processor.ts:92-94` | `(percent) => void bullJob.updateProgress(percent)`; all six processors forward bare numbers |
| Worker catch | `jobs.worker.ts:318-322` | **Guards `typeof progress === "number"`** — an object progress is silently dropped today |
| Persist + publish | `job-events.service.ts:214-229` | `JobEventsService.updateProgress` writes `jobs.progress` and publishes a `JobUpdateEvent` via Redis |
| Schema | `jobs.table.ts:44-49` | `progress integer NOT NULL DEFAULT 0`; row also carries `metadata jsonb NOT NULL DEFAULT {}` and nullable `result jsonb` |

### Read side (SSE, API, web)

| Piece | Location | Note |
|---|---|---|
| SSE endpoint | `routes/job-events.router.ts:54-136` | `snapshot` then `update`/custom events; custom events re-emitted as `job:<type>` (`:97-101`) |
| Event schemas | `packages/core/src/contracts/job.contract.ts:62-82` | `JobSnapshotEventSchema` / `JobUpdateEventSchema`, both scalar `progress: z.number()` |
| Job model | `packages/core/src/models/job.model.ts:721-723` | `progress: z.number()`, `metadata`/`result` as `z.record` |
| SSE client | `apps/web/src/utils/job-stream.util.ts:58-247` | `useJobStream`; monotonic-clamps scalar progress (`:170-171`); already demultiplexes a custom event (`job:recommendations`, `:188-201`) |
| Sync feedback | `ConnectorInstanceSyncFeedback.component.tsx:82-91` | "Syncing…" + `<Progress value={progress}/>` — where "123,954 of 397,960" lands |
| Job detail / list | `JobDetail.view.tsx:48/100/129`, `Job.component.tsx:68-91` | `${Math.round(progress)}%` text + bar; list cards use `progress ?? job.progress` |

### Prior art — the bulk-job "batch" channel

`BulkJobProgressBlock.component.tsx:167-171` already renders "`{recordsProcessed} / {totalRecords} records`" with an ETA (`:121-132`), fed by `JobEventsService.publishCustomEvent(jobId, "batch", { recordsProcessed, totalRecords, … })` from `bulk-transform.processor.ts:296/422` and `bulk-geocode.processor.ts:239`. Two caveats: it **bypasses the DB entirely** (a reconnect backfills terminal counts from `result`, `:310-336`), and its total is pre-declared at dispatch (`BulkGeocodeMetadataSchema.expectedRecords`, `job.model.ts:481`) — a luxury connector-sync doesn't have. No processor passes an object to `updateProgress`; BullMQ object-progress is unused.

### Count-fetching feasibility

Endpoint config is one row per entity in `api-endpoint-configs.table.ts` (`pagination`, `paginationConfig` jsonb, `path`/`queryParams`/`bodyTemplate`); Zod side in `packages/core/src/models/api-connector.model.ts:79+`. There is **no provider concept** — ArcGIS is recognized only heuristically (`geometry.util.ts`, `inference.util.ts`). A pre-sync count request would slot into `syncOneEndpoint` before the pagination loop (`rest-api.adapter.ts:371-375`); there is currently no per-endpoint pre-flight (`fetch-first-page.util.ts` is a discovery-time probe, not sync).

## The design space

### Decision 1 — Where the structured progress travels and lives

**A. Custom SSE event only (extend the bulk "batch" pattern).** Publish `{recordsProcessed, totalRecords?}` via `publishCustomEvent`; scalar `jobs.progress` keeps carrying something. Cheapest wire change, but it inherits the bulk pattern's known hole: nothing persists, so a page reload, the snapshot, `JobDetail`, and the jobs list all still show the lying scalar. The bug is that the *persisted, reconnect-visible* number is wrong — A fixes only the live view.

**B. Object progress through BullMQ, persisted in a dedicated `progress_detail` jsonb column.** Widen `updateProgress` to accept `{ percent, processed, total? }`, fix the worker's number-only guard, have `JobEventsService.updateProgress` write the computed integer percent to `progress` *and* the detail object to a new nullable `progress_detail` jsonb. Snapshot, update events, and the REST job read all carry the detail. One migration; every read surface sees the same truth live and after reconnect.

**C. Same as B but persist detail into the existing `metadata` jsonb (no migration).** The issue floats this. But `metadata` is written at enqueue and is the *lock contract* (which entities a job locks, per CLAUDE.md) — rewriting it per page mixes a high-frequency mutable channel into a field other code treats as immutable dispatch input, and every update rewrites the whole blob.

| | A (event only) | B (new column) | C (metadata jsonb) |
|---|---|---|---|
| Fixes reconnect / JobDetail / list | No | Yes | Yes |
| Migration | None | One additive column | None |
| Blast radius | Low | Worker guard + service + schemas | Same as B, plus metadata-semantics risk |
| Write amplification | None | Small jsonb per existing write | Rewrites whole metadata per page |

**Lean: B.** The persisted number is the one every surface and every future bug report reads; a migration is one additive nullable column and there is no production data pressure. C saves a migration by contaminating the lock-contract field.

### Decision 2 — The adapter-facing contract shape

**A. Replace the callback signature outright:** `progress?: (update: SyncProgressUpdate) => void` with `SyncProgressUpdate = { percent?: number; processed?: number; total?: number }` — percent for milestone-style adapters (sheets/excel keep their 0/10/40/80/95/100), processed/total for record-streaming ones; the transport computes percent as `processed/total` when a total exists, otherwise persists detail with no percent claim. Clean cut, type checker finds every call site.

**B. Add a second optional callback** (`progressDetail?`) beside the scalar one. Two channels to keep coherent, and the repo convention is no compat aliases for internal renames.

**Lean: A.** One channel, one shape; the union of "percent I assert" and "counts I know" covers every adapter today, and the object is additive-open for later fields (phase, ETA).

### Decision 3 — How a total gets known (per-provider capability vs. user config vs. skip)

**A. Generic optional per-endpoint count config.** An optional `totalCount` block on the endpoint config (`queryParams` overrides + a response path for the count) — ArcGIS is `returnCountOnly=true` → `count`. Fits the existing generic-REST model (no provider concept exists to hang a capability on), and the inference heuristics can pre-fill it for recognized ArcGIS endpoints later.

**B. Provider-specific detection at sync time.** Sniff ArcGIS-ness and issue `returnCountOnly=true` automatically. Magic for one vendor, invisible to the user, and wrong the day a lookalike API differs.

**C. Skip count-fetching in this ticket.** Ship the honest fallback only (records-processed, no percent). Smaller, but the issue's acceptance explicitly includes "fetched where cheaply obtainable", and the fallback-only meter for the motivating ArcGIS case would stay indeterminate forever.

**Lean: A.** Config, not heuristics — consistent with the standing "heuristic analyzer stays generic" and "accept values from payload, don't derive" feedback. The count pre-flight is strictly best-effort: any failure degrades to unknown-total, never fails the sync.

### Decision 4 — What the meter shows

- **Total known (all endpoints reported one):** determinate bar from `processed/total`, primary copy "123,954 of 397,960 records". Percent is derived, never asserted separately.
- **Total unknown (any endpoint lacks one):** **indeterminate** bar + "123,954 records so far". No percent anywhere — an absent number is the honest rendering the issue asks for.
- **Multi-endpoint:** report cumulative `processed` across endpoints always; report a `total` only when every endpoint produced one (sum). Per-endpoint slicing of a percent band disappears with the curve.
- Milestone-only adapters (sheets/excel) keep a determinate percent bar — their milestones are real phase boundaries, not guesses.

**Lean: as above.** Fraction primary when known; count-without-percent when not; never a synthetic percent. `JobDetail` and list cards render from the persisted `progress_detail`, falling back to the scalar for job types that never send detail.

## Tradeoff comparison

| | D1: persist in new column | D2: replace callback shape | D3: generic count config | D4: fraction-or-count display |
|---|---|---|---|---|
| Spread to spec | Yes — schema + contracts | Yes — adapter interface | Yes — endpoint config schema | Yes — web acceptance criteria |
| Migration | One additive column | No | Endpoint-config jsonb is schemaless — Zod only | No |
| Touches | api, core | api | api, core, web (config UI) | web, core |

## Recommendation

1. Replace `SyncInstanceOptions.progress` with `(update: SyncProgressUpdate) => void`, `SyncProgressUpdate = { percent?: number; processed?: number; total?: number }` (Zod schema in `job.model.ts`), and delete the asymptotic curve; the REST adapter reports cumulative records processed per page plus the summed total when known.
2. Widen the transport end-to-end: processor forwards the object to `bullJob.updateProgress`; `jobs.worker.ts` accepts number *or* object; `JobEventsService.updateProgress` writes the derived integer percent to `jobs.progress` (unchanged column) and the object to a new nullable `progress_detail` jsonb column (one additive migration), and includes it in the published update event.
3. Carry `progressDetail` in `JobSnapshotEventSchema`, `JobUpdateEventSchema`, the `JobSchema` model, and the jobs REST reads, so live, reconnect, detail, and list surfaces all read one truth.
4. Add an optional `totalCount` block to the REST endpoint config (query-param overrides + response count path); `syncOneEndpoint` issues it as a best-effort pre-flight and any failure means unknown-total, never a sync failure.
5. Render per Decision 4 in `ConnectorInstanceSyncFeedback`, `JobDetail`, and `Job` cards: fraction + determinate bar when total known; count + indeterminate bar when not; scalar-percent fallback for job types without detail.
6. Milestone adapters (google-sheets, microsoft-excel) migrate mechanically to `{ percent }` updates — no behavior change.

## Open questions

1. **Does `jobs.progress` keep meaning "percent" when total is unknown?** The column is `NOT NULL`; list cards read it. Lean: yes — when no total exists it advances only on real phase boundaries (0 at start, 95 finalize, 100 done), and every surface that has `progress_detail` prefers it; the integer becomes a coarse fallback, never a fabricated mid-sync value.
2. **Should the bulk jobs' custom `batch` event migrate onto `progress_detail` now?** Same shape, and it would fix their own reconnect blind spot. Lean: no — out of scope; note it as a follow-up so the two channels converge deliberately, not accidentally.
3. **Where does the `totalCount` config get authored?** The RestApi connector workflow's endpoint step (web UI) vs. config-only (API/JSON). Lean: expose it in the endpoint step's advanced options in this ticket, since the motivating ArcGIS user needs a way to set it; inference pre-fill is a follow-up.
4. **Throttling.** Progress already writes the DB once per page today; the detail object adds bytes, not frequency. Lean: keep per-page cadence, no new throttle — revisit only if streaming endpoints change the cadence.
5. **ETA.** `BulkJobProgressBlock` shows one; should sync? Lean: not in this ticket — `SyncProgressUpdate` is additive-open, an ETA can derive client-side from detail timestamps later.

## Enterprise-scale considerations

- **Concurrency & correctness** — progress writes stay on the existing single-writer path (the job's own worker, guarded by `SyncLockService` per #460); monotonicity is enforced client-side as today. Lean: no new coordination needed; detail writes ride the existing `updateProgress` transaction.
- **Accuracy & auditability** — progress is ephemeral operational state, not a record of truth; terminal counts already land in `result`. Lean: `progress_detail` is display state; `result` remains the audit surface.
- **Failure modes** — the count pre-flight is fail-open by design: an error, timeout, or unparsable count degrades to unknown-total (indeterminate meter) and the sync proceeds. Cost of failing open is a less-informative meter, never wrong data. Lean: fail-open, explicitly.
- **Scale & unbounded growth** — write cadence unchanged (per page); the detail blob is O(1). SSE fan-out unchanged. Lean: no new growth surface.
- **Multi-tenancy** — N/A because progress is scoped to a job row the org already owns; no cross-tenant surface changes.
- **Contract stability** — `SyncProgressUpdate` is an open object; future fields (phase, ETA, per-endpoint breakdown) are additive. The `totalCount` endpoint-config block is optional and per-endpoint. Lean: both shapes additive-open.
- **Data lifecycle** — N/A because `progress_detail` lives and dies with the job row under the existing job retention story.

## What this doesn't decide

- Migrating the bulk jobs' `batch` custom event onto the persisted channel — follow-up, so the convergence is deliberate.
- Inference pre-filling `totalCount` for recognized ArcGIS endpoints — nice-to-have on top of the config field, not needed for the fix.
- ETA display for connector sync — the contract leaves room; no ticket asks for it.
- Any change to how streaming-eligible endpoints chunk work — they benefit automatically because records, not pages, drive the count.

## Next step

Write `docs/CONNECTOR_SYNC_PROGRESS.spec.md` (the `SyncProgressUpdate` contract, `progress_detail` column + event/model schemas, `totalCount` endpoint config, and the display rules as acceptance criteria) and `docs/CONNECTOR_SYNC_PROGRESS.plan.md`. Likely slices: (1) contract + transport (interface, processor, worker guard, service, migration, schemas), (2) REST adapter — curve deletion, record counting, count pre-flight, (3) milestone-adapter migration + endpoint-config UI field, (4) web rendering across the three surfaces. Tests to update are pinned in the survey: `rest-api.adapter.test.ts:761-796` (#94 curve regression), `connector-sync.processor.test.ts:95-104`, `jobs.worker.test.ts`, the SSE contract tests, and the web progress component tests.
