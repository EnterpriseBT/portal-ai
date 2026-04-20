# Legacy File Upload Deprecation — Implementation Plan

Step-by-step plan to retire the `/api/uploads/*` endpoints (and every file exclusively serving them) now that `/api/connector-instances/:id/layout-plan/*` is the canonical upload surface per **`SPREADSHEET_PARSING.backend.plan.md`**.

## Scope

- **Deprecate and delete** the three legacy endpoints, their services/utilities, core schemas, API codes, tests, and Swagger docs.
- **Migrate** the sole frontend consumer (`apps/web/src/utils/file-upload.util.ts` + the `FileUploadConnectorWorkflow` stubs) to the plan-driven SDK.
- **Preserve** shared infrastructure: S3Service, BullMQ worker, `jobs` table, `ConnectorEntity` / `FieldMapping` / `entity_records` write path — these have non-upload consumers.

## Non-goals

- Data backfill of historical `ConnectorEntity` rows into `LayoutPlan` rows. Existing connector instances created via the legacy path keep syncing from their stored `FieldMapping`s with no behaviour change. If a user wants plan-driven editing, they re-upload.
- Removing the `FileUploadConnector` workflow itself — it stays as a connector; only its backend plumbing swaps.
- Changes to `/api/connector-instances/:id/layout-plan/*`. The new surface is assumed shipped and stable. This plan cuts the old one away.

## Precondition — "new path is ready"

Before Phase 1 begins, every item below must be green:

- `POST /api/connector-instances/:id/layout-plan/interpret` and `.../commit` are live in the environment we're deprecating in.
- The integration suite under `apps/api/src/__tests__/__integration__/routes/connector-instance-layout-plans.router.integration.test.ts` covers every behaviour the legacy suite covered — simple-layout CSV, single-sheet XLSX, multi-sheet XLSX, date coercion, UTF-16/Latin-1 encodings, oversize-file rejection, duplicate filename rejection, S3 retrieval failure. Phase 2 of this plan is gated on that parity proof.
- The `LayoutPlan` → `ConnectorEntity` → `FieldMapping` → `entity_records` write path has committed at least one real upload in staging.

If any of those is missing, this plan does not start. It is ordered on purpose: telemetry first (Phase 0), consumer migration second (Phase 1), parity proof third (Phase 2), then progressive disablement, then deletion.

## Deprecation surface (inventory)

Audited from the current codebase. Every row is in scope for removal by Phase 5.

### Backend routes — `apps/api/src/routes/uploads.router.ts`

- `POST /api/uploads/presign` (handler line 75)
- `POST /api/uploads/:jobId/process` (handler line 227)
- `POST /api/uploads/:jobId/confirm` (handler line 351)

### Backend services and utilities (legacy-only)

- `apps/api/src/services/uploads.service.ts` (369 LOC)
- `apps/api/src/services/csv-import.service.ts` (39 LOC)
- `apps/api/src/services/xlsx-import.service.ts` (46 LOC)
- `apps/api/src/services/file-analysis.service.ts` (shrunk to adapter by backend-plan Phase 4; deleted here)
- `apps/api/src/utils/csv-parser.util.ts` — `FileParseResult`-producing half only. Adapter half already moved to `workbook-adapters/csv.adapter.ts` in backend-plan Phase 1.
- `apps/api/src/utils/xlsx-parser.util.ts` — same split as csv.
- `apps/api/src/utils/column-stats.util.ts`
- `apps/api/src/utils/heuristic-analyzer.util.ts`
- `apps/api/src/prompts/file-analysis.prompt.ts`
- `apps/api/src/queues/processors/file-upload.processor.ts`

### Core contracts and models

- `packages/core/src/contracts/upload.contract.ts` — all eleven `Presign*`, `Process*`, `Confirm*` schemas.
- `packages/core/src/models/job.model.ts` — `ColumnStatSchema`, `FileParseResultSchema`, `FileUploadColumnRecommendationSchema`, `FileUploadRecommendationEntitySchema`, `FileUploadRecommendationSchema`, `FileUploadResultSchema`, `FileUploadMetadataSchema`, `FileUploadFileSchema`, `FileUploadJob` interface, `FileUploadJobModel`, `FileUploadJobModelFactory`, `CreateFileUploadJobParams`.
- `JobTypeEnum` — remove the `"file_upload"` member; `JOB_TYPE_SCHEMAS["file_upload"]` deleted.

