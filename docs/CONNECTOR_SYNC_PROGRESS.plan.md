# Honest connector-sync progress — Plan

**TDD-sequenced implementation of the structured progress contract: the `JobProgressDetail` schemas + `progress_detail`/`total_count` columns and tolerant transport first, then the adapter contract flip and the curve's replacement with record counts, then the count probe, then the web rendering, then the endpoint-form UI + doc sync.**

Spec: `docs/CONNECTOR_SYNC_PROGRESS.spec.md`. Discovery: `docs/CONNECTOR_SYNC_PROGRESS.discovery.md`. Issue: #458 (split from #441, epic #444).

Five slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `fix/connector-sync-progress`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run (`--testPathPattern` on touched files); (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — the transport must *tolerate* the new shape before any producer *emits* it:

- **Slice 1** — schemas, both additive columns + the one migration, and the read/persist path (worker normalization, `updateProgress`, SSE snapshot, endpoint-config round-trip). Every producer still sends bare numbers; behavior is unchanged, so nothing else churns.
- **Slice 2** — the contract flip: `SyncInstanceOptions.progress` takes `SyncProgressUpdate`, the processor forwards the object, the curve dies, the REST adapter reports cumulative records, the milestone adapters convert mechanically. One slice because the signature change forces all its call sites to move together (no green boundary exists between them).
- **Slice 3** — the `totalCount` probe, isolated: pure adapter addition on top of slice 2's reporter; fail-open semantics get their own focused suite.
- **Slice 4** — web: stream state, the display helper, `Progress` indeterminate, the three render surfaces.
- **Slice 5** — the `ApiEndpointForm` "Record total" section + doc-sync sweep.

---

## Slice 1 — Schemas, migration, tolerant transport

The full persistence + read path for structured progress, with no producer yet emitting it. All existing behavior identical (numbers normalize to `{ percent }`).

**Files**

- Edit: `packages/core/src/models/job.model.ts` — `JobProgressDetailSchema` + `JobSchema.progressDetail` (spec → *job.model.ts*).
- Edit: `packages/core/src/contracts/job.contract.ts` — `progressDetail` on snapshot (`nullable`) + update (`nullable().optional()`).
- Edit: `packages/core/src/models/api-connector.model.ts` — `totalCount` on `ApiEndpointConfigBaseSchema`.
- Edit: `apps/api/src/db/schema/jobs.table.ts` (+`progressDetail` jsonb), `apps/api/src/db/schema/api-endpoint-configs.table.ts` (+`totalCount` jsonb), `db/schema/zod.ts` / `type-checks.ts` ripple.
- New: migration via `cd apps/api && npm run db:generate -- --name add-progress-detail-and-endpoint-total-count` (both additive nullable columns; no backfill, no seed).
- Edit: `apps/api/src/adapters/adapter.interface.ts` — export `SyncProgressUpdate` (the interface only; the `progress` callback signature does **not** change yet).
- Edit: `apps/api/src/queues/jobs.worker.ts:317-322` — normalization (number → `{percent}`, object pass-through, empty drop).
- Edit: `apps/api/src/services/job-events.service.ts` — `updateProgress(jobId, update: SyncProgressUpdate)`: derive percent (99 cap), conditional column writes, `.returning()`, publish detail from the row.
- Edit: `apps/api/src/routes/job-events.router.ts:76-85` — snapshot gains `progressDetail`; `config/swagger.config.ts` re-registers the touched component schemas.
- Edit: `apps/api/src/routes/api-endpoints.router.ts` — create/patch/read map `totalCount` ↔ `total_count`.
- Tests: core model/contract suites; `jobs.worker.test.ts`; job-events unit + integration; SSE router; `api-endpoints.router` integration.

**Steps**

1. **Tests (spec cases 1–4, 12–16).** Core: detail schema bounds, `JobSchema`/event schemas accept the field, `totalCount` validation. API: worker normalizes a number to `{percent}` and passes an object through, drops `null`/empty (12); `updateProgress` writes `progress=42` for `{percent:42}`, derives 25 from `{processed:50,total:200}`, caps at 99, leaves `progress` unchanged on a detail-only update while the published event carries the row's percent (13); DB round-trip + widened event parse (14); snapshot carries `progressDetail` (15); endpoint config round-trips `totalCount` (16). Run; fail.
2. **Implement** in dependency order: core schemas → table columns → `db:generate` + `db:migrate` locally → worker normalization → `updateProgress` → snapshot → router mapping. Green.
3. Existing suites that mock `updateProgress(jobId, number)` update to the new signature mechanically.
4. Lint + type-check at repo root.

**Done when:** cases 1–4 and 12–16 pass; every producer still sends numbers and all existing progress behavior is bit-identical (the #94 curve test at `rest-api.adapter.test.ts:761-796` still passes untouched).

**Risk:** `Repository.update` may not return the row — confirm and add a returning variant if needed (the publish-from-row rule is load-bearing for detail-only updates; spec *Risks* row 2).

---

## Slice 2 — Contract flip: `SyncProgressUpdate` end to end, curve deleted

The producer side moves in one commit because the signature change breaks every call site simultaneously: interface, processor, REST adapter (curve → records), and the two milestone adapters.

**Files**

- Edit: `apps/api/src/adapters/adapter.interface.ts` — `progress?: (update: SyncProgressUpdate) => void`.
- Edit: `apps/api/src/queues/processors/connector-sync.processor.ts:92-94` — forward the object.
- Edit: `apps/api/src/adapters/rest-api/rest-api.adapter.ts` — delete the curve block + 95 tick + `reportPage`; `progress?.({percent: 0})` / `{percent: 100}`; per-endpoint `reportProcessed(counts.recordIndex)` with a cross-endpoint `processedBase`; streaming branch reports every `STREAM_PROGRESS_EVERY = 1000` records + once after drain. No probe yet — updates carry `processed` only.
- Edit: `apps/api/src/adapters/google-sheets/google-sheets.adapter.ts`, `apps/api/src/adapters/microsoft-excel/microsoft-excel.adapter.ts` — milestones become `{percent: N}` (mechanical).
- Tests: `rest-api.adapter.test.ts` (the #94 curve regression at `:761-796` is **replaced** by case 5), `connector-sync.processor.test.ts:95-104` (case 11), both milestone adapters' progress assertions, the two REST integration suites' progress expectations.

**Steps**

1. **Tests (spec cases 5, 10, 11).** Adapter: 3-page sync emits `{percent:0}`, strictly increasing cumulative `{processed}` per page (records, not pages), `{percent:100}`, no 95 tick, no in-between percent (5); streaming emits `{processed}` at least every 1000 records + after drain (10); multi-endpoint `processed` accumulates across endpoints (the no-total half of case 8). Processor forwards the object verbatim (11). Milestone adapters emit `{percent: 0/10/40/80/95/100}` unchanged in sequence. Run; fail (compile errors count as failing).
2. **Implement** the interface flip, processor forward, curve deletion + record reporter, milestone conversion. Green.
3. Update the REST end-to-end/paginated integration expectations.
4. Lint + type-check.

**Done when:** cases 5, 10, 11 pass; a real sync's meter is driven by records (percent stays 0 mid-run in the DB — honest — with detail carrying the count); sheets/excel behave exactly as before.

**Risk:** the largest slice — but splitting it would leave a compile-broken boundary. Watch the streaming counter: `counts.recordIndex` is mutated by the shared writer, so the every-1000 check reads it, not a local counter.

---

## Slice 3 — `totalCount` probe (fail-open)

The denominator, layered onto slice 2's reporter. Pure adapter addition.

**Files**

- Edit: `apps/api/src/adapters/rest-api/rest-api.adapter.ts` — pre-flight loop before the endpoint loop: per configured endpoint, one request via `buildUrl` with `totalCount.queryParams` merged over the endpoint's (probe wins), integer read from `responsePath` with the `recordsPath` extraction helper; `grandTotal` = sum only when **every** endpoint yielded a count; reporter attaches `total: grandTotal` when defined; warn log `rest-api.sync.count-preflight-failed` on any failure.
- Tests: `rest-api.adapter.test.ts` probe cases.

**Steps**

1. **Tests (spec cases 6–9).** Probe success → every per-page update carries `{processed, total}` and the probe request hit the same path with merged params (6); probe failure (non-2xx / thrown / non-numeric) → sync completes, no `total`, warn logged (7); two endpoints, one count → no `total` anywhere (8); two counts → `total` = sum on every update (9). Run; fail.
2. **Implement** the pre-flight. Green.
3. Lint + type-check.

**Done when:** cases 6–9 pass; a probe failure demonstrably cannot fail, retry, or charge the sync (fail-open, spec D3).

**Risk:** POST endpoints with `bodyTemplate` — the probe reuses method/body as-is per spec; assert one POST case inside case 6's suite so the body isn't accidentally dropped.

---

## Slice 4 — Web: stream state + the three render surfaces

Everything the user sees. Backend contract is frozen by slices 1–3.

**Files**

- New: `apps/web/src/utils/job-progress.util.ts` — `formatJobProgress(detail, percent)` (the spec's three-case table: determinate fraction / indeterminate count / percent fallback; locale formatting; 99 cap).
- Edit: `packages/core/src/ui/Progress.tsx` — `indeterminate?: boolean` prop.
- Edit: `apps/web/src/utils/job-stream.util.ts` — `JobStreamState.progressDetail` + snapshot seed + monotonic-on-`processed` update clamp.
- Edit: `apps/web/src/utils/use-connector-instance-sync.util.ts` — thread `progressDetail` through.
- Edit: `apps/web/src/components/ConnectorInstanceSyncFeedback.component.tsx` (live phase copy + bar mode), `apps/web/src/views/JobDetail.view.tsx` (fraction replaces percent text when detail exists), `apps/web/src/components/Job.component.tsx` (`JobCard` reads `job.progressDetail`).
- Tests: `job-stream.util.test.ts`, new `job-progress.util` suite, `ConnectorInstanceSyncFeedback.test.tsx`, `JobDetailView.test.tsx`, `JobsView.test.tsx`, core `Progress` test/story.

**Steps**

1. **Tests (spec cases 17–20, 22).** Stream: snapshot seeds detail, update replaces monotonically, lower `processed` ignored (17). Helper: three-case table incl. cap + locale (18). Feedback: "123,954 of 397,960 records" + determinate with total; "… records so far" + indeterminate without; percent-only fallback (19). JobDetail/JobCard render from persisted detail (20). `Progress` renders MUI indeterminate (22). Run; fail.
2. **Implement** core `Progress` prop first (rebuild `packages/core` before web tests — `project_npx_uses_stale_dist` / stale-dist memory), then helper, stream state, surfaces. Green.
3. Lint + type-check.

**Done when:** cases 17–20 + 22 pass; a mid-sync reload shows the same counts as the live stream (persisted detail via snapshot).

**Risk:** stale `@portalai/core` dist breaking web type-check — rebuild core at the boundary.

---

## Slice 5 — `ApiEndpointForm` "Record total" section + doc sync

The authoring affordance for the denominator (discovery Q3: in this ticket), plus the standing doc-sync check.

**Files**

- Edit: `apps/web/src/workflows/RestApiConnector/ApiEndpointForm.component.tsx` — collapsed "Record total (optional)" section reusing the existing query-param KV editor + a `responsePath` text field, ArcGIS example in helper text; its validation util (`workflows/RestApiConnector/utils/`) extends the endpoint Zod parse (the schema's both-or-neither shape enforces itself).
- Edit: doc surfaces per the *What changed → what to check* table — the RestApi workflow helper text (this section), plus a check of `glossary.util.ts` / `faq.util.ts` / `getting-started.util.ts` for copy describing sync progress percentages, and `apps/api/README.md` if it documents the job progress column.
- Tests: `ApiEndpointForm` test (round-trip + omit-when-empty).

**Steps**

1. **Tests (spec case 21).** Filled section lands `totalCount` in the submitted config; cleared section omits the key; a lone `responsePath` fails validation. Run; fail.
2. **Implement** the section + helper text. Green.
3. **Doc sweep:** update any surface found describing the old percent behavior; state "none found" in the commit body otherwise.
4. Lint + type-check; full touched-package suites once more.

**Done when:** case 21 passes; doc-sync check recorded; `npm run build && npm run type-check && npm run lint` clean at root.

**Risk:** none — additive form section.

---

## Sequence summary

| Slice | Lands | Spec cases | Tests |
|---|---|---|---|
| 1 | schemas + migration + tolerant transport (worker/service/SSE/router) | 1–4, 12–16 | core unit, api unit + integration |
| 2 | `SyncProgressUpdate` contract flip; curve → cumulative records; milestone adapters | 5, 10, 11 | api unit + integration |
| 3 | `totalCount` probe, fail-open | 6–9 | api unit |
| 4 | stream state + `Progress` indeterminate + three surfaces | 17–20, 22 | core + web unit |
| 5 | endpoint-form section + doc sync | 21 | web unit |

Total ≈ **30 cases**, one migration (slice 1). Commits on `fix/connector-sync-progress`; the PR grows commit-by-commit.

---

## Cross-slice notes

- **Both columns land in slice 1's single migration** even though `total_count` is unused until slice 3 — additive nullable columns are inert, and `db:generate` diffs the whole schema, so co-locating avoids a second migration file.
- **The 99 cap lives in exactly two places** and must agree: `JobEventsService.updateProgress` (persisted percent, slice 1) and `formatJobProgress` (bar width when rendering from detail, slice 4). Only an asserted `{percent: 100}` reads 100.
- **Slice 1 must not change observable behavior.** Its boundary check is that the untouched #94 curve test still passes; if it doesn't, the normalization changed semantics for numeric producers (file-upload-parse, layout-plan-commit, revalidation, system-check, bulk-geocode).
- **`awaitJobCompletion`'s numeric `onProgress` is deliberately untouched** (spec) — its consumers are percent-milestone jobs. Don't "fix" it in passing.
- **`publishCustomEvent` and the bulk `batch` channel are untouched** (discovery Q2 deferral); convergence is a follow-up ticket.
- **Rebuild `packages/core` before running api/web suites after slices 1 and 4** — the stale-dist failure mode (15 errors in files you didn't touch) is a known trap.
- **Doc sync is slice 5's step 3**, not a follow-up: the RestApi workflow helper text is the known surface; glossary/FAQ/READMEs get a recorded check.

---

## Next step

Implementation begins on this branch once discovery + spec + plan are confirmed — slice 1 first, tests before code, one commit per slice, `/smoke 458` after slice 5.
