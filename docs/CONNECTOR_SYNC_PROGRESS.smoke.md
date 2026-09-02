# connector-sync-progress — Smoke Suite

Manual smoke test for [#458](https://github.com/EnterpriseBT/portal-ai/issues/458) — honest connector-sync progress: the asymptotic page curve is gone; syncs report cumulative **records** (with an optional probed total), persisted in `jobs.progress_detail` and rendered as "X of Y records" / "X records so far" across the sync toast, JobDetail, and the jobs list.

**Branch under test:** `fix/connector-sync-progress` (PR [#492](https://github.com/EnterpriseBT/portal-ai/pull/492)).

Run **§Preflight** once. Sections are independent after it. Steps are `/smoke-walk`-eligible unless tagged `— manual`. Filing bugs: template at the bottom.

> Local-env caveat: keep smoke datasets in the hundreds-to-thousands range — the devcontainer suspends after ~15 min idle and nodemon restarts on editor saves, both of which kill long runs with no app error. The honesty of the meter shows at any size.

---

## Preflight

### Environment

- [x] `git checkout fix/connector-sync-progress && git pull --ff-only`
- [x] `npm install && npm run build --workspace=@portalai/core` — `job.model.ts` gained `JobProgressDetailSchema`; api/web need the rebuilt core dist.
- [x] `cd apps/api && npm run db:migrate && cd ../..` — migration `0089_add-progress-detail-and-endpoint-total-count.sql` adds two nullable jsonb columns (`jobs.progress_detail`, `api_endpoint_configs.total_count`). Confirm it applies cleanly.
- [x] `npm run dev` boots cleanly (API `:3001`, web `:3000`); Redis reachable, jobs worker attaches.
- [x] Auth0 dev login lands on the dashboard.

### Fixtures

Both fixtures are public read-only APIs — no credentials.

| Alias | Shape | Used by |
|---|---|---|
| **posts** (unknown total) | REST API connector instance → base URL `https://jsonplaceholder.typicode.com`, endpoint path `/posts`, records path empty, id field `id`, pagination **pageOffset / page style** (`param: _page`, `pageSizeParam: _limit`, `pageSize: 20`, start page 1, stop on short page). ~100 records over 5 pages. **Leave the "Record total" section empty.** | §1, §3, §5 |
| **arcgis** (known total) | REST API connector instance → any public ArcGIS FeatureServer layer, e.g. base URL `https://sampleserver6.arcgisonline.com`, path `/arcgis/rest/services/USA/MapServer/0/query`, query params `where=1=1&outFields=*&f=json`, records path `features`, pagination **pageOffset / offset style** (`param: resultOffset`, `pageSizeParam: resultRecordCount`, `pageSize: 100`, start 0). **Record total section: count query params `returnCountOnly=true`, count response path `count`.** Any layer with a few hundred–few thousand features works. | §2, §3, §4 |

### Reset between runs

- [x] No reset needed — re-running a sync converges on the same records. To watch a fresh meter, just trigger Sync again; to reset fully, delete and recreate the connector instance.
- [x] `cd apps/api && npm run db:studio` — for inspecting `jobs.progress` / `jobs.progress_detail` and `api_endpoint_configs.total_count`.

---

## §1 — Unknown total: count + indeterminate bar, no percent (AC 1)

Against **posts** (no Record total configured):

- [x] Click **Sync** on the connector-instance view. The bottom-right toast shows "Syncing…" with a line like **"20 records so far"** that increases per page (20 → 40 → … → 100), an **indeterminate** (sweeping) bar, and **no percentage anywhere** in the toast while records are flowing.
- [x] In `db:studio` → `jobs` (the `connector_sync` row): mid-run `progress_detail` is `{"processed": <n>, "total": null}` and **`progress` stays `0`** until completion (then `100`). The persisted integer never fabricates a mid-run percent.
- [x] On completion the toast flips to the usual "Sync complete: N added, …" tally.

## §2 — Known total: "X of Y records", 100 only at completion (AC 2)

Against **arcgis** (Record total configured):

- [x] While creating the endpoint, the **"Record total (optional)"** section is present in the endpoint form with the ArcGIS example in its helper copy; saving with count params but an empty response path is blocked with "Count response path is required…". (Covers the new form surface.)
- [x] In `db:studio` → `api_endpoint_configs`: the row's `total_count` column holds `{"queryParams": {"returnCountOnly": "true"}, "responsePath": "count"}`.
- [x] Click **Sync**. The toast shows **"<n> of <total> records"** with a **determinate** bar tracking records; the bar's percent label never reads 100 while records are still flowing (caps at 99), and reaches 100 only when the sync completes.
- [x] The API log shows exactly **one** extra request per sync with `returnCountOnly=true` (the probe), before the data pages.

## §3 — Persistence: reload, JobDetail, jobs list (AC 3)

During (or right after starting) a §1 or §2 sync:

- [x] **Reload the page mid-sync.** The persisted counts survive the reload and are visible on JobDetail / the jobs list (snapshot path). *Amended during the walk:* the instance-view **toast** itself does not resume after a reload (its jobId is component state) — accepted at sign-off; a follow-up ticket may re-add toast re-latching.
- [x] Open **Jobs → the running job (JobDetail)**: the **Progress** metadata row shows the same "X of Y records" / "X records so far" text as the toast, and the bar mode matches (determinate for §2, indeterminate for §1).
- [x] Open the **Jobs list** while the job is active: the job card's bar is determinate-with-percent for §2 and indeterminate for §1.

## §4 — Probe failure is fail-open (AC 4)

- [x] Edit the **arcgis** endpoint's Record total: change the count response path to a nonsense value (e.g. `nope.count`). Sync.
- [x] The sync **starts immediately and completes normally** — same record counts as §2.
- [x] The meter degrades to §1 behavior (records-so-far, indeterminate, no total); the API log carries one `rest-api.sync.count-preflight-failed` warn line and no error.
- [x] Restore the correct path afterward.

## §5 — Multi-endpoint accumulation (AC 5)

- [x] Add a **second endpoint** to the **posts** instance (e.g. path `/comments`, same pageOffset config, ~500 records) — still no Record total on either. Sync.
- [x] The records-so-far count climbs **continuously across both endpoints** (it does not reset to 0 when the second endpoint starts), ending at the combined total. No percent appears at any point (only some/none endpoints could ever report a total).

## §6 — Milestone adapters unchanged (AC 6) — manual

Needs a real Google/Microsoft account + an existing committed sheet/workbook connector; skip if you don't have one wired locally.

- [x] Sync a Google Sheets (or Microsoft Excel) instance: the toast shows the familiar **percent bar stepping through 0 → 10 → 40 → 80 → 95 → 100** — no record counts, no indeterminate bar, behavior identical to before this branch.

## §7 — Other job types' numeric progress still renders (AC 7)

- [x] Run a file upload through the File Upload connector workflow (any sample CSV from the workflow's Sample files panel). The parse step's progress bar advances as a **percent** exactly as before — the worker normalizes numeric progress; nothing regressed for non-sync jobs.

## §8 — Static gates (AC 8)

- [x] `npm run build && npm run type-check && npm run lint` at repo root — clean (also enforced by CI Static Checks on the PR).

## Sign-off

- [x] Every section above verified
- [x] 2026-09-02, Ben Turner — confirmed against my own running stack (agent evidence: `packages/e2e/test-results/smoke-walk-CONNECTOR_SYNC_PROGRESS.md`; manual steps §2-probe-count, §3 indeterminate list card, and §6 sheets/excel walked by hand; toast contrast + width fixes verified in `00f4fee3`/`00c8f241`)

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/job/entity ids):