### API error codes — `apps/api/src/constants/api-codes.constants.ts`

All 21 `ApiCode.UPLOAD_*` entries (lines 113–133). None are referenced by the new path.

### Frontend consumers

- `apps/web/src/utils/file-upload.util.ts` — calls `sdk.uploads.presign` and `sdk.uploads.process`.
- `apps/web/src/workflows/FileUploadConnector/FileUploadConnectorWorkflow.component.tsx` — currently wires the legacy util into the workflow's TODO stubs (per frontend-plan Phase 6).

### Infrastructure — preserved

- `apps/api/src/services/s3.service.ts` — `createPresignedUpload` is upload-exclusive and moves into a new `file-upload.service.ts` that the *new* path also uses for getting bytes from browser to S3. The rest of `S3Service` (`getObjectStream`, etc.) is shared; unchanged.
- `apps/api/src/queues/jobs.worker.ts` — BullMQ worker, shared with `system_check` and `revalidation` job kinds.
- `jobs` table — shared; only the `file_upload` kind goes away.
- `connectorInstances` / `connectorEntities` / `fieldMappings` / `entityRecords` tables — unchanged.

### Tests

- `apps/api/src/__tests__/__integration__/routes/uploads.router.integration.test.ts`
- `apps/api/src/__tests__/services/uploads.service.test.ts`
- `apps/api/src/__tests__/queues/processors/file-upload.processor.test.ts`
- `apps/api/src/__tests__/services/file-analysis.service.test.ts`
- `apps/api/src/__tests__/services/file-analysis.integration.test.ts`

### Swagger

Three inline `@openapi` JSDoc blocks in `uploads.router.ts` (lines 33, 203, 319).

## TDD rhythm

Each phase runs red → green → refactor → swagger. Deletion phases invert the usual red: we write tests asserting the thing is **gone** and pass them by deleting it.

Commands after each phase:

```bash
npm run type-check
npm --workspace apps/api run test:unit
npm --workspace apps/api run test:integration
npm --workspace apps/web run test:unit
```

---

## Phase 0 — Deprecation headers, telemetry, sunset date

**Goal**: every legacy endpoint announces deprecation on the wire and records each call, so we can *prove* traffic has stopped before deletion.

### 0.1 Red — `apps/api/src/__tests__/__integration__/routes/uploads.router.deprecation.test.ts`

- `POST /api/uploads/presign` (and both others) return response headers:
  - `Deprecation: true`
  - `Sunset: <ISO-8601 date — the committed cut-off>`
  - `Link: </api/connector-instances/{connectorInstanceId}/layout-plan/interpret>; rel="successor-version"`
- Every legacy hit logs one structured entry `{ event: "legacy.uploads.hit", route, userId, organizationId, userAgent }`.
- A module-level counter metric increments per call (whatever metrics client is already in use; if none, add a Pino log line with `deprecatedCall: true`).
- No functional regression — existing integration tests still pass.

### 0.2 Green

1. New middleware `apps/api/src/middleware/deprecation.middleware.ts`:
   ```ts
   export const deprecate = (opts: { sunset: string; successor: string }) =>
     (req: Request, res: Response, next: NextFunction) => {
       res.set({
         Deprecation: "true",
         Sunset: opts.sunset,
         Link: `<${opts.successor}>; rel="successor-version"`,
       });
       logger.warn({ event: "legacy.uploads.hit", route: req.originalUrl, ... }, "legacy endpoint");
       next();
     };
   ```
2. Apply the middleware to all three handlers in `uploads.router.ts`.
3. Commit the sunset date as a module-level constant; it's a single source of truth for every phase that references it. Default: **T + 60 days** from Phase 0 landing.

### 0.3 Refactor

- Add a dashboard query (out of repo) that tracks the counter; link it in the PR description so operators can see usage decay.

### 0.4 Swagger

Update each of the three `@openapi` blocks:

- Add `deprecated: true`.
- Add a `description:` line pointing to the successor endpoint.

