# Connector Large-Dataset Smoke Suite

Manual smoke test plan covering every connector data-loading, sync, commit, and parsing path against datasets large enough to exercise the chunking, lazy-loading, and bulk-write code that recent refactors landed (`feat/row-async-parser`, `feat/efficient-and-scalable-entity-record-detail-storage`, `feat/edit-layout-plan-flow`).

The suite is structured so each section can run in isolation. Run **§Preflight** once before any other section; the rest can be walked top-to-bottom.

---

## Preflight

### Environment

- [x] `npm run dev` boots cleanly (API on `:3001`, web on `:3000`).
- [x] Postgres has every migration applied (`drizzle/__journal.json` matches the running schema). `npm run db:migrate` from `apps/api` if not.
- [x] Redis is reachable. `REDIS_URL` resolves; `FILE_UPLOAD_CACHE_TTL_SEC` defaults to 1 hour.
- [x] S3 (or local equivalent) is reachable. Uploads PUT and HEAD succeed.
- [x] Auth0 dev tenant is configured. Login flow lands you on `/dashboard`.
- [x] Google OAuth + Microsoft OAuth client IDs/secrets are present in `.env` for the cloud-connector cases.

### Test fixtures

Prepare the following files / spreadsheets in advance — every later section references them by alias:

| Alias | Source | Rows × Cols | Notes |
|---|---|---|---|
| **small-csv** | CSV upload | ~50 × 5 | Sanity baseline; should fit inline preview. |
| **wide-csv** | CSV upload | ~100 × 55 | Trips the `jsonb_build_object` 100-arg cap on the wide-table path if the fix regresses. |
| **large-csv** | CSV upload | ~30,000 × 20 | Exercises chunked parse, lazy loadRange in commit, big bulk upsert. |
| **xlsx-multi-sheet** | XLSX upload | 3 sheets, ~5000 × 15 each | Exercises ExcelJS streaming + multi-sheet preview. |
| **xlsx-with-dates** | XLSX upload | ~200 × 10 with a column of native Excel dates | Regression for the postgres-js Date binding bug. |
| **gsheets-large** | Google Sheets | ~2700 × 60, includes datetime cells, sparse cells, some duplicates in identity column | The exact shape that surfaced the four hotfixes during slice 6 smoke. |
| **excel-365-cloud** | Microsoft 365 Excel via OAuth | ~3000 × 25 | Same shape considerations as gsheets-large. |

Login as **two** distinct dev users in separate orgs before starting — the cross-org assertions in §6 need both.

### Reset between runs

- [x] Drop pending / stuck connector instances from a prior run before re-uploading the same fixture: detail view → kebab → Delete. (Stuck `pending` instances will fail the lock-state assertions if left.)
- [x] If a test run wedges, the database is in a recoverable state; do not blow away the org unless asked.

---

## §1 — File-Upload pipeline

### 1.1 Upload + parse (small-csv)

- [x] Connectors → New → File Upload → drop **small-csv** → upload completes (progress bar reaches 100% in <2s).
- [x] Parse job enqueues; the progress bar transitions from "Uploading…" through "Parsing…" to "Ready" via SSE (no polling).
- [x] Preview cells render inline — every cell visible, no `…` truncation.
- [x] Network tab shows **one** `parse` POST returning 202 with a `jobId`, and **one** SSE stream that completes.
- [x] `file_uploads` row exists in Postgres with `status='parsed'` and `uploadSessionId` set.

### 1.2 Upload + parse (large-csv, 30k rows)

- [x] Drop **large-csv** → upload bar reaches 100% (typically <10s on local Redis/S3).
- [x] Parse SSE shows incremental progress jumps; the bar must not stall at 0% or 100% for more than ~5s at a stretch.
- [x] Preview returns with `sliced: true` and `cells: []` for the big sheet (server inlined nothing past `FILE_UPLOAD_INLINE_CELLS_MAX`).
- [x] Region editor renders the visible viewport via on-demand slice loads (Network tab: `sheet-slice` requests fire as you scroll). **Each slice should return in <300ms locally.**
- [x] Redis has `upload-session:<id>:meta` + `upload-session:<id>:sheet:<sid>:rows:<chunkIdx>` keys. `ROWS_PER_CHUNK` defaults to 1000, so a 30k-row sheet has 30 chunks.

### 1.3 Upload + parse (wide-csv, 55 cols)

