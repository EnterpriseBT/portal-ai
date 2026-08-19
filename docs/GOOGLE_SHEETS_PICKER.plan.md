# Google Sheets scope narrowing — Plan

**TDD-sequenced implementation of the move to `drive.file` + the Google Picker: the narrowed scope constant behind an empirical gate, the bounded 404 retry, the Picker util + browser token client, the account-match guard and rewritten step, the end-to-end removal of the `files.list` proxy, and the doc sweep.**

Spec: `docs/GOOGLE_SHEETS_PICKER.spec.md`. Discovery: `docs/GOOGLE_SHEETS_PICKER.discovery.md`. Issue: [#408](https://github.com/EnterpriseBT/portal-ai/issues/408).

Six slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/google-sheets-picker`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd apps/web && npm run test:unit
cd packages/core && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

**Two manual gates interrupt the sequence** (G1, G2 below). They are not commits and not agent work; they are the reason slice 1 is alone at the front.

Sequencing rationale — the risky assumption is validated while the cost of being wrong is one line, and leaf logic precedes wiring:

- **Slice 1** — the scope constant and its tests, nothing else. At this point rollback is a single line, which is exactly the position the spec wants to be in when **G1** runs.
- **G1** — the empirical bridge test in dev: does a grant created **browser-side** survive to a **server-side** read? Discovery's harness supplies the browser half, so this does not wait on the app's Picker; that keeps slice 1 the only landed commit at the moment of truth. **If G1 fails, the ticket stops here** (spec → Risks, row 1).
- **G2** — the dev console scope removal (user action), immediately after G1 so criteria 1–2 become observable for the smoke walk.
- **Slice 2** — `GoogleAuthError.status` + the bounded 404 retry. Pure api, no web dependency, and it wants to exist *before* the real Picker flow is exercised, since non-instant grant propagation is exactly what it absorbs.
- **Slice 3** — the Picker util + token client: leaf browser code with no app wiring, testable against mocks.
- **Slice 4** — the step rewrite + container wiring + account-match guard. First slice where a user can pick a sheet in the app.
- **Slice 5** — delete the proxy end to end (core contract → api route/service → web SDK → the tests covering all four). Deliberately last of the code slices: nothing is deleted until the replacement works.
- **Slice 6** — docs, runbook and copy sweep.

No migration, no schema change, no seed change (spec → Migration, Seed).

---

## Slice 1 — Narrow the requested scope (api)

The one-line contract change plus the tests that pin it. Nothing consumes `drive.file` yet; the app still lists sheets through the Drive proxy on tokens that already hold the broader grant.

**Files**

- Edit: `apps/api/src/services/google-auth.service.ts` — `GOOGLE_OAUTH_SCOPES` becomes `["openid","email",".../drive.file"]`; the doc-comment above it gains the why (all three non-sensitive; adding a sensitive or restricted scope re-introduces verification and the 100-user cap).
- Edit: `apps/api/src/__tests__/services/google-auth.service.test.ts` — invert the existing `"requests both drive.readonly and spreadsheets.readonly scopes"` case (`:70-92`).
- Edit (fixtures only): `apps/api/src/__tests__/services/google-sheets-connector.service.test.ts:386`, `apps/api/src/__tests__/adapters/google-sheets.adapter.test.ts:8`, `apps/api/src/__tests__/__integration__/routes/connector-instance.router.integration.test.ts:1427`, the six `scope:` fixtures in `google-sheets-connector.router.integration.test.ts`, **and `:540`** — corrected during implementation: `:540` sits below the `// ── GET /sheets ──` banner but belongs to `insertGoogleSheetsInstance`, a helper the surviving select-sheet and sheet-slice suites also call, so it is not deleted in slice 5 and does need sweeping here. Six more `scope:` fixtures in `google-auth.service.test.ts` (`:182`-`:304`) turned up in the same grep and were swept with them.

**Steps**

1. **Tests (spec → TDD test plan, `apps/api` › `google-auth.service.test.ts`).** `GOOGLE_OAUTH_SCOPES` equals the three-element list exactly, order-sensitive and exhaustive; it contains neither `drive.readonly` nor `spreadsheets.readonly`, asserted by name; `buildConsentUrl` still sets `include_granted_scopes=true`. Run; fail.
2. **Implement** the constant + comment. Green.
3. **Sweep the scope fixtures** listed above so `grep -rn --exclude-dir=dist "drive.readonly\|spreadsheets.readonly" apps packages` is clean except the `GET /sheets` block awaiting slice 5.
4. `cd apps/api && npm run test:unit && npm run test:integration`; lint + type-check.

**Done when:** the scope cases pass, the api suites are green, and the only remaining old-scope strings are inside code slice 5 deletes.

**Risk:** none in the tree — the risk is entirely in G1 below, which this slice exists to make cheap. **Rollback at this point is reverting one line.**

---

## Gate G1 — prove the browser-grant → server-read bridge (manual, dev)

**Not a commit.** The assumption the whole ticket rests on: a `drive.file` grant created in the *browser* is visible to a read made *server-side* with a token derived from the stored refresh token. Discovery proved the Picker→Sheets read within one browser context; it did not prove the cross-token half.

**Why it runs here and not later:** dev's existing refresh token holds `drive.readonly` and would satisfy any read regardless — a guaranteed false positive. The token must be re-minted under the narrowed scope first, which slice 1 is what enables.

Procedure:

1. Deploy or run slice 1 against dev so `/authorize` requests only the narrowed set. (The dev console still *lists* the old scopes — requesting fewer than configured is allowed, and this is deliberate: the console is untouched until G2 so rollback stays one line.)
2. In the app, reconnect the Google Sheets connector so a **fresh refresh token** is stored carrying `drive.file` only. Confirm on the consent screen that "See all of your Google Drive files" is absent.
3. Using **discovery's Picker harness** (same client id, same `setAppId` project number), pick a spreadsheet the connector has never touched. The harness supplies the browser half without waiting on slice 3 — **confirmed as the approach**, so slice 1 stays alone at the front and rollback stays one line. Serve it with cache-busting or a hard reload: discovery's second false negative was a stale cached page (`python -m http.server` sends no cache headers).
4. Trigger a **real sync** in the app for that instance and confirm the rows land.

**Done when:** the sync reads the harness-picked spreadsheet successfully.

**If it fails:** stop. Revert the one line, and re-open the CASA-vs-Picker decision on #408 (spec → Risks, row 1). Do not proceed to slice 2. A 404 on the *first* read only is not a failure — that is the propagation case slice 2 handles; retry the sync once before concluding.

## Gate G2 — remove the scopes from the dev consent screen (manual, user action)

**Not a commit, not agent work** — user has console access.

- Google Cloud Console → the dev project's OAuth consent screen → remove `drive.readonly` and `spreadsheets.readonly`.
- Same visit: register the app origins as **authorized JavaScript origins** on the OAuth client, which slice 3's token client needs.
- Runs immediately after G1 passes, never before — see spec → *Resolved: GCP consent-screen removal*.

**Done when:** the dev client's configured scope list contains no sensitive or restricted scope, and a fresh connect shows no unverified-app interstitial. This is what makes acceptance criteria 1–2 checkable in the smoke walk.

---

## Slice 2 — `GoogleAuthError.status` + the bounded 404 retry (api)

Absorb non-instant grant propagation at the one place both Sheets reads pass through. Pure api; no web dependency.

**Files**

- Edit: `apps/api/src/services/google-auth.service.ts` — `GoogleAuthError` gains an optional numeric `status`.
- Edit: `apps/api/src/services/google-sheets-connector.service.ts` — `fetchSpreadsheet()` (`:707`) sets `status` at its throw site and retries a 404 once after 1s.
- Edit: `apps/api/src/__tests__/services/google-sheets-connector.service.test.ts` — the retry cases.

**Steps**

1. **Tests (spec → TDD test plan, `google-sheets-connector.service.test.ts` cases 1–4).** A 404 then a 200 → one retry, resolves; a persisting 404 → `502 GOOGLE_SHEETS_FETCH_FAILED` after **exactly two** fetch calls; a 403 → **one** call, asserted on the mock's call count; the same behavior on the `fetchWorkbookForSync` path, not only `selectSheet`. Jest fake timers drive the delay (precedent: `adapters/rest-api/retry.util.test.ts`). Run; fail.
2. **Implement** the `status` field and a local retry inside `fetchSpreadsheet` — the injectable-`wait` shape the rest-api retry util uses, so the test never actually sleeps.
3. `cd apps/api && npm run test:unit`; lint + type-check.

**Done when:** cases 1–4 pass; both call sites inherit the retry; no other behavior changed.

**Risk:** low. Note for review: `adapters/rest-api/retry.util.ts`'s `withRetry` was considered and **not** reused — it is keyed to `ApiError` with `details.status` and maps exhaustion onto `REST_API_*` codes, so adopting it would mean changing what `fetchSpreadsheet` throws. A local ~15-line retry is the smaller change.

---

## Slice 3 — Picker util + browser token client (web)

Leaf browser code. Nothing renders it yet; the step still searches.

**Files**

- New: `apps/web/src/workflows/GoogleSheetsConnector/utils/google-picker.util.ts` — `loadPicker`, `openSheetPicker`, `requestBrowserToken` (signatures in spec → Surface).
- New: `apps/web/src/workflows/GoogleSheetsConnector/__tests__/google-picker.util.test.ts`.
- Edit: `apps/web/.env.example` — the three `VITE_GOOGLE_*` values.
- Edit: `.github/workflows/deploy-dev.yml`, `.github/workflows/deploy-prod.yml` — the three values as `${PREFIX}_VITE_*` secrets alongside the existing `VITE_AUTH0_*` set (`deploy-dev.yml:217-224` is the block).

**Steps**

1. **Tests (spec → TDD test plan, `google-picker.util.test.ts`).** `openSheetPicker` calls `setAppId` — **pinning Key decision 2**, since omitting it fails later as an unrelated-looking 404; resolves `null` on cancel and `{spreadsheetId,name}` on pick; `loadPicker` rejects when the script fails and is idempotent across calls; `requestBrowserToken` requests `openid email .../drive.file` and forwards `loginHint`, and rejects on popup-closed. Mock `window.gapi` / `window.google`. Run; fail.
2. **Implement** the util. Read `import.meta.env` with `?.` per the `contact.util.ts` precedent so jest and non-Vite contexts do not explode — but the env read lives in the **container** (slice 4), not here: this util takes `developerKey` / `appId` / `clientId` as arguments so it stays testable without Vite.
3. `cd apps/web && npm run test:unit`; lint + type-check.

**Done when:** the util's cases pass and nothing imports it yet.

**Risk:** the three GitHub Actions secrets are a **user action** — the workflow edits reference names that must exist before the next dev deploy, or the deployed app renders `pickerUnavailable`. Flagged again in Cross-slice notes.

---

## Slice 4 — Step rewrite + container wiring + account-match guard (web)

First slice where a user picks a spreadsheet in the app. The Drive proxy still exists and is now unused by the UI.

**Files**

- Rewrite: `apps/web/src/workflows/GoogleSheetsConnector/SelectSheetStep.component.tsx` — the props in spec → Surface; `searchFn` and `NO_OPTIONS_LABEL` gone.
- Edit: `apps/web/src/workflows/GoogleSheetsConnector/GoogleSheetsConnectorWorkflow.component.tsx` — read the three env values, wire `onOpenPicker` through `requestBrowserToken` → guard → `openSheetPicker` → the existing `selectSpreadsheet`; drop the `searchSheetsMutate` callback (`:80`, `:274-283`).
- Rewrite: `apps/web/src/workflows/GoogleSheetsConnector/__tests__/SelectSheetStep.test.tsx`.
- New: `apps/web/src/workflows/GoogleSheetsConnector/__tests__/GoogleSheetsConnectorWorkflow.test.tsx` — the guard, which is wiring and so belongs at container level per the Component File Policy.

**Steps**

1. **Step tests (spec → TDD test plan, `SelectSheetStep.test.tsx`, 6 cases).** Renders a choose-a-spreadsheet affordance and calls `onOpenPicker` on click; shows `valueLabel` once selected; `pickerUnavailable` renders a configuration-problem message and **not** the old account-blaming copy; `accountMismatch` renders both addresses and leaves the affordance usable; disabled while `loading`, and disabled while `pickerLoading` **without** the "fetching contents" panel; `FormAlert` present with `serverError`, absent without. Run; fail.
2. **Implement** the pure UI component. Green.
3. **Container tests (spec → TDD test plan, account-match guard, 4 cases).** Matching email opens the Picker; differing email sets `accountMismatch` and `openSheetPicker` is **never called**; comparison is case-insensitive; empty `accountInfo.identity` opens the Picker (fails open). Mock the util module with `jest.unstable_mockModule`. Run; fail.
4. **Implement** the container wiring: `loginHint` from `workflow.accountInfo?.identity`, the case-insensitive comparison, `accountMismatch` state, `valueLabel` from the Picker's `name` (falling back to the title `selectSheet` returns on resume). Green.
5. `cd apps/web && npm run test:unit`; lint + type-check.

**Done when:** all 10 web cases pass; the workflow no longer calls `sdk.googleSheets.searchSheets`, though the endpoint still exists.

**Risk:** the Picker renders its own modal over the stepper — z-index / focus-trap interaction is discovery's open question 4 and is verified in the smoke walk, not by these tests. Copy explaining *why* a Google popup is about to appear belongs in this step (spec → Risks, last-but-two row).

---

## Slice 5 — Delete the `files.list` proxy end to end (core + api + web)

One commit across three packages because the contract removal and its consumers must land together to compile.

**Files**

- Edit: `packages/core/src/contracts/google-sheets.contract.ts` — drop `GoogleSheetsListSheets{RequestQuery,Item,ResponsePayload}` (`:30-55`).
- New: `packages/core/src/__tests__/contracts/google-sheets.contract.test.ts` — there is no contract test for this file today, which is part of why these schemas could rot unnoticed.
- Edit: `apps/api/src/routes/google-sheets-connector.router.ts` — delete the route (`:289-…`), its inline `@openapi` block (`:258`), and the `listSheets_failed` case (`:239`).
- Edit: `apps/api/src/services/google-sheets-connector.service.ts` — delete `listSheets` (`:220`), `DRIVE_FILES_LIST_URL`, `DRIVE_PAGE_SIZE`, `SPREADSHEET_MIME_TYPE`, `escapeForDriveQ`, and the orphaned `ListSheets*` / `DriveFilesListResponse` types.
- Edit: `apps/api/src/services/google-auth.service.ts` — drop `"listSheets_failed"` from `GoogleAuthErrorKind`.
- Edit: `apps/web/src/api/google-sheets.api.ts` — drop `searchSheets` (`:46`) and its now-unused contract imports.
- Delete: the `GET /sheets` block in `apps/api/src/__tests__/__integration__/routes/google-sheets-connector.router.integration.test.ts` (`:506-740`, ~6 cases, including the `:540` fixture); the `searchSheets` describe in `apps/web/src/__tests__/api/google-sheets.api.test.ts` (`:39-89`, 3 cases).
- Edit: `apps/api/src/__tests__/routes/google-sheets-connector.router.test.ts` — assert `GET …/sheets` now 404s.

**Steps**

1. **Tests first (spec → TDD test plan, `packages/core` 3 cases + the api route case).** The core contract test asserts the removed schemas are gone and the surviving Google Sheets contracts still parse; the router test asserts the route 404s. Run; fail.
2. **Delete** in dependency order — contract, then api service/route/error kind, then the web SDK endpoint — and remove the dead test blocks in the same commit.
3. `cd packages/core && npm run test:unit`; `cd apps/api && npm run test:unit && npm run test:integration`; `cd apps/web && npm run test:unit`; lint + type-check across all three.

**Done when:** `GET /api/connectors/google-sheets/sheets` is gone, the grep criterion is clean, and no application code calls the Drive API.

**Risk:** `ApiCode.GOOGLE_SHEETS_LIST_FAILED` **stays** — `mapGoogleAuthError` uses it as its `default:` branch *and* on the non-`GoogleAuthError` 500 fallback (spec → Removed). Deleting it because its name says "list" would break the fallback path; the misleading name is accepted, not an oversight.

---

## Slice 6 — Docs, runbook and copy sweep

Stale docs are a bug in this PR, not a follow-up (`CLAUDE.md` → "Keeping Documentation in Sync with Capabilities").

**Files**

- Edit: `docs/PROD_PROVISIONING.runbook.md` §3 (`:172-176`) — add the Picker API key + the three `VITE_GOOGLE_*` build values and the authorized-JavaScript-origins step; **rewrite the "Publish the consent screen / start the verification submission early" bullet**, which this ticket makes wrong. The replacement **keeps a line saying why there is nothing to submit** — every requested scope is non-sensitive, so no verification, no interstitial, no 100-user cap, and adding a sensitive or restricted scope brings all three back. Stating the reason is the point: a bullet that merely disappears invites the next person to re-add the submission step. Note the open Drive-API question (the Picker may still need the API enabled even though no app code calls it).
- Edit: `apps/web/.env.example` — verify slice 3's entries read correctly in context.
- Check (likely no-ops, confirmed by grep): `glossary.util.ts`, `faq.util.ts`, `getting-started.util.ts` carry no Google-Sheets browsing copy today, and no README or `docs/*.md` outside this ticket's own docs mentions `files.list` or the old scopes. Record the check rather than skipping it.

**Steps**

1. No test step — prose only. The guard is the grep in the acceptance criteria plus a read of the runbook section end to end.
2. `npm run format` at the repo root for any touched non-markdown file; markdown is deliberately unformatted.
3. Full `npm run lint && npm run type-check && npm run test` before handing to `/smoke`.

**Done when:** the runbook's §3 describes the world after this PR, and nothing in the docs tree describes searching Drive from inside the app.

**Risk:** none.

---

## Sequence summary

| # | Lands | Gating check |
|---|---|---|
| 1 | Narrowed `GOOGLE_OAUTH_SCOPES` + exhaustive scope tests + fixture sweep | api unit + integration green; rollback is one line |
| **G1** | *(manual)* browser-grant → server-read proof in dev | A real sync reads a harness-picked spreadsheet. **Failure ends the ticket here** |
| **G2** | *(manual, user)* dev consent screen narrowed + JS origins registered | No sensitive/restricted scope configured; no unverified interstitial |
| 2 | `GoogleAuthError.status` + one-shot 404 retry in `fetchSpreadsheet` | 404-retried / 404-persisting / 403-never / sync-path cases |
| 3 | `google-picker.util.ts` + env plumbing | `setAppId` pinned; cancel/pick/idempotence/token-client cases |
| 4 | Picker step + container wiring + account-match guard | 6 step cases + 4 guard cases; Picker never opens on mismatch |
| 5 | Proxy deleted across core/api/web + dead tests removed | Route 404s; contract test green; grep clean |
| 6 | Runbook + copy sweep | Full lint/type-check/test; no doc describes the old flow |

## Cross-slice notes

- **G1 is a stop-the-line gate, not a checkbox.** Slices 2–6 assume it passed. If it fails, the branch reverts to one line and #408 re-opens the CASA decision.
- **Three user actions** sit outside the commits: the dev console edit (G2), the prod console edit at deploy time, and creating the `${PREFIX}_VITE_GOOGLE_*` GitHub Actions secrets before the next dev deploy. Without the last one the deployed app renders `pickerUnavailable` even though every test is green — the failure is invisible to CI by construction.
- **`include_granted_scopes=true` stays** (spec → Key decision 5). A user who already granted `drive.readonly` re-unions it on re-consent; acceptance criterion 1 therefore describes an account that has never consented before. Worth stating in the smoke doc so the walker doesn't test it with their own already-granted account and record a false failure.
- **`mockDriveFetch` and `insertGoogleSheetsInstance`** (integration suite, `:508` and `:523`) sit under the `GET /sheets` banner but are shared with the select-sheet and sheet-slice suites. Slice 5 deletes the describe block, **not** these helpers, and should move them above the banner and rename `mockDriveFetch` — it mocks Sheets responses in every surviving caller.
- **A flaky integration test exists**: `file-uploads.router.integration.test.ts` failed once during slice 1 on a parse-session assertion and passed on rerun and in isolation. Unrelated to this ticket; do not chase it, but do not read a single red run as this branch's fault either.
- **`packages/core` rebuild:** `apps/api` and `apps/web` type-check against `@portalai/core`'s `dist/`, so rebuild core after slice 5's contract deletion or type-check reports stale errors (`project_stale_core_dist_after_branch_switch`).
- **No cache-invalidation work.** The removed endpoint was an imperative `useAuthMutation` GET with no query key, so nothing in `api/keys.ts` changes.
- **Smoke comes after slice 6** — `/smoke 408` maps the spec's eight acceptance criteria to a walkthrough, including the two (consent-screen contents, no interstitial) that only became observable at G2.

## Next step

Implementation begins on this branch once discovery, spec and plan are confirmed — slice 1 first, tests before code, one commit per slice, with G1 run before anything further lands.