Round-trip test (from the parser plan's swagger suite) asserts `deprecated: true` is present on each path in `GET /api/docs/spec`.

---

## Phase 1 — Migrate the sole frontend consumer

**Goal**: no code under `apps/web/src/` imports `sdk.uploads.*`. The `FileUploadConnectorWorkflow` wires its three stubs (`parseFile`, `runInterpret`, `runCommit`) to the new SDK methods. After this phase, the deprecation counter from Phase 0 should drop to zero in staging.

### 1.1 Red — `apps/web/src/workflows/FileUploadConnector/__tests__/FileUploadConnectorWorkflow.integration.test.ts`

- `parseFile(files)` calls `sdk.fileUploads.presignAndUpload(files)` (or whichever helper the new path exposes) and returns a `Workbook`.
- `runInterpret(regions)` calls `sdk.connectorInstanceLayoutPlans.interpret({ workbook, regionHints: regions })`, returns the `LayoutPlan`.
- `runCommit(plan)` calls `sdk.connectorInstanceLayoutPlans.commit(instanceId, planId)`, returns `{ connectorInstanceId }`.
- On commit success, the mutation `onSuccess` invalidates the full query-key set listed in frontend-plan Phase 6 (`connectorInstances.root`, `connectorEntities.root`, `stations.root`, `fieldMappings.root`, `portals.root`, `portalResults.root`, `connectorInstanceLayoutPlans.root`).
- No test or source file under `apps/web/src/` references `sdk.uploads`.

### 1.2 Green

1. Add SDK methods under `apps/web/src/api/sdk.ts` (or wherever the SDK layer lives): `sdk.fileUploads.presignAndUpload`, `sdk.connectorInstanceLayoutPlans.interpret`, `sdk.connectorInstanceLayoutPlans.commit`, `sdk.connectorInstanceLayoutPlans.getCurrent`, `sdk.connectorInstanceLayoutPlans.patch`.
2. Rewrite `apps/web/src/utils/file-upload.util.ts` → `apps/web/src/utils/workbook-upload.util.ts`. Same external signature as the new-path callbacks expect. Delete the old file in this same PR (no compat alias, per the `no_compat_aliases` memory).
3. Replace the TODO stubs in `FileUploadConnectorWorkflow.component.tsx` with the real SDK mutations from `@tanstack/react-query`. Use `toServerError(mutation.error)` for the `serverError` prop, per `CLAUDE.md` §Form & Dialog Pattern.

### 1.3 Refactor

- Confirm the `FileUploadConnectorWorkflow.stories.tsx` `Interactive` story still works with the real SDK stubbed behind MSW or jest mocks — it must remain the reviewer demo for the full flow.

### 1.4 Swagger

No route change; skip.

---

## Phase 2 — Parity proof + monitoring bake

**Goal**: before we turn any legacy endpoint off, prove that every behaviour it handled works on the new path against real fixtures. This phase is a **testing phase only** — no code changes to the legacy path.

### 2.1 Red — `apps/api/src/__tests__/__integration__/routes/connector-instance-layout-plans.router.parity.integration.test.ts`

Each test uploads the exact fixture that the legacy integration suite uses, runs it through the new path, and asserts the resulting `ConnectorEntity` / `FieldMapping` / `entity_records` rows match the legacy path's output field-for-field (modulo columns the new path intentionally adds, like `source_id` derivation via `identityStrategy`).

Cover at minimum:

- Simple CSV, headers in row 1, 3 rows of data → 1 entity, N mappings, 3 records.
- CSV with leading title rows → (legacy path failed silently; new path detects and either succeeds via hints or emits `AMBIGUOUS_HEADER`) — document the behaviour difference explicitly.
- Multi-sheet XLSX → one entity per sheet by default (region hints are one-per-sheet); rows match.
- Non-UTF-8 encoding (Latin-1) → both paths succeed with identical row values.
- Date coercion (Excel serial dates) → identical ISO-8601 strings in `entity_records` JSONB.
- Oversize file → both paths reject with the same HTTP status (`400`), but the error codes differ (`UPLOAD_FILE_TOO_LARGE` vs `LAYOUT_PLAN_INVALID_PAYLOAD`). Document the mapping.
- Duplicate filename in a single upload → same reject behaviour.

### 2.2 Green

- The new path must already handle every case. If any test red-lines, **stop this plan and fix the new path first** — we are not deprecating something better than what replaces it.
- Add any missing error codes to the new path's enum.

### 2.3 Refactor

- Merge the "behaviour differences" list into `docs/SPREADSHEET_PARSING.backend.spec.md` as an explicit migration note (not a new spec section — a paragraph under "Sync integration with FileUploadConnector").

### 2.4 Swagger

No route change; skip.

### 2.5 Bake

Leave Phase 2 merged for at least **two weeks** before proceeding to Phase 3. During that window:

- Dashboard query (from Phase 0) reports zero legacy-endpoint hits from our own frontend.
- Any third-party or internal tooling that still hits the legacy path surfaces in logs; reach out individually before disabling.

Do not skip the bake window even if the dashboard hits zero on day one — some callers run on weekly schedules.

---

## Phase 3 — Feature-flag the legacy path off

**Goal**: the three legacy endpoints respond `410 Gone` by default. A config flag can re-enable them for emergency rollback. Code stays mounted — this is a reversible step.

### 3.1 Red — `apps/api/src/__tests__/__integration__/routes/uploads.router.flag.integration.test.ts`

- With `ENABLE_LEGACY_UPLOAD_FLOW` unset or `false`:
  - `POST /api/uploads/presign` → `410` with `{ code: "UPLOAD_ENDPOINT_SUNSET", message: "Use POST /api/connector-instances/:id/layout-plan/interpret" }`.
  - Same for `/process` and `/confirm`.
  - Deprecation headers from Phase 0 still emitted.
- With `ENABLE_LEGACY_UPLOAD_FLOW=true`:
  - All three handlers execute as before.
  - Existing Phase 0 + legacy integration suites pass.

### 3.2 Green

1. Add the flag to `apps/api/src/environment.ts` (default `false`).
2. Wrap each handler in `uploads.router.ts`:
   ```ts
   if (!environment.ENABLE_LEGACY_UPLOAD_FLOW) {
     return next(new ApiError(410, ApiCode.UPLOAD_ENDPOINT_SUNSET, "..."));
   }
   ```
3. Add `ApiCode.UPLOAD_ENDPOINT_SUNSET`.
4. Flip the flag off in every environment config (`.env.staging`, `.env.prod`) in the same PR — the PR is effectively the disablement event.

### 3.3 Refactor

- Audit operational dashboards for 410s on the legacy paths; they should be zero from our frontend, plus any long-tail of misconfigured external callers.

### 3.4 Swagger

Update each of the three `@openapi` blocks to describe the 410 response.

### 3.5 Bake

Leave the flag off in production for at least **two weeks** before Phase 4. This is the rollback window — if anything breaks, flip the flag, diagnose, then re-disable.

---

## Phase 4 — Delete backend code

**Goal**: remove every file and identifier listed in the deprecation surface. After this phase, there is no `/api/uploads/*` code in the repo and the parser module is the only owner of every concept it introduced.

### 4.1 Red — `apps/api/src/__tests__/audit.legacy-uploads.test.ts`

AST-level audit tests, no runtime behaviour:

- No file under `apps/api/src/` imports from `apps/api/src/services/uploads.service`, `.../csv-import.service`, `.../xlsx-import.service`, `.../file-analysis.service`, `.../queues/processors/file-upload.processor`, or `.../utils/heuristic-analyzer.util`.
- No file under `apps/api/src/` references `ApiCode.UPLOAD_*` (except `UPLOAD_ENDPOINT_SUNSET`, which also disappears at the end of this phase).
- `apps/api/src/routes/uploads.router.ts` does not exist.
- No file under `packages/core/src/` exports `FileParseResultSchema`, `FileUploadRecommendationSchema`, `ColumnStatSchema`, `PresignRequestBodySchema`, `ConfirmRequestBodySchema`, or `ProcessRequestParamsSchema`.
- `JobTypeEnum` does not include `"file_upload"`.

### 4.2 Green

1. Delete the files. In this order so the compiler gives useful errors:
   1. `apps/api/src/queues/processors/file-upload.processor.ts` + its registration in `apps/api/src/queues/processors/index.ts`.
   2. `apps/api/src/services/file-analysis.service.ts`, `uploads.service.ts`, `csv-import.service.ts`, `xlsx-import.service.ts`.
   3. `apps/api/src/utils/csv-parser.util.ts`, `xlsx-parser.util.ts`, `column-stats.util.ts`, `heuristic-analyzer.util.ts`.
   4. `apps/api/src/prompts/file-analysis.prompt.ts`.
   5. `apps/api/src/routes/uploads.router.ts` + its mount point in `apps/api/src/app.ts`.
2. Delete legacy tests: `uploads.router.integration.test.ts`, `uploads.router.deprecation.test.ts`, `uploads.router.flag.integration.test.ts`, `uploads.service.test.ts`, `file-upload.processor.test.ts`, `file-analysis.service.test.ts`, `file-analysis.integration.test.ts`.
3. Delete `packages/core/src/contracts/upload.contract.ts` and remove its re-export from `packages/core/src/contracts/index.ts`.
4. Remove the listed schemas and factory from `packages/core/src/models/job.model.ts`; remove `"file_upload"` from `JobTypeEnum` and `JOB_TYPE_SCHEMAS`.
5. Delete all `ApiCode.UPLOAD_*` entries (including `UPLOAD_ENDPOINT_SUNSET`).
6. Remove the `ENABLE_LEGACY_UPLOAD_FLOW` flag from `environment.ts` and all env files.
7. Remove the deprecation middleware `apps/api/src/middleware/deprecation.middleware.ts` *only* if it has no other callers. If another route uses it, leave it in place (it's general-purpose infrastructure).

### 4.3 Refactor

- Run `npm run lint:fix`; delete any imports the linter flags as unused.
- Confirm `npm run build` is green from a cold cache.
- Verify no dangling references in `apps/api/README.md`; edit in the same PR if any exist.

### 4.4 Swagger

The three `@openapi` blocks disappear with `uploads.router.ts`. The generated spec at `GET /api/docs/spec` no longer lists `/api/uploads/*` — asserted by a test in `apps/api/src/__tests__/swagger.test.ts`:

```ts
it("no longer exposes /api/uploads/* paths", () => {
  const spec = getSwaggerSpec();
  expect(Object.keys(spec.paths)).not.toEqual(
    expect.arrayContaining([expect.stringMatching(/^\/api\/uploads/)])
  );
});
```

---

## Phase 5 — Data & schema hygiene

**Goal**: leftover `jobs` rows from the legacy path don't crash the worker or job-list UI; the `file_upload` kind is no longer reachable in code; no stale Drizzle migration references the legacy path.

### 5.1 Red

`apps/api/src/__tests__/__integration__/jobs.legacy-cleanup.integration.test.ts`:

- Seeded historical `jobs` rows with `type: "file_upload"`:
  - Appear in `GET /api/jobs` with `type: "file_upload"` preserved as a string.
  - The job repository's reader does **not** attempt to parse `metadata` or `result` with the deleted schemas — it returns them as raw JSONB, or an explicit `{ legacy: true }` marker.
  - The BullMQ worker does **not** pick up any queued legacy job (queue drained before Phase 3's flag-off; if any survived, they fail gracefully with `LEGACY_JOB_SKIPPED`).

### 5.2 Green

1. Audit `apps/api/src/services/jobs.service.ts` (or whichever service reads `jobs`): when it encounters `type: "file_upload"`, it returns the row's raw JSONB without parsing. No schema validation, no crash.
2. Drain the BullMQ queue of any pending `file_upload` jobs during the Phase 3 flag-off window; add a one-off migration script under `apps/api/scripts/drain-legacy-upload-jobs.ts` if the queue has long-lived entries.
3. Do **not** delete historical `jobs` rows — they are audit data. A future retention job may purge them; not our concern here.
4. No Drizzle migration edits. The tables are unchanged; only application code changed.

### 5.3 Refactor

- Confirm the job-list UI in `apps/web` renders a "file_upload (legacy)" row type without crashing. If it did crash, it did so before this phase's test went red — the fix belongs in the same PR.

### 5.4 Swagger

No route change; skip.

---

## Phase 6 — Documentation and final sweep

### 6.1 Green

- Update `apps/api/README.md` — remove the section on the legacy upload flow; replace with a one-liner pointing at `SPREADSHEET_PARSING.backend.spec.md`.
- Update `apps/web/README.md` — remove any reference to `sdk.uploads`.
- Update `CLAUDE.md` if it names any deleted file (no known references today, but sweep).
- Close the loop on `docs/XLSX_WORKFLOW.*` and `docs/SYSTEM_COL_DEF.*` — audit for stale references to the legacy flow; prepend a deprecation banner if one exists.
- Archive `docs/FILE_UPLOAD_DEPRECATION.plan.md` (this file) — add a "✅ Completed YYYY-MM-DD" banner at the top and a link to the final PR.

### 6.2 Swagger

Re-run the full swagger round-trip. The spec should:

- Not list `/api/uploads/*`.
- Not list any `FileParseResult*`, `FileUploadRecommendation*`, `Presign*`, `Confirm*`, or `Process*` schemas under `components.schemas`.
- Still list `LayoutPlan`, `Region`, `DriftReport`, etc. from the new path unchanged.

---

## Exit criteria

- `npm run type-check` — clean.
- `npm run test` — every unit suite green.
- `npm --workspace apps/api run test:integration` — every suite green; the audit tests in Phases 4 and 5 enforce that no legacy code or reference remains.
- `GET /api/docs/spec` lists zero `/api/uploads/*` paths; lists zero deleted schemas under `components.schemas`.
- `grep -r "sdk.uploads\|UPLOAD_NO_FILES\|FileParseResult\|FileUploadRecommendation\|PresignRequestBody" apps packages` returns nothing.
- Dashboard query shows zero legacy-endpoint hits across the two-week bake period preceding Phase 4.
- The `file_upload` job kind is removed from `JobTypeEnum`; historical `jobs` rows of that type continue to render in the jobs list without crashing.

## Risks and rollback

- **Third-party caller we didn't know about.** Phase 0's logging surfaces them; Phase 3 gives them a 410 for at least two weeks before deletion. If one shows up after Phase 4, the fix is a hotfix restoring the handler — the git history is the rollback.
- **Historical `jobs` rows misparse.** Phase 5's integration test is the guard. If the test fails in review, the job-list service gains a raw-passthrough code path in the same PR.
- **Someone re-enables the feature flag in prod during Phase 3's bake window.** Add a pager alert on non-zero `legacy.uploads.hit` counts in production; investigate each occurrence before extending the bake.
- **Schema deletion breaks an un-rebuilt consumer.** The `no_compat_aliases` memory prohibits re-export shims. Mitigation: Phase 4's audit test is repo-wide; a consumer outside `apps/*` or `packages/*` (there should be none) is a process gap that the audit won't catch. Communicate deletion via changelog + Slack before Phase 4 merges.
- **Queue drain race.** A legacy `file_upload` job enqueued during Phase 3 but not yet processed may outlive the 410. The drain script in Phase 5 exists for that. Run it as part of the Phase 4 deployment, not before.

## Appendix — ordered PRs

Each PR ends green on `type-check`, `test:unit`, `test:integration`.

1. **PR A — Phase 0**: deprecation middleware, telemetry, sunset headers, Swagger `deprecated: true`. No behaviour removal.
2. **PR B — Phase 1**: frontend cutover. SDK additions for the new path; `sdk.uploads` imports deleted.
3. **PR C — Phase 2**: parity integration tests under `connector-instance-layout-plans.router.parity.integration.test.ts`. No deletions yet.
   - **Bake two weeks.** Do not merge PR D before the bake completes with zero production hits on legacy endpoints.
4. **PR D — Phase 3**: feature flag + 410 default. Flag off in staging + prod in the same PR.
   - **Bake two weeks.** Rollback window.
5. **PR E — Phase 4**: delete backend code, legacy tests, core schemas, API codes, `UPLOAD_ENDPOINT_SUNSET`, and the flag. Largest PR; the audit test enforces completeness.
6. **PR F — Phase 5 + Phase 6**: job-row legacy handling, queue drain script, docs sweep, swagger final verification.