- [x] Drop **wide-csv** → parse completes.
- [x] Reach the review step → click Commit.
- [x] **Regression for #61**: the layout-plan-commit job succeeds. The wide table `er__<id>` is created with 55 `c_*` columns. `entity_records` count == 100.
- [x] Visit the connector entity's records page → first page (10 rows) loads with no error. **If you see "Failed query: … jsonb_build_object … cannot pass more than 100 arguments" the chunking regressed.**

### 1.4 Upload + parse (xlsx-with-dates)

- [x] Upload **xlsx-with-dates** → parse → reach review.
- [x] Commit succeeds.
- [x] **Regression for #61's sibling Date-binding fix**: the connector entity's records page renders. **If you see "ERR_INVALID_ARG_TYPE: Received an instance of Date" or "Failed query: … with `Mon Aug 11 …` in params" the Date coercion in `wide-table.repository.ts` regressed.**
- [x] Spot-check a date cell on the records page — it should display the ISO 8601 string (not a locale-formatted string).

### 1.5 Multi-sheet XLSX (xlsx-multi-sheet)

- [x] Upload **xlsx-multi-sheet** → parse.
- [x] Region editor's sheet tabs show all 3 sheets.
- [x] Switching tabs renders each sheet's preview without re-fetching (active sheet's cells are cached locally).
- [x] Region drawing on each sheet is independent — drawing on Sheet B doesn't move the region on Sheet A.
- [x] Commit succeeds; 3 wide tables (one per sheet's entity definition) exist.

### 1.6 Cache miss + S3 fallback

- [x] After a successful parse, manually expire the Redis cache (`FLUSHDB` for an isolated dev cluster, or `DEL upload-session:<id>:meta` for one session).
- [x] Trigger Interpret again (kicks `resolveWorkbook`).
- [x] Server logs show `upload.cache.miss` + the re-stream from S3; interpret completes successfully.

### 1.7 Source removed (`editable: false` branch)

- [x] After a successful commit, hard-delete the `file_uploads` rows for the upload session via `DELETE FROM file_uploads WHERE upload_session_id = '<sid>'`.
- [x] On the connector detail page, click the kebab → **Modify Layout Plan**.
- [x] Edit view shows the SOURCE_REMOVED notice with the re-upload link. **No editor renders; no 500.**

---

## §2 — Google Sheets connector

### 2.1 OAuth connect + sheet selection

- [x] Connectors → New → Google Sheets → OAuth popup completes → returns with a pending connector_instance row.
- [x] Sheet picker lists every spreadsheet the connected account has access to.
- [x] Select **gsheets-large** → Select-sheet completes → workbook lands in `connector:wb:google-sheets:<id>` Redis prefix.

### 2.2 Interpret + Commit (gsheets-large)

- [x] Interpret runs against the cached workbook; preview shows the sheet shape (2700 × 60).
- [x] **Regression check**: the plan defaults to `identityStrategy: { kind: "column", col: 1 }` for the first column. **If column 1 has duplicates or blanks past the declared bounds, the drift gate (`LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED`) will halt commit on the initial attempt.** This is the expected drift-gate behavior. To proceed, either:
  - Pick a cleaner identity column via the editor's Identity panel, OR
  - Switch to `rowPosition` identity (no source data dependency).
- [x] Commit succeeds after the identity fix. Records land in `entity_records` + wide-table.
- [x] Detail view flips from `pending` to `active`. Running-job alert clears via SSE.

### 2.3 Recovery from drift failure (PR #60 regression)

- [x] On a clean Google Sheets instance, commit with the bad column-1 identity strategy → SSE delivers `LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED`.
- [ ] **Regression for #60**: the connector instance status flips to `error` (not stuck `pending`), `lastErrorMessage` carries the drift message, and **the plan row survives** (the user can recover via Modify Layout Plan).
- [ ] **Chip-refresh regression**: stay on `/connectors/<id>` from the moment Commit was clicked. The chip is `Pending` while the job runs; within ~2s of the SSE terminal `failed` event landing, the chip flips to `Error` **without a manual refresh or navigation away**. The error banner shows the drift message. (If the chip stays `Pending` until you reload, the workflow's terminal-event invalidation regressed — see commits `fec6ce1` and `90c3311`.)
- [ ] **Single-attempt regression**: in the `jobs` table for the failed commit, `maxAttempts = 1`. The Bull queue only attempted once. (If you see >1 transition to `failed` in the SSE stream or the worker logs, the `MAX_ATTEMPTS_BY_TYPE` override regressed.)
- [ ] Click Modify Layout Plan → editor mounts with the original plan loaded → switch identity strategy → Commit.
- [ ] Second commit succeeds. Detail view returns to `active`.

### 2.4 Sync (cloud connectors only)

- [ ] On the now-active gsheets-large connector, modify a few cells in the upstream Google Sheet (add a row, change a Model name, blank out one value).
- [ ] Click Sync from the detail page.
- [ ] SSE progress: 0 → 10 → 40 → ~80 (per-chunk write progress) → 100.
- [ ] **Regression for #61**: sync passes 40% without `ERR_INVALID_ARG_TYPE` (the Date-binding bug surfaced exactly at the commit phase boundary).
- [ ] Records reflect the upstream changes: the new row appears, the modified row's `data` is updated, the blanked-out row is either soft-deleted (if blanked beyond the terminator) or has the field cleared.
- [ ] Watermark reaper: rows whose `syncedAt` predates the run watermark and weren't touched are soft-deleted; cross-check `entity_records` count drops accordingly.

### 2.4.1 Sync halts on identity drift (regression for the split drift gate)

- [ ] On an active gsheets-large connector with **column** identity (e.g. `Model` as the identity column), manually edit the upstream sheet so the identity column would derive different `source_id`s (add blanks/duplicates within the bounds, or rename the column so the locator no longer resolves).
- [ ] Trigger Sync.
- [ ] **Expected**: sync fails with `LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED`. The connector_sync job ends in `failed` status with the drift error in `error`. **Sync does not silently absorb identity drift** — that path was closed because changing the `source_id` derivation collapses or splits records under the user.
- [ ] Severity-level drift (header rename of a non-identity column, an added column, a removed non-identity column) **still** lets sync proceed — the bypass only applies to non-identity drift. Verify with a header-only mutation on a non-identity column; sync should complete and update records normally.
- [ ] Recovery: Modify Layout Plan → switch to `rowPosition` identity (or pick a stable identity column) → Commit → re-run Sync. Sync now succeeds.

### 2.5 Token-refresh / reconnect path

- [ ] Manually revoke the access token (Google account console → Connected apps → Remove).
- [ ] Trigger Sync.
- [ ] SSE delivers the auth error. Detail view flips to `error` status with the inline Reconnect CTA.
- [ ] Click Reconnect → OAuth popup → token refreshes → connector returns to `active`.

### 2.6 Cache TTL expiry mid-edit

- [ ] After a clean commit, wait or manually invalidate the Redis cache (`DEL connector:wb:google-sheets:<id>:*`).
- [ ] Open the editor via Modify Layout Plan.
- [ ] **Expected**: the edit-context endpoint returns 404 with the "cache not populated" hint. The view shows the load-error branch with a Back button. **There is no S3 fallback for cloud connectors** — the user must re-run select-sheet to repopulate the cache.

---

## §3 — Microsoft 365 Excel connector

Mirror §2 against **excel-365-cloud**. The pipeline is structurally identical; differences worth calling out:

- [ ] Microsoft's OAuth popup uses a different redirect dance — verify it completes without the popup getting orphaned.
- [ ] `fetchWorkbookForSync` parses XLSX via ExcelJS streaming into a throwaway chunked cache (the lazy-workbook path). Confirm Redis has `connector:wb:microsoft-excel:<id>:rows:*` chunks during a sync run.
- [ ] Merged cells: if the test workbook has any, the merges side-table is populated. Verify the editor renders the merged region as a single cell (not 4 separate cells).

---

## §4 — Edit Layout Plan flow (PR #58, slices 1–6 + 3b + 3c)

### 4.1 Entry point gating

- [ ] On a `file-upload` / `google-sheets` / `microsoft-excel` connector that's active and not locked → kebab shows **Modify Layout Plan** enabled (`ViewQuiltIcon`).
- [ ] On a connector with a running `layout_plan_commit` or `connector_sync` job → menu item is disabled; hover reveals "A {job} is running on this connector — try again when it finishes."
- [ ] On a `sandbox` (or any other) slug → menu item is disabled with "Layout plan editing isn't supported for this connector type."

### 4.2 Route + breadcrumb

- [ ] Click Modify Layout Plan → URL changes to `/connectors/<id>/layout-plan/edit` → editor mounts.
- [ ] Breadcrumb reads: Dashboard → Connectors → \<connector name\> → Modify Layout Plan. Each crumb except the last navigates back when clicked.
- [ ] Padding around the page matches the rest of the app (no double-margin, no edge-flush content). Compare side-by-side with the EntityDetail view.

### 4.3 Editor mounted with real data

- [ ] Region overlays render against the seeded preview. The persisted plan's regions are visible and selectable.
- [ ] **First region auto-selected on mount**: the configuration panel opens with the first sheet's first region pre-selected (Label, Target Entity, identity, etc. all populated) — NOT the empty "no region selected" state. If the panel is blank after mount, the auto-select in the hydration effect regressed.
- [ ] **Label + entity round-trip from the committed plan**: for each persisted region, the Label TextField shows either the entity's catalog label (post-successful-commit) or the `targetEntityDefinitionId` key the user typed in the workflow (when the catalog is empty because commit failed). NEVER "New region" / empty Label on a persisted plan.
- [ ] **Identity panel shows the locked locator**: if the plan persisted a `column`-kind identity, the "Identity field" Select shows the picked column's header text (not blank). If it's `rowPosition`, the panel renders the position-based option as selected.
- [ ] Entity picker shows real options (sheet-derived). Stage a new entity via "+ Create new entity" → it appears in subsequent picker dropdowns.
- [ ] For **gsheets-large** specifically, off-screen rows resolve via `loadSlice` — scroll past row 30 (the inline preview cap), confirm new sheet-slice requests fire and the canvas renders the freshly-loaded cells.
- [ ] **Interpret button** — clicking "Interpret" on the draw-regions step advances to the Review step (it does NOT re-run the AI pipeline; the plan is already classified). If the click looks like a no-op, `onAdvanceToReview` is no longer wired.
- [ ] **Back to regions** — on the Review step, clicking "Back to regions" returns to the draw-regions step (step 0). It does NOT navigate out of the edit view (the breadcrumb does that). If clicking it lands you back on `/connectors/<id>`, `handleBack` regressed.

### 4.4 Save Draft (slice 3b)

- [ ] Make an editor mutation (e.g. exclude a binding, change identity strategy) → click **Save draft** (top-right of the page header).
- [ ] Network: a single PATCH to `/api/connector-instances/<id>/layout-plan/<planId>` returning 200.
- [ ] Snackbar appears (bottom-right): "Plan saved." (auto-dismisses in 4s).
- [ ] Reload the page. The edit-context query returns the patched plan; the editor re-mounts with the saved changes intact.
- [ ] **Failure path**: edit a region down to no `targetEntityDefinitionId` (drag to a fresh, unbound region) → Save draft → red toast with "no target entity" message. No network request fires.

### 4.5 Recommit (slice 3 / case 12)

- [ ] On the editor's review step, click Commit.
- [ ] 202 lands; navigate auto-jumps to `/connectors/<id>` with a running-job alert visible.
- [ ] SSE terminal event clears the alert; records reflect the recommitted plan.

### 4.6 Inline error on bad commit (slice 3 / case 14)

- [ ] On a plan with a blocker warning (e.g. a pivot region with no `axisName`), click Commit.
- [ ] The route's 409 surfaces as an inline FormAlert above the editor.
- [ ] Editor stays mounted. Commit button is re-enabled after the alert renders.

---

## §5 — Concurrent operations + lock states

The `JobLockService` 409 ENTITY_LOCKED_BY_JOB convention applies to every connector. Verify the gate holds:

- [ ] Trigger a long-running job (commit a large CSV, or sync gsheets-large). While it's `pending` / `active`:
  - [ ] Sync button is disabled with tooltip pointing at the running job.
  - [ ] Modify Layout Plan menu item is disabled with the same tooltip.
  - [ ] Edit (rename) dialog's Save is disabled.
  - [ ] Delete is disabled.
- [ ] Wait for the job to terminate. All four affordances re-enable within ~2s of the SSE terminal event (no manual refresh required).
- [ ] Open a second browser tab on the same connector while a job is running. Both tabs reflect the lock state. The SSE event clears the lock simultaneously on both.

---

## §6 — Org isolation + auth

- [ ] As user-A in org-A, commit a plan → record id `R1`. Sign out.
- [ ] Sign in as user-B in org-B. Visit `/api/connector-instances/<orgA-instance-id>/layout-plan/edit-context` directly via curl with B's bearer token. **Expect 404** `LAYOUT_PLAN_CONNECTOR_INSTANCE_NOT_FOUND`.
- [ ] Same test against the edit route in the browser. **Expect** a 404 page or empty editor (no leakage of A's plan / preview cells).
- [ ] Same test for the layout-plan PATCH and recommit POST. Both should 404 (not 403 — we hide existence of cross-org instances).

---

## §7 — Specific regression checks (hotfix watchlist)

These are tight repro paths for the bugs landed during this branch's smoke. If a future change breaks any of them, the gates should fire here first.

### 7.1 `jsonb_build_object` 100-arg cap (PR #59)

- [ ] Walk §1.3 (wide-csv, 55 cols). Records page must render without "cannot pass more than 100 arguments to a function".

### 7.2 Existing-instance rollback keeps plan + flips to `error` (PR #60)

- [ ] Walk §2.3. After the drift failure, confirm:
  - `connector_instances.status = 'error'` (not `pending`).
  - `connector_instances.last_error_message` carries the drift reason.
  - `connector_instance_layout_plans` row for the failed planId still exists (live, not soft-deleted).
  - Modify Layout Plan opens the plan; recommit after fix succeeds.

### 7.3 Wide-table Date binding (PR #61)

- [ ] Walk §1.4 (xlsx-with-dates) and §2.4 (gsheets-large sync). Neither path may throw `ERR_INVALID_ARG_TYPE: Received an instance of Date` nor land a locale-formatted date string in any wide-table column. Spot-check `c_publication_date` / `c_last_modified` rows; values should be ISO 8601.

### 7.4 Row-async parser memory ceiling

- [ ] During §1.2 (large-csv 30k rows) and §2.2 (gsheets-large), observe the API process's RSS (`ps -o rss <pid>` or `docker stats`). Peak should stay under ~400 MB.  The lazy fetcher caps each `loadRange` to the region bounds or a windowed scan — full-workbook materialization in V8 heap is a regression.

### 7.5 SSE doesn't drop terminal events under retries

- [ ] Force a parse or sync job to retry (kill the worker mid-job; Bull's `attempts: 3` retries for `file_upload_parse` and `connector_sync`). The job's `error` text in the DB should reflect the underlying failure, **not** a misleading `LAYOUT_PLAN_CONNECTOR_INSTANCE_NOT_FOUND` from a rollback-induced retry (the symptom that originally landed on this branch and was reverted; if it returns, retries are masking real errors again).
- [ ] `layout_plan_commit` is exempt — it's pinned to `attempts: 1` via `MAX_ATTEMPTS_BY_TYPE` in `apps/api/src/services/jobs.service.ts`. Retrying a commit failure is meaningless (drift, blocker warnings, and validation errors are deterministic) and used to confuse the client: the worker would emit a `failed` SSE event per attempt, the frontend would treat the first as terminal, and the eventual rollback on the final attempt would reach no listener. **Verify**: in the `jobs` table, every `layout_plan_commit` row has `maxAttempts = 1`. Every other job type still has `maxAttempts = 3`.

### 7.6 Detail-view caches refresh on terminal SSE event

The connector-instance detail view subscribes to SSE for every running job and invalidates its query caches on the terminal event — success, failure, or cancellation. The invalidation block in `ConnectorInstance.view.tsx`'s `.finally` hook covers FIVE query roots: `connectorInstances.runningJobs`, `connectorInstances.get`, `connectorInstances.root`, `connectorEntities.root`, and `entityRecords.root`. Each addresses a distinct piece of stale state. Walk every path:

- [ ] **Status chip — workflow path**: walk through the gsheets-large or file-upload workflow to the Commit step. From the moment you click Commit, stay on the connector detail page (don't navigate away). Wait for the job to terminate (success or failure). The chip transitions from `Pending` → final status within ~2s of the terminal event — **no manual refresh required**. (If the chip sticks at `Pending` until you reload, the workflow's `awaitJobCompletion(...).finally(invalidate)` regressed.)
- [ ] **Status chip — detail-view path**: trigger a sync from the connector detail page. While the sync runs (chip says `Pending`, lock alert visible), do NOT leave the page. When the sync's SSE terminal event lands, the chip flips to `Active` (success) or `Error` (failure) **without a manual refresh**, and the lock alert disappears. (If the chip stays `Pending` after the alert clears, the SSE-driven invalidation in `ConnectorInstance.view.tsx` regressed.)
- [ ] **Entities table — first commit**: on a brand-new connector, walk through a workflow to its first successful Commit. Stay on `/connectors/<id>` for the duration. When the commit's terminal event lands, the **entities table populates without a reload** — each region's `connector_entities` row appears with its row count. (If the table stays empty until you reload, `queryKeys.connectorEntities.root` is no longer in the `.finally` block.)
- [ ] **Entities table — sync that adds an entity**: edit the plan to add a new region targeting a new entity → Commit → kick off a Sync (or wait for the next scheduled one). When the sync terminates, the new entity row appears in the table within ~2s of the SSE terminal event.
- [ ] **Records page — sync that changes records**: drill into an entity's records page. In another tab (or directly in the source spreadsheet), trigger a Sync that changes / adds / removes rows. When the sync terminates, the records page refreshes without a reload — counts update, new rows appear, soft-deleted rows disappear. (If the page shows stale rows until you reload, `queryKeys.entityRecords.root` is no longer in the `.finally` block.)

### 7.7 Identity drift gate fires on sync, not just commit

Identity drift (`drift.identityChanging === true`) is special: it changes the `source_id` derivation and silently corrupts upserts. The gate runs unconditionally on every commit AND every sync — sync's `skipDriftGate: true` flag only bypasses the severity gates (blocker / warn), not the identity gate.

- [ ] Walk §2.4.1. Sync against a workbook with identity-changing drift must fail with `LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED`. If sync silently proceeds and writes records under a shifted `source_id`, the gate-split in `LayoutPlanCommitService.commit` regressed.
- [ ] As a sanity check on the inverse: sync against a workbook with **non-identity** drift (e.g. add a column, rename a non-identity header) must STILL succeed — sync existing to absorb non-identity drift is the whole point of `skipDriftGate`. Records reflect the new column or header.

---

## §8 — Performance budgets (informational, not hard pass/fail)

Useful baselines from the local docker-compose setup. Significant deviation indicates a regression somewhere in the pipeline.

| Scenario | Wall-clock target |
|---|---|
| Parse 30k × 20 CSV | ≤ 10s |
| Interpret 2700 × 60 sheet | ≤ 15s (LLM-bound — varies with model) |
| Commit 30k × 20 plan, no drift | ≤ 25s |
| Commit 2700 × 60 plan, no drift | ≤ 10s |
| Sync 2700 × 60 sheet, no changes | ≤ 8s (no upserts fire) |
| Sync 2700 × 60 sheet, 100 row changes | ≤ 12s |
| Records page first 10 rows, 55-col wide table | ≤ 500ms |

---

## §9 — What to do when something fails

1. **Capture the failing job's row from `jobs`** — `id`, `error`, full `metadata`. The metadata is JSON and is the single most useful artifact for diagnosing commit / sync failures.
2. **Capture the API server's stderr** around the failure timestamp. Postgres-side errors carry the full SQL + bind params; client-side errors carry the stack.
3. **Note the connector slug and the source-data shape** (row count, column count, presence of dates / blanks / duplicates in the identity column). All three hotfixes on this branch were dimension-specific (`>50 cols`, `Date instances`, `existing-instance + drift`).
4. **Do NOT delete the failed connector instance before triaging.** PR #60's hotfix keeps the plan around precisely so this kind of post-mortem is possible. Recover via Modify Layout Plan once the cause is understood.

---

## Cross-references

- `docs/EDIT_LAYOUT_PLAN_FLOW.spec.md` — Edit-layout-plan feature spec (PR #58).
- `docs/SPREADSHEET_PARSER_ROW_ASYNC.spec.md` — Row-async parser refactor (memory ceiling rationale).
- `docs/ENTITY_RECORDS_WIDE_TABLE_PHASE_2.spec.md` — Wide-table phase 2 (the `er__<id>` per-entity tables this suite exercises).
- `docs/LARGE_FILE_PARSE_STREAMING.plan.md` — Chunked workbook cache layout.
- `CLAUDE.md` §"Async Job State & Data Locking" — lock-state semantics §5 exercises.
