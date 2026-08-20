# Microsoft Excel no-OneDrive error surfacing — Spec

**Issue:** [EnterpriseBT/portal-ai#416](https://github.com/EnterpriseBT/portal-ai/issues/416) · **Discovery:** `docs/MICROSOFT_EXCEL_NO_ONEDRIVE.discovery.md`

Pins the contract for classifying "this Microsoft account has no OneDrive" as a distinct, user-remediable condition: a new `MicrosoftGraphError` kind, a new `ApiCode` at **409** on the three routes that touch `/me/drive`, the removal of raw Graph bodies from user-facing messages, and the error channel that gets the message onto the select-workbook step instead of swallowing it.

## Key decisions (flag for review)

These carry the discovery's leans forward. Items 2, 5, and 6 were **my leans, not your confirmations** — check them before implementation starts.

1. **Classify at the Graph-service boundary** (discovery D1-A), so `searchWorkbooks`, `headWorkbook`, and `downloadWorkbook` agree. Consequence: three routes change status, not one.
2. **The 400 SPO-license rule applies everywhere; the 404/403 rules apply *only* to the drive-root probe.** This is tighter than the discovery's D2 lean and resolves its open question 5: at an item-level endpoint a 404 means "that workbook is gone" and a 403 means "you can't read that item" — calling either "you have no OneDrive" would be a worse lie than today's 502. Only the root probe can distinguish them.
3. **Fail open.** Any unrecognized Graph error keeps its existing kind and its 502. A false no-drive verdict sends someone to re-authorize a working account.
4. **409 + `MICROSOFT_EXCEL_NO_ONEDRIVE`**, matching the `REST_API_MISSING_CREDENTIALS` / `SYNC_ALREADY_RUNNING` eligibility-gate precedent (`api-codes.constants.ts:503`, `:348`), both 409.
5. **Stop retrying 4xx in `client.ts`.** Discovery open question 1 is resolved and the answer changed the surface: `apps/web/src/client.ts:19-34` retries everything except 401 and `ORGANIZATION_USER_NOT_FOUND` up to 3 times. So today's 502 is fetched **4 times** — and a 409 would be too, each attempt re-running the `/children` BFS, delaying the alert by three round-trips for a verdict that cannot change. This is a general policy fix (`status >= 400 && status < 500 → no retry`), slightly wider than #416; the narrow alternative is to special-case this one code.
6. **`onSearchError` is opt-in and only `SelectWorkbookStep` adopts it** in this PR. The `try/catch` added inside core stops the unhandled rejection for all nine consumers regardless.

One discovery lean is **dropped as a no-op**: "abort the BFS walk on `no_drive`". The existing `throw` at `microsoft-graph.service.ts:191` already exits `searchWorkbooks` entirely — there was never a retry-through-the-queue to prevent.

## Scope

### In scope

1. `no_drive` member on `MicrosoftGraphErrorKind` + a Graph-error envelope parser + the classification predicate (`apps/api/src/services/microsoft-graph.service.ts`).
2. Raw Graph response bodies removed from all four thrown messages; logged at the service layer instead.
3. `MICROSOFT_EXCEL_NO_ONEDRIVE` in `ApiCode`; `no_drive` → 409 in `mapMicrosoftGraphError`.
4. `409` added to the `@openapi` responses of `GET /workbooks`, `POST /instances/:id/select-workbook`, and `GET /instances/:id/sheet-slice` — the last of which has no `responses:` section at all today, so it gains one.
5. No-retry-on-4xx in the react-query default options (`apps/web/src/client.ts`).
6. Optional `onSearchError` on `AsyncSearchableSelect` + `MultiAsyncSearchableSelect`, with a `catch` on all three promise paths.
7. Search failures routed into the Microsoft Excel workflow's existing `serverError` → `<FormAlert>` seam, and an error-aware empty state on the select-workbook step.
8. The stale `searchWorkbooks` docstring corrected (it describes a `/me/drive/search` call the method does not make).

### Out of scope

- Proactive detection at OAuth-callback time (discovery open question 2).
- Retrofitting `onSearchError` onto the other eight consumers (open question 3).
- Replacing `isAuthFailureMessage`'s substring match in `ConnectorInstance.view.tsx:86-103` (open question 4).
- Narrowing `MICROSOFT_OAUTH_TENANT` away from `common`.
- The 43 stale doc pointers (#417).

## Surface

### `MicrosoftGraphErrorKind` + classification — `apps/api/src/services/microsoft-graph.service.ts`

The kind union (`:45`) gains one member. `MicrosoftGraphError`'s constructor (`:56-64`) is unchanged.

```ts
export type MicrosoftGraphErrorKind =
  | "search_failed"
  | "head_failed"
  | "download_failed"
  | "file_too_large"
  | "no_drive";        // NEW
```

Two new module-private helpers:

```ts
/** Graph's error envelope: { error: { code, message, innerError: { request-id, … } } }.
 *  Returns nulls for a body that isn't the envelope — never throws. */
function parseGraphError(body: string): {
  code: string | null;
  message: string | null;
  requestId: string | null;
};

/** True only for the conditions that mean "this account has no drive at all".
 *  `atDriveRoot` MUST be false for item-scoped requests. */
function isNoDriveError(
  status: number,
  parsed: { code: string | null; message: string | null },
  atDriveRoot: boolean
): boolean;
```

`isNoDriveError` returns `true` for exactly:

| # | Condition | `atDriveRoot` required |
|---|---|---|
| 1 | `status === 400` && `code === "BadRequest"` && `/SPO license/i` matches `message` | No — unambiguous anywhere |
| 2 | `status === 404` && `code` ∈ {`ResourceNotFound`, `itemNotFound`} | **Yes** |
| 3 | `status === 403` && `code === "accessDenied"` | **Yes** |

Everything else → `false` (fail open). `code` is the primary key; the license string only refines rule 1 and is never a sole key on its own.

`atDriveRoot` is `true` only for the first `/children` request of a `searchWorkbooks` walk — the BFS node with `folderId === "root"` at `depth === 0`. It is `false` for every descended folder, and `false` unconditionally in `headWorkbook` and `downloadWorkbook`, whose URLs are item-scoped (`:225`, `:257`).

Each of the four non-ok throw sites (`:190`, `:233`, `:265`, plus the missing-`res.body` throw at `:295`) becomes: parse the body → if `isNoDriveError(…)` throw `no_drive`, else throw the existing kind. **No site interpolates `body` into the message.**

Messages (exact strings — these reach the browser):

```ts
// no_drive — one message, all three endpoints:
"This Microsoft account has no OneDrive. Reconnect with a personal Microsoft " +
"account, or a work account whose tenant has OneDrive or SharePoint enabled."

// the three existing kinds keep their prefix, lose the body:
`Microsoft Graph children failed (${res.status})`
`Microsoft Graph head failed (${res.status})`
`Microsoft Graph download failed (${res.status})`
```

`details` stays unpopulated for all three existing kinds and for `no_drive`; only `file_too_large` carries it (`:287`).

The file gains a logger — it has none today (its only imports are `stream` and `environment`, `:19-22`), matching the sibling convention at `microsoft-excel-connector.service.ts:57`:

```ts
const logger = createLogger({ module: "microsoft-graph" });
```

Every non-ok branch logs once at `warn` with `{ status, graphCode, requestId, endpoint, kind }` **and the raw body**. This is where the Graph `request-id` goes now that it leaves the user-facing message — it must be in the logs of the people who can use it, not the browser of the person who can't.

### `ApiCode` — `apps/api/src/constants/api-codes.constants.ts`

Appended to the `// Microsoft Excel connector data ops` group (`:331-337`), after `MICROSOFT_EXCEL_UNSUPPORTED_FORMAT`:

```ts
/**
 * The connected Microsoft account has no OneDrive — its Entra tenant
 * carries no SharePoint Online license, or the identity is a guest
 * (`#EXT#`) with no drive provisioned. An eligibility gate on the
 * connection, in the `REST_API_MISSING_CREDENTIALS` family: 409, and
 * remediable by reconnecting a different account.
 */
MICROSOFT_EXCEL_NO_ONEDRIVE = "MICROSOFT_EXCEL_NO_ONEDRIVE",
```

### Router — `apps/api/src/routes/microsoft-excel-connector.router.ts`

`mapMicrosoftGraphError` (`:243`) gains one case, before `search_failed`:

```ts
case "no_drive":
  return new ApiError(409, ApiCode.MICROSOFT_EXCEL_NO_ONEDRIVE, message);
```

The message passes through unchanged — the service owns the copy, so all three routes say the same thing. `search_failed` → 502 and `head_failed`/`download_failed` → 502 are untouched.

`@openapi` additions — one line each, no swagger component registration (error codes are per-route prose; `swagger.config.ts` registers only Zod-sourced data contracts):

| Route | Block | Added |
|---|---|---|
| `GET /workbooks` | `:279-302` | `409: { description: Connected Microsoft account has no OneDrive }` |
| `POST /instances/:id/select-workbook` | `:337-368` | same |
| `GET /instances/:id/sheet-slice` | `:403-435` | **the whole `responses:` section** — see below |

`GET /instances/:id/sheet-slice`'s block ends after its `parameters:` list (`:435`) with **no `responses:` section at all** — so it currently documents no status codes, success included. Per the API style guide ("a route without `@openapi` … is a missing-docs bug, not 'deferred'") that gap is in scope here rather than deferred, since this ticket is the thing adding a status code to it. The slice adds `200` (referencing the same sheet-slice payload component the handler returns), `400`, `404`, `409`, and `502`, matching the shape of the two sibling blocks. This is a docs-only addition — no handler change.

### React-query retry policy — `apps/web/src/client.ts`

Both `queries.retry` and `mutations.retry` (`:19-25`, `:27-33`) gain a 4xx short-circuit, keeping the existing 401 / `ORGANIZATION_USER_NOT_FOUND` rules:

```ts
retry: (failureCount, error) => {
  if (error instanceof ApiError) {
    if (error.status === 401) return false;
    if (error.code === "ORGANIZATION_USER_NOT_FOUND") return false;
    if (error.status >= 400 && error.status < 500) return false;   // NEW
  }
  return failureCount < 3;
},
```

A 4xx is a deterministic verdict about the request; re-issuing it cannot change the answer. 5xx keeps its 3 retries.

### `AsyncSearchableSelect` — `packages/core/src/ui/searchable-select/AsyncSearchableSelect.tsx`

One optional prop on `AsyncSearchableSelectProps` (`:10-24`):

```ts
/**
 * Called when `onSearch` (or `loadSelectedOption`) rejects. When omitted,
 * the rejection is swallowed — but options are cleared either way, so the
 * list never shows results that predate a failed search.
 */
onSearchError?: (error: unknown) => void;
```

All three promise paths gain a `catch` that runs before the existing `finally`, guarded by the same `cancelled` flag the `.then()` branches use:

| Path | Line | On rejection |
|---|---|---|
| `loadSelectedOption(value)` | `:56-64` | `setSelectedOption(null)`; `onSearchError?.(err)` |
| `onSearch("")` initial load | `:66-75` | `setOptions([])`; `onSearchError?.(err)` |
| Debounced `onSearch(query)` | `:86-94` | `setOptions([])`; `onSearchError?.(err)` |

`MultiAsyncSearchableSelect.tsx:47-77` takes the identical prop and the identical three catches. `SearchableSelect.tsx` is synchronous and untouched.

**Contract note:** clearing options on error is unconditional, not gated on `onSearchError` being passed. Leaving a stale option list behind a failed search is the bug that made this invisible in the first place.

### Workflow wiring — `apps/web/src/workflows/MicrosoftExcelConnector/`

`useMicrosoftExcelWorkflow`'s return object (`utils/microsoft-excel-workflow.util.ts:258-291`) exposes the existing setter, which is currently internal:

```ts
setServerError: core.setServerError,   // (err: ServerError | null) => void
```

`handleSearchWorkbooks` (`MicrosoftExcelConnectorWorkflow.component.tsx:272-286`) keeps returning `SelectOption[]` but reports and re-throws, so the core component still clears its options:

```ts
try {
  const res = await searchWorkbooksMutate({ connectorInstanceId: ciId, search: query });
  workflow.setServerError(null);
  return res.items.map((item) => ({ value: item.driveItemId, label: item.name }));
} catch (err) {
  workflow.setServerError(toServerErrorFromUnknown(err));
  throw err;
}
```

`toServerErrorFromUnknown` (`use-spreadsheet-workflow.util.ts:140-148`) already maps an `ApiError` to `{ message, code }`, so `<FormAlert>` at `SelectWorkbookStep.component.tsx:53` renders the 409's copy and its `MICROSOFT_EXCEL_NO_ONEDRIVE` code with no further plumbing.

`SelectWorkbookStepUIProps` (`:15-28`) is unchanged — it already takes `serverError`. Its `noOptionsText` becomes error-aware, since the current constant (`:31`) asserts something the component can no longer know:

```ts
const NO_OPTIONS_LABEL =
  "No workbooks found — make sure the right Microsoft account is connected.";
const SEARCH_FAILED_LABEL = "Workbook search failed — see the message above.";
// noOptionsText={serverError ? SEARCH_FAILED_LABEL : NO_OPTIONS_LABEL}
```

The container passes `onSearchError={undefined}` — the re-throw from `handleSearchWorkbooks` is what drives the core clear, and `serverError` is already set by the time the empty state renders. `onSearchError` exists for consumers that don't own a `FormAlert`.

## Migration / Seed

**None.** No schema change, no new table, no column, no seed data. Nothing to generate with `db:generate`.

## TDD test plan

### `apps/api` — `npm run test:unit` (from `apps/api/`)

**`src/__tests__/services/microsoft-graph.service.test.ts`** (extend; `MicrosoftGraphService.searchWorkbooks` block at `:40`, `headWorkbook` at `:255`, `downloadWorkbook` at `:294`). The existing `:239` case — 401 → `search_failed` — is the fail-open anchor and must stay green unchanged.

1. Root `/children` 400 with the real recorded SPO-license envelope → `kind === "no_drive"`.
2. That error's `message` contains the remedy copy and **no** `request-id`, no `{"error"`, no raw body.
3. Root `/children` 404 `ResourceNotFound` → `no_drive`.
4. Root `/children` 403 `accessDenied` → `no_drive`.
5. A **descended folder** (depth ≥ 1) 404 → `search_failed`, not `no_drive` (the `atDriveRoot` gate).
6. Root 400 with a *different* `error.code` → `search_failed` (fail open).
7. Root 400 `BadRequest` whose message lacks "SPO license" → `search_failed` (fail open).
8. A non-JSON / empty body on a 400 → `search_failed`, no throw from the parser.
9. `headWorkbook` 400 SPO-license → `no_drive`.
10. `headWorkbook` 404 item-not-found → `head_failed`, **not** `no_drive` (deleted workbook).
11. `downloadWorkbook` 400 SPO-license → `no_drive`.
12. `downloadWorkbook` 403 on the item → `download_failed`, not `no_drive`.
13. `search_failed` / `head_failed` / `download_failed` messages no longer contain the response body (3 assertions, one per kind).

**`src/__tests__/__integration__/routes/microsoft-excel-connector.router.integration.test.ts`** (extend; `/workbooks` block at `:604`, select-workbook at `:705`, sheet-slice at `:876`).

14. `GET /workbooks` against an SPO-license 400 → `409`, `code === "MICROSOFT_EXCEL_NO_ONEDRIVE"`, remedy copy in `message`.
15. Same for `POST /instances/:id/select-workbook`.
16. Same for `GET /instances/:id/sheet-slice`.
17. `GET /workbooks` against an unrecognized Graph 500 → still `502 MICROSOFT_EXCEL_LIST_FAILED` (fail-open, end to end).
18. The 409 response body carries no Graph `request-id`.

### `packages/core` — `npm run test:unit` (from `packages/core/`)

**`src/__tests__/ui/SearchableSelect.test.tsx`** (extend the `AsyncSearchableSelect` block at `:91`) and **`MultiSearchableSelect.test.tsx`** (`:211`).

19. Debounced `onSearch` rejects → `onSearchError` called once with the error.
20. Debounced `onSearch` rejects → options cleared (previously-rendered option gone from the listbox).
21. Initial `onSearch("")` rejects → `onSearchError` called; no unhandled rejection.
22. `loadSelectedOption` rejects → `onSearchError` called; loading spinner clears.
23. `onSearch` rejects with **no** `onSearchError` passed → no throw, options still cleared.
24. Loading state clears on rejection (the `finally` still runs).
25–26. Cases 19 + 20 repeated for `MultiAsyncSearchableSelect`.

### `apps/web` — `npm run test:unit` (from `apps/web/`)

**`src/workflows/MicrosoftExcelConnector/__tests__/SelectWorkbookStep.test.tsx`** (extend).

27. `serverError` set → `<FormAlert>` renders the message and the code.
28. `serverError` set → the empty state reads "Workbook search failed", not "No workbooks found".
29. `serverError` null with zero results → the original "No workbooks found" copy (regression guard on the existing `:51` case).

**`src/workflows/MicrosoftExcelConnector/utils/__tests__/microsoft-excel-workflow.util.test.tsx`** (extend).

30. `setServerError` is exposed on the hook's return value.

**`src/__tests__/client.test.ts`** (new — no test file covers `client.ts` today).

31. `retry` returns `false` for a 409 `ApiError`.
32. `retry` returns `false` for a 404 `ApiError`.
33. `retry` returns `true` (under 3 failures) for a 502 `ApiError`.
34. `retry` still returns `false` for 401 and for `ORGANIZATION_USER_NOT_FOUND`.

**Totals ≈ 34 cases** — 18 `apps/api`, 8 `packages/core`, 8 `apps/web`. No migration test (no schema change). Run per package via `npm run test:unit`; `apps/api` integration cases via `npm run test:integration`. Never invoke `jest`/`npx` directly — the ESM `NODE_OPTIONS` live in the npm scripts.

## Acceptance criteria

- [ ] A workbook search on an account whose tenant has no SPO license returns `409 MICROSOFT_EXCEL_NO_ONEDRIVE`, not `502 MICROSOFT_EXCEL_LIST_FAILED`.
- [ ] `select-workbook` and `sheet-slice` return the same 409 for the same account.
- [ ] No response body from any of the three routes contains a Graph `request-id`, `client-request-id`, or raw `{"error":…}` JSON.
- [ ] The Graph status, `error.code`, and `request-id` appear in the API logs for every failed `/me/drive` call.
- [ ] On the select-workbook step, the user sees an alert naming the cause and the remedy — not an empty dropdown.
- [ ] The step's empty-state text does not claim "No workbooks found" when the search failed.
- [ ] A failed search is issued **once**, not four times.
- [ ] An unrecognized Graph failure still surfaces as it does today (502, existing code).
- [ ] A 404 for a deleted workbook still surfaces as `MICROSOFT_EXCEL_FETCH_FAILED`, never as no-OneDrive.
- [ ] The other eight `AsyncSearchableSelect` consumers behave exactly as before.

## Risks & rollback

**Fail-mode: fail open, deliberately.** An unrecognized Graph error keeps its current kind and 502. The cost of failing closed here is a user re-authorizing a perfectly good account on our false advice; the cost of failing open is the status quo. Cases 6–8 and 17 pin it.

| Risk | Detection | Rollback |
|---|---|---|
| Predicate false-positives on an item-level 404/403 (the discovery's original, looser D2) | Cases 5, 10, 12 | Tighten `isNoDriveError`; `atDriveRoot` already gates rules 2–3 |
| Microsoft rewords "Tenant does not have a SPO license" | Rule 1 stops matching → falls back to 502, i.e. today's behavior. No crash, no false verdict | Add the new string; `error.code` keeps rules 2–3 working |
| The 4xx no-retry change masks a transient 4xx elsewhere in the app | Case 33 keeps 5xx retrying; a 4xx that *is* transient is a server bug, not a client one | Revert `client.ts` alone — it's independent of the rest |
| Clearing options on rejection changes behavior for the other eight consumers | Cases 19–26; each consumer's own tests | The clear is the intended fix; revert `packages/core` only if a consumer depended on stale options |
| Removing bodies from messages breaks a test asserting message text | `apps/api` unit suite | The only existing assertion (`:250`) is on `kind` |

Rollback is per-slice: the API classification, the retry policy, and the core error channel are independently revertible, and each is behind its own commit.

## Files touched

**Edit**
- `apps/api/src/services/microsoft-graph.service.ts` — kind, parser, predicate, four throw sites, logger, docstring
- `apps/api/src/constants/api-codes.constants.ts` — `MICROSOFT_EXCEL_NO_ONEDRIVE`
- `apps/api/src/routes/microsoft-excel-connector.router.ts` — `no_drive` case + three `@openapi` blocks
- `apps/web/src/client.ts` — 4xx no-retry
- `packages/core/src/ui/searchable-select/AsyncSearchableSelect.tsx` — `onSearchError` + three catches
- `packages/core/src/ui/searchable-select/MultiAsyncSearchableSelect.tsx` — same
- `apps/web/src/workflows/MicrosoftExcelConnector/utils/microsoft-excel-workflow.util.ts` — expose `setServerError`
- `apps/web/src/workflows/MicrosoftExcelConnector/MicrosoftExcelConnectorWorkflow.component.tsx` — try/catch in `handleSearchWorkbooks`
- `apps/web/src/workflows/MicrosoftExcelConnector/SelectWorkbookStep.component.tsx` — error-aware empty state
- `apps/api/src/__tests__/services/microsoft-graph.service.test.ts`
- `apps/api/src/__tests__/__integration__/routes/microsoft-excel-connector.router.integration.test.ts`
- `packages/core/src/__tests__/ui/SearchableSelect.test.tsx`, `MultiSearchableSelect.test.tsx`
- `apps/web/src/workflows/MicrosoftExcelConnector/__tests__/SelectWorkbookStep.test.tsx`
- `apps/web/src/workflows/MicrosoftExcelConnector/utils/__tests__/microsoft-excel-workflow.util.test.tsx`

**New**
- `apps/web/src/__tests__/client.test.ts`

## Next step

`docs/MICROSOFT_EXCEL_NO_ONEDRIVE.plan.md` slices this into roughly four commits, each independently green: (1) the Graph-service classification + body-stripping + logger, carrying cases 1–13 — the heaviest slice, and the one where fail-open is proven; (2) `ApiCode` + router mapping + `@openapi`, cases 14–18; (3) the `packages/core` error channel, cases 19–26; (4) the `apps/web` wiring, honest empty state, and retry policy, cases 27–34. Slices 3 and 4 are separable from 1 and 2 — the API half is shippable on its own if the frontend half needs another pass.
