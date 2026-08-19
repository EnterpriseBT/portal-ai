# Google Sheets scope narrowing — Spec

Pins the contract for replacing the Drive `files.list` search box with the Google Picker and dropping to non-sensitive OAuth scopes. Discovery: `docs/GOOGLE_SHEETS_PICKER.discovery.md`. Issue: [#408](https://github.com/EnterpriseBT/portal-ai/issues/408).

## Key decisions (flag for review)

1. **The scope list becomes `openid`, `email`, `drive.file` — nothing else.** Both `drive.readonly` (restricted) and `spreadsheets.readonly` (sensitive) are removed. Every remaining scope is non-sensitive, so **Google verification is not required at all**: no CASA fee, no unverified interstitial, no 100-user cap, nothing to renew. Proven empirically in discovery, with a control.
2. **`PickerBuilder.setAppId(<cloud project number>)` is mandatory.** Without it no per-file grant is created and the Sheets API answers **404 "Requested entity was not found"** — not 403 — so a missing grant is indistinguishable from a rejected scope. A test pins it.
3. **⚠️ Slice 1 gates everything on an unvalidated assumption** — see *Risks*. The Picker grant is created **browser-side**; the sync reads **server-side** with a different token. The design assumes a `drive.file` grant is recorded per *user per app*, not per token. Nothing is deleted until that is demonstrated.
4. **A 404 on the first Sheets read after a pick is retryable — precautionary, not observed.** Discovery's passing run differed from the failing one in two ways, so non-instant grant propagation could not be excluded. **G1 then read a browser-granted spreadsheet server-side on the first attempt**, so no propagation delay has ever actually been seen. The retry still ships: it is one bounded retry on a path where the expensive failure is a dead sync job, and the residual doubt is unresolved rather than disproven. It is insurance against an unobserved case, and the plan says so where it lands.
5. **One-time reconnect, no dual-scope path.** Existing instances keep working on their broader grant until revoked, then use the `status="error"` reconnect that already exists (`google-auth.service.ts:182-191`). Note `include_granted_scopes=true` means a user who *already* granted `drive.readonly` and later re-consents gets it unioned back into the new grant — acceptance criterion 1 therefore describes a genuinely new user. This costs nothing on verification (that keys off the client's configured scopes, not a given user's grant) and is the price of criterion 6.
6. **The Picker's token is minted in the browser (GIS token client), guarded by an account match.** `google.accounts.oauth2.initTokenClient` mints a `drive.file` token client-side; the server-issued-token alternative was rejected. It looked safer — no account chooser — but the Picker's file list is rendered by Google-hosted UI keyed to the **browser's** Google session, so an account mismatch is possible either way; a server token merely makes it *undetectable*, and would additionally require a new route handing a live Google access token to the browser, unvalidated by discovery's harness. The browser flow keeps the mismatch detectable, which is what the guard below is for. The cost, accepted: users see a Google authorization popup inside the workflow they did not see before.
7. **A mismatched Google account is caught at pick time, not at sync time.** The connector instance is bound to one Google account; picking a file while signed into a different one creates a grant the server's refresh token cannot see, and the symptom is a 404 at sync — the exact failure discovery spent two false negatives chasing. The container therefore steers with `hint` and verifies with `userinfo` before the Picker opens (see *Account-match guard*).

## Resolved: GCP consent-screen removal

Verification and the 100-user cap key off the scopes **configured on the OAuth client**, not the ones a given authorize request sends. Editing `GOOGLE_OAUTH_SCOPES` alone leaves the client still declaring `drive.readonly` / `spreadsheets.readonly`, so acceptance criteria 1-2 can pass in code and fail in the console.

- **Performed by the user** (console access confirmed), as a marked user action in the plan — not agent work, and not file-backed.
- **Dev: immediately after slice 1 passes.** Not before — slice 1's rollback is one line only while the console is untouched. Immediately after, because criteria 1-2 are not observable until the console matches, so the dev smoke walk cannot honestly check them otherwise.
- **Prod: at deploy.** Neither client has been submitted for verification, so this is a plain scope edit on both — nothing to withdraw, no review state to disturb.
- Existing grants are not revoked by a consent-screen edit; that is criterion 6 and is confirmed in the smoke walk rather than asserted here.

## Scope

### In scope

- The scope list in `google-auth.service.ts`.
- The **matching scope removal on the GCP OAuth consent screen**, dev and prod (see *Resolved: GCP consent-screen removal*) — the code change is inert without it.
- A Picker-based `SelectSheetStep`, and the build-time browser API key it needs.
- Removal of the `files.list` proxy: route, service method, contracts, SDK endpoint, and the tests covering all four.
- Doc surfaces that describe the old behavior.

### Out of scope

- **BYO per-org Google OAuth credentials** (PRD answer). The scope list stays a single exported constant, so a future per-org client has one place to vary.
- The Auth0 Google **login** connection — different GCP project, login-only scopes.
- Microsoft/Excel connector scopes.
- Backfilling or proactively migrating existing instances.

## Surface

### `apps/api/src/services/google-auth.service.ts`

```ts
export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive.file",
] as const;
```

`drive.readonly` and `spreadsheets.readonly` are **removed**. `include_granted_scopes=true` (`:109`) **stays** — it is what lets an existing instance's broader grant survive until the user reconnects.

The doc-comment above the constant gains: why the set is exactly this, that all three are non-sensitive, and that adding a sensitive or restricted scope re-introduces verification and the 100-user cap. That comment is the guard rail against a future "just add `drive.readonly`, it's easier" change.

### `apps/web/src/workflows/GoogleSheetsConnector/SelectSheetStep.component.tsx`

Props change. `searchFn` is removed; the component no longer searches.

```ts
export interface SelectSheetStepUIProps {
  /** Currently selected spreadsheetId, or null. */
  value: string | null;
  /** The picked spreadsheet's name, for display once chosen. */
  valueLabel: string | null;
  /** Opens the Google Picker. Resolves when the user picks or cancels. */
  onOpenPicker: () => void;
  /** True while the Picker script is loading — the affordance is disabled, no progress copy. */
  pickerLoading: boolean;
  /** True while the select-sheet POST is in flight — renders the "fetching contents" panel. */
  loading: boolean;
  /** Picker could not load (blocked script, missing key) — distinct from "no selection". */
  pickerUnavailable: boolean;
  /**
   * Set when the Google account authorized in the popup is not the account
   * this connector is bound to. Blocks the Picker; names both addresses.
   */
  accountMismatch: { expected: string; authorized: string } | null;
  serverError: ServerError | null;
}
```

Two loading flags, not one: today's panel copy is *"Fetching spreadsheet contents… streaming rows into the workbook cache"*, which is wrong for a script load and would be shown for it under a single flag.

`valueLabel` is sourced by the container: the Picker's `name` on a fresh pick, `instance.config.title` (already returned by `selectSheet`) when the workflow resumes on an instance that has a selection.

It stays a **single pure UI component** per the Component File Policy — props only, no SDK, no `import.meta.env`. The Picker itself is wired by the container.

`NO_OPTIONS_LABEL` is **deleted**. Its text — *"No spreadsheets found — make sure the right Google account is connected."* — blames the user's Google account, and with the Picker there is no search to come back empty. When `pickerUnavailable` is true the step says the picker could not load and names it as a configuration problem, not a user problem.

### New: `apps/web/src/workflows/GoogleSheetsConnector/utils/google-picker.util.ts`

```ts
export interface PickedSheet {
  spreadsheetId: string;
  name: string;
}

/** Loads `gapi` + the picker module once, idempotently. Rejects if the script cannot load. */
export function loadPicker(): Promise<void>;

/**
 * Opens the Picker and resolves with the selection, or `null` on cancel.
 * `appId` is REQUIRED — without it no per-file drive.file grant is created and
 * the later Sheets read fails as a 404 (see Key decision 2).
 */
export function openSheetPicker(args: {
  oauthToken: string;
  developerKey: string;
  appId: string;
}): Promise<PickedSheet | null>;
```

The `oauthToken` argument is an input, not something `openSheetPicker` mints — the token comes from the token client below, so the Picker util stays a thin wrapper over `PickerBuilder`.

```ts
export interface BrowserToken {
  accessToken: string;
  /** Resolved from userinfo — the account the user actually authorized. */
  email: string;
}

/**
 * Mints a browser-side token via GIS. `loginHint` pre-selects the connector's
 * Google account in the chooser; it is a nudge, not a constraint, which is why
 * the caller must still compare `email` (see Account-match guard).
 * Scopes: `openid email .../drive.file` — `openid`+`email` are required or the
 * userinfo call answers 401 and the guard has nothing to compare.
 * Rejects on popup-closed / access-denied.
 *
 * NOTE (observed in G1): Google grants these back as
 * `openid userinfo.email drive.file` — it expands `email` to its canonical
 * form. Never compare the granted scope string against the requested one;
 * the guard compares the *email* userinfo returns, which is unaffected.
 */
export function requestBrowserToken(args: {
  clientId: string;
  loginHint: string | null;
}): Promise<BrowserToken>;
```

### Account-match guard

`onOpenPicker` in the container runs: `requestBrowserToken({ loginHint })` → compare `email` against the instance's Google account → open the Picker only on a match, otherwise set `accountMismatch` and open nothing.

- **Expected address:** `workflow.accountInfo.identity`, already in workflow state (`google-sheets-workflow.util.ts:74`, set by `setAuthorized` from the OAuth callback and already rendered at `GoogleSheetsConnectorWorkflow.component.tsx:482`). Step 1 is only reachable once `connectorInstanceId` is set, so the value is present — no extra fetch.
- **Comparison** is case-insensitive on the whole address. No normalization beyond that; Google addresses are returned canonically by userinfo.
- **Fails open on an unknown expected address.** If `identity` is empty the guard is skipped and the Picker opens — an undetected mismatch degrades to today's behavior (a 404 the retry and error path already handle), whereas blocking would break a working flow to prevent a maybe.
- **Copy** names both addresses and the fix: *"This connector is linked to `alice@example.com`, but you authorized `bob@example.com`. Choose the linked account to pick a spreadsheet."* Retrying re-opens the chooser; nothing is persisted.

The Picker renders its own modal on top of the workflow stepper. Discovery left the z-index / focus-trap interaction open; it is an implementation detail of this util's host, verified in the smoke walk, not a contract here.

### Build-time config (`apps/web`)

Three new `import.meta.env` values, read with `?.` per the `contact.util.ts` precedent so jest and non-Vite contexts do not explode:

| Var | Purpose |
|---|---|
| `VITE_GOOGLE_PICKER_API_KEY` | Picker developer key. Browser-exposed by design; restrict by HTTP referrer to the app origins |
| `VITE_GOOGLE_OAUTH_CLIENT_ID` | Client id for the GIS token client. Must be the *same* client as the API's `GOOGLE_OAUTH_CLIENT_ID` — a different client mints a grant the server's token cannot see. The app origins must be registered as authorized JavaScript origins on that client |
| `VITE_GOOGLE_CLOUD_PROJECT_NUMBER` | `setAppId` — the numeric prefix of the client id. Kept as its own var rather than derived by splitting the client id on `-`, so the value is explicit in config review |

All three become `${PREFIX}_VITE_*` GitHub Actions secrets/vars alongside the existing `VITE_AUTH0_*` set, and `apps/web/.env.example` gains them.

> **Referrer restriction is correct here, unlike the Mapbox key (#83).** That token failed because a *server* sends no `Referer`; this key is used only from the browser, so the restriction is both safe and load-bearing.

### Removed

| Artifact | Location |
|---|---|
| Route `GET /api/connectors/google-sheets/sheets` | `google-sheets-connector.router.ts:289-…`, plus its inline `@openapi` block at `:258` |
| `GoogleSheetsConnectorService.listSheets` | `google-sheets-connector.service.ts:220` |
| `DRIVE_FILES_LIST_URL` (`:44`), `DRIVE_PAGE_SIZE` (`:45`), `SPREADSHEET_MIME_TYPE` (`:46`), `escapeForDriveQ` (`:97`), and the now-orphaned `ListSheetsInput` / `ListSheetsItem` / `ListSheetsResult` (exported) + `DriveFilesListResponse` types | same file |
| `GoogleAuthErrorKind`'s `"listSheets_failed"` member and its `case` in `mapGoogleAuthError` | `google-auth.service.ts:37`, `google-sheets-connector.router.ts:239` |
| `googleSheets.searchSheets` | `apps/web/src/api/google-sheets.api.ts:46` |
| `GoogleSheetsListSheets{RequestQuery,Item,ResponsePayload}` schemas + types | `packages/core/src/contracts/google-sheets.contract.ts:30-55` |

**`ApiCode.GOOGLE_SHEETS_LIST_FAILED` stays.** `mapGoogleAuthError` uses it as its `default:` branch *and* as the code on the non-`GoogleAuthError` 500 fallback, so it outlives listing. It keeps its name — renaming it is a wire-visible error-code change for no behavioral gain, and this spec is not the place to spend that. The `listSheets_failed` *kind* goes; the fallback code does not.

The route's `@openapi` block spells its responses inline and registers **no** components, so there is nothing to drop in `swagger.config.ts` — deleting the block is the whole OpenAPI change.

After removal, **no application code calls the Drive API**. Whether the Drive API can then be *disabled* on the GCP project is a smoke observation, not an assertion — the Picker may still require it.

### Retry on the first read (`apps/api`)

Both Sheets reads go through one helper, `fetchSpreadsheet()` (`google-sheets-connector.service.ts:707`), shared by `selectSheet` (`:278`) and `fetchWorkbookForSync` (`:457`).

- **Where the retry lives:** inside `fetchSpreadsheet`, so both call sites get it. `selectSheet` is the read right after a pick, but `fetchWorkbookForSync` is where a not-yet-propagated grant is most expensive (a failed job, not a retryable click), and the retry is harmless there.
- **Bound:** one retry, after a short fixed delay (**1s**), on **404 only**. A genuine missing file then fails on the second attempt; **403 is never retried** — an insufficient scope is not a race, and retrying it doubles the latency of the failure that matters most.
- **Contract change this forces:** `GoogleAuthError` today carries the upstream status only interpolated into its message string, so nothing downstream can branch on it. `fetchSheet_failed` gains a numeric `status` field (optional on the class, set at this throw site) — otherwise "retry 404, never 403" is string-matching.
- **What a persisting 404 surfaces:** today's behavior, unchanged — `GoogleAuthError("fetchSheet_failed")` → **502 `GOOGLE_SHEETS_FETCH_FAILED`**. There is no 404/not-found path on this route and this spec does not add one.

## Migration

**None.** No schema change, no backfill. Existing instances' stored refresh tokens keep their broader grant; when one is revoked or invalidated, `refreshAccessToken`'s `invalid_grant` path already marks the instance `status="error"` for the reconnect flow.

## Seed

No change.

## TDD test plan

### `packages/core`

**New** `src/__tests__/contracts/google-sheets.contract.test.ts` — there is no contract test for this file today, which is part of why the list schemas could be removed without anything noticing. Asserts the removed list schemas are gone and that the remaining Google Sheets contracts still parse. **~3 cases.**

### `apps/api`

`src/__tests__/services/google-auth.service.test.ts`
- `GOOGLE_OAUTH_SCOPES` is exactly `["openid","email",".../drive.file"]`. **Order-sensitive and exhaustive** — the point is to fail if anything is added.
- Contains **no** `drive.readonly` and **no** `spreadsheets.readonly` — asserted by name so a re-introduction is loud.
- The authorize URL still sets `include_granted_scopes=true`.

Also **rewrite** the existing `"requests both drive.readonly and spreadsheets.readonly scopes"` case at `:70-92` — it asserts exactly what this ticket removes, so it inverts rather than being deleted.

`src/__tests__/services/google-sheets-connector.service.test.ts`
- A 404 on the first read is retried once, then succeeds.
- A 404 that persists surfaces `502 GOOGLE_SHEETS_FETCH_FAILED` after exactly two attempts (no infinite retry).
- A **403 is never retried** — one attempt, asserted on the fetch call count.
- The retry applies on the `fetchWorkbookForSync` path too, not only `selectSheet`.
- `listSheets` no longer exists on the service.
- Fixture at `:386` (`scope: "openid email drive.readonly spreadsheets.readonly"`) updated.

`src/__tests__/routes/google-sheets-connector.router.test.ts` — `GET …/sheets` returns 404 (route removed).

**Deletions and fixture edits that CI will fail on if missed:**

| File | What |
|---|---|
| `src/__tests__/__integration__/routes/google-sheets-connector.router.integration.test.ts` | Delete the whole `GET /sheets` block (`:506-740`, ~6 cases); update `scope: drive.readonly` fixtures at `:320`, `:355`, `:403`, `:425`, `:456`, `:478`, `:540` |
| `src/__tests__/__integration__/routes/connector-instance.router.integration.test.ts:1427` | `scopes: ["drive.readonly"]` fixture |
| `src/__tests__/adapters/google-sheets.adapter.test.ts:8` | `scopes: ["drive.readonly", "spreadsheets.readonly"]` fixture |

**~14 cases across api** (new + inverted), plus the deletions above.

### `apps/web`

`src/workflows/GoogleSheetsConnector/__tests__/SelectSheetStep.test.tsx` (rewrite)
- Renders a "choose a spreadsheet" affordance and calls `onOpenPicker` on click.
- Shows `valueLabel` once selected.
- `pickerUnavailable` renders a configuration-problem message and **not** the old account-blaming copy.
- `accountMismatch` renders both addresses and leaves the choose affordance usable (the user retries by re-authorizing).
- Disabled while `loading`; disabled while `pickerLoading` without the "fetching contents" panel.
- `FormAlert` renders with `serverError`, absent without.

`src/workflows/GoogleSheetsConnector/__tests__/google-picker.util.test.ts`
- `openSheetPicker` passes `setAppId` — **pinning Key decision 2**, since omitting it fails as an unrelated-looking 404.
- Resolves `null` on cancel, `{spreadsheetId,name}` on pick.
- `loadPicker` rejects when the script fails, and is idempotent across calls.
- `requestBrowserToken` requests `openid email .../drive.file` and forwards `loginHint`; rejects on popup-closed.

Account-match guard, at the container level (`__tests__/GoogleSheetsConnectorWorkflow.test.tsx`) since it is wiring, per the Component File Policy:
- A matching email opens the Picker.
- A differing email sets `accountMismatch` and the Picker is **never opened** — asserted on the `openSheetPicker` mock.
- Comparison is case-insensitive.
- A null/empty `accountInfo.identity` opens the Picker (fails open).

`src/__tests__/api/google-sheets.api.test.ts` — delete the `searchSheets` describe (`:39-89`, 3 cases). Nothing replaces it: the browser mints its own token, so no SDK endpoint is added.

**~21 cases across web. Totals ≈ 35**, plus ~10 deleted.

Run per package: `cd <pkg> && npm run test:unit` (never raw jest — `NODE_OPTIONS` is required for ESM).

## Acceptance criteria

- The consent screen for a **new** Google Sheets connection — one whose Google account has never granted the old scopes — lists only "See, edit, create and delete only the specific Google Drive files you use with this app" plus name/email, and **no** "See all of your Google Drive files". (A previously-consented account re-unions its old grant via `include_granted_scopes`; see Key decision 5.)
- The OAuth client's consent-screen configuration in GCP lists no sensitive or restricted scope, no **unverified-app warning** appears, and the client is **not** subject to the 100-user cap.
- A user can pick a spreadsheet via the Picker and complete a full sync end to end.
- Authorizing the popup with a Google account other than the connector's blocks the Picker and names both addresses — it does **not** produce a 404 at sync.
- `grep -rn --exclude-dir=dist "drive.readonly\|spreadsheets.readonly" apps packages` returns nothing outside historical docs.
- `GET /api/connectors/google-sheets/sheets` is gone.
- An existing pre-migration instance still syncs without user action.
- The Picker failing to load produces a message naming a configuration problem, never an empty selector.

## Risks & rollback

| Risk | Detection | Response |
|---|---|---|
| **⚠️ The browser-created grant is invisible to the server's token.** The Picker grant is made in the browser; sync reads server-side with a token derived from the stored refresh token. The design assumes the grant is per *user per app*. **If false, `drive.file` is unusable for a server-sync connector and the ticket reverts to funding CASA.** | **Slice 1, in dev, before anything is deleted** — narrow dev's scope, run the real authorize flow so the stored refresh token carries only `drive.file`, pick via the Picker, then trigger a real sync. Cannot be tested with dev's existing token: it holds `drive.readonly` and would pass regardless — a guaranteed false positive | Stop. Revert the scope constant (one line, nothing else has changed yet) and re-open the CASA-vs-Picker decision on the ticket |
| Grant propagation is not instant | 404 on the first read after a pick | The single bounded retry above. **Never observed** — G1 read on the first attempt; the retry is precautionary |
| Picker script blocked (extension, offline) | `pickerUnavailable` | Fail closed with a configuration message; **never** an empty selector. Not a self-inflicted risk — the app ships no CSP header of its own |
| Picker's own modal fights the workflow stepper's focus trap / z-index | Visible in the smoke walk | Implementation-level fix in the container; discovery open question 4 |
| The user authorizes the popup as a different Google account | The account-match guard | Blocked at pick time with both addresses named; nothing is persisted |
| The console scope removal lands before slice 1 proves the design | The one-line rollback no longer restores the old behavior | Sequence it strictly after slice 1 passes; until then dev's client keeps its configured scopes and only the requested list narrows |
| The extra authorization popup reads as a bug ("why is Google asking again?") | Smoke walk | Step copy says what the popup is for before it opens; accepted cost of Key decision 6 |
| A future change re-adds a sensitive scope, silently restoring the cap | The exhaustive scope test | Test fails; the constant's comment explains the cost |
| Users lose in-app search | Accepted in the PRD | None — the Picker has its own search |

**Rollback** is one line — restore the scope constant — for as long as slice 1 is the only slice landed. After the deletions, rollback is a revert of the branch. That ordering is deliberate: the risky assumption is validated while the cost of being wrong is a single line.

## Files touched

- **Edit** `apps/api/src/services/google-auth.service.ts` — the scope list + its comment; drop the `listSheets_failed` error kind; add `status` to `GoogleAuthError`.
- **Edit** `apps/api/src/services/google-sheets-connector.service.ts` — delete `listSheets`, its Drive helpers and orphaned types; add the bounded 404 retry inside `fetchSpreadsheet`.
- **Edit** `apps/api/src/routes/google-sheets-connector.router.ts` — delete the route + its inline `@openapi` block + the `listSheets_failed` case.
- **Edit** `packages/core/src/contracts/google-sheets.contract.ts` — drop the list schemas.
- **Delete/edit** the api test files listed in the TDD plan (two integration suites, the adapter fixture, the web api suite).
- **Console (manual, user action, not a file)** — remove `drive.readonly` / `spreadsheets.readonly` from the OAuth consent screen (dev after slice 1, prod at deploy) and register the app origins as authorized JavaScript origins on the OAuth client.
- **Edit** `apps/web/src/api/google-sheets.api.ts` — drop `searchSheets`.
- **Rewrite** `apps/web/.../SelectSheetStep.component.tsx` — Picker affordance.
- **New** `apps/web/.../utils/google-picker.util.ts` — `loadPicker`, `openSheetPicker`, `requestBrowserToken`.
- **Edit** `apps/web/.../GoogleSheetsConnectorWorkflow.component.tsx` — wire the Picker and the account-match guard, drop the search callback.
- **Edit** `apps/web/.env.example`, `.github/workflows/deploy-{dev,prod}.yml` — the three new build-time values.
- **Edit** `docs/PROD_PROVISIONING.runbook.md:175` (§3) — Picker API; note the Drive-API question.
- **Edit** connector help/glossary copy that mentions browsing Drive.

## Next step

`docs/GOOGLE_SHEETS_PICKER.plan.md`, ~4 slices: **(1) narrow the requested scope in dev and prove the browser-grant → server-read bridge** — nothing else lands until this passes, and the dev console edit is the first thing that follows it; (2) the Picker util + token client + account-match guard + step; (3) delete the proxy end to end, tests included; (4) config, docs and copy sweep. Slice 1 first is the whole point: it is the cheapest possible position from which to discover the assumption is wrong.
