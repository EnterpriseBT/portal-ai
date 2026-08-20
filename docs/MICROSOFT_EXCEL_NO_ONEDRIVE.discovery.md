# Microsoft Excel no-OneDrive error surfacing — Discovery

**Issue:** [EnterpriseBT/portal-ai#416](https://github.com/EnterpriseBT/portal-ai/issues/416)

**Why this exists.** A Microsoft account whose Entra tenant carries no SharePoint Online license — a bare `*.onmicrosoft.com` directory, or a guest `#EXT#` identity in someone else's tenant — has no OneDrive at all. Every `/me/drive/*` call for that account returns `400 BadRequest "Tenant does not have a SPO license."`. The connector's OAuth dance completes cleanly (token exchange and Graph `/me` don't touch SPO), so the failure surfaces later, at the first workbook listing, as `502 MICROSOFT_EXCEL_LIST_FAILED` with the raw Graph JSON echoed into the user-facing `message` — and in the UI it doesn't surface at all: the rejection is swallowed by `AsyncSearchableSelect`, leaving only the empty-state string "No workbooks found — make sure the right Microsoft account is connected."

Two independent defects stacked into one dead end. The user is told nothing, and what little they are told blames our server for a precondition on their own account that they could fix in thirty seconds. This is the classification pass that turns an unlicensed-tenant 400 into a typed, remediable 4xx and gets it in front of the person who can act on it.

## The current shape

### Graph service — one error kind per endpoint, none per cause

`MicrosoftGraphErrorKind` (`apps/api/src/services/microsoft-graph.service.ts:45`) is a closed union of four members — `search_failed`, `head_failed`, `download_failed`, `file_too_large`. The first three are named after **which call failed**, not **why**, and every non-`ok` response funnels into them unconditionally:

| Method | Graph endpoint | Non-ok throw | Kind |
|---|---|---|---|
| `searchWorkbooks` | `GET /me/drive/items/{id}/children` (BFS walk) | `:190-195` | `search_failed` |
| `headWorkbook` | `GET /me/drive/items/{id}?$select=size,name` | `:233-238` | `head_failed` |
| `downloadWorkbook` | `GET /me/drive/items/{id}/content` | `:265-274`, `:295` | `download_failed` |

All three hit `/me/drive`, so **all three 400 identically** on an unlicensed tenant. Whichever one the user reaches first is the one that breaks; the cause is the same and today's kinds cannot express it.

`safeReadText` (`:126`) reads the response body and the result is string-interpolated straight into the thrown `Error`'s message at each site. Graph's error envelope (`error.code` / `error.message` / `error.innerError.request-id`) is **never parsed anywhere in the file** — the JSON goes into a message as opaque text, which is both why the browser sees `request-id` values and why nothing downstream can branch on the cause. `details` (`:51-65`) exists on the error class but only `file_too_large` populates it (`:287`).

The class docstring at the top of the file also claims `searchWorkbooks` uses `/me/drive/search(q='…')`; the implementation is a `/children` BFS (`:177`). Stale, worth correcting in passing.

### Router — every upstream failure is a 502

`mapMicrosoftGraphError` (`apps/api/src/routes/microsoft-excel-connector.router.ts:243`) is the whole mapping surface:

| Kind | Status | `ApiCode` |
|---|---|---|
| `file_too_large` (`:253`) | 413 | `MICROSOFT_EXCEL_FILE_TOO_LARGE` (passes `details`) |
| `search_failed` (`:260`) | 502 | `MICROSOFT_EXCEL_LIST_FAILED` (message only) |
| `head_failed` / `download_failed` / default (`:262-263`) | 502 | `MICROSOFT_EXCEL_FETCH_FAILED` |

Three routes route through it — `GET /workbooks` (`:331`), `POST /instances/:id/select-workbook` (`:397`), `GET /instances/:id/sheet-slice` (`:479`) — so all three are in this bug's blast radius, not just the listing. Their `@openapi` blocks declare 502 as the only upstream-failure response (`:299`, `:365`); there is no 4xx precondition path to extend. Helpfully, `ApiCode` values are **not** registered as swagger components — `swagger.config.ts` registers Zod-sourced data contracts only, and error codes live as prose in each route's `responses:` — so a new code costs one `@openapi` response line per route and no schema registration.

### `ApiCode` — the precedent is 409, not 502

`MICROSOFT_EXCEL_*` codes sit at `apps/api/src/constants/api-codes.constants.ts:331-337`, directly beneath `MICROSOFT_OAUTH_*` (`:313-329`), mirroring the `GOOGLE_OAUTH_*` / `GOOGLE_SHEETS_*` pairing above (`:298-311`) — grouped per connector, OAuth separated from data ops.

For "a precondition on the user's connected third-party account is not satisfied", two codes already establish the shape, and both are **409**:

- `REST_API_MISSING_CREDENTIALS` (`:503`) — raised by `assertSyncEligibility` (`apps/api/src/adapters/rest-api/rest-api.adapter.ts:178-199`) as a typed `reasonCode`, mapped to 409 in `apps/api/src/services/sync.service.ts:140-155`.
- `SYNC_ALREADY_RUNNING` (`:348`) — 409, thrown directly (`sync.service.ts:103-112`).

Both are *eligibility gates*: a closed reason code returned as structured data before the upstream call, surfaced as a state conflict on the connection rather than a server fault.

### `AsyncSearchableSelect` — three uncaught promise paths

`packages/core/src/ui/searchable-select/AsyncSearchableSelect.tsx` calls `onSearch` from three places, and **none has a `.catch`**:

| Path | Line | Shape |
|---|---|---|
| Selected-option hydration (`loadSelectedOption`) | `:56-64` | `.then().finally()` |
| Initial load `onSearch("")` | `:66-75` | `.then().finally()` |
| Debounced search | `:86-94` | `try { await onSearch(…) } finally { setLoading(false) }` — no `catch` |

A rejection therefore becomes an unhandled promise rejection, `options` keeps its previous value (`[]` on first search), and MUI renders `noOptionsText` (`:148`). The component has no way to distinguish "zero results" from "the search threw", and no channel to tell its parent. `MultiAsyncSearchableSelect.tsx:47-77` has the identical shape; `SearchableSelect.tsx` is synchronous and unaffected.

Nine `apps/web` call sites consume `AsyncSearchableSelect` — `SelectWorkbookStep`, `InferredColumnsTable`, `CreateConnectorEntityDialog`, `EditFieldMappingDialog`, `CreateFieldMappingDialog`, `PaginationToolbar`, `BindingEditorPopover`, `EntityDetail.view`, `EntityGroupDetail.view` — and **none** currently handles a rejecting `onSearch`. No existing test in `packages/core/src/__tests__/ui/SearchableSelect.test.tsx` (async block from `:91`) or `MultiSearchableSelect.test.tsx` (from `:211`) exercises a rejection. Uncovered territory, but also: nothing depends on today's swallow, so an optional error channel is additive.

### Workflow — a `FormAlert` that this bug can never reach

`serverError: ServerError | null` (`apps/web/src/utils/api.util.ts:16-19`) is owned by the shared spreadsheet hook (`apps/web/src/workflows/_shared/spreadsheet/use-spreadsheet-workflow.util.ts:129`, setter `:552-554`). The Microsoft wrapper populates it in exactly one place — `selectWorkbook`'s catch (`utils/microsoft-excel-workflow.util.ts:243-247`). `SelectWorkbookStep.component.tsx:53` already renders `<FormAlert serverError={serverError} />`.

So the alert exists, is already wired, and is already on the right step — but `handleSearchWorkbooks` (`MicrosoftExcelConnectorWorkflow.component.tsx:272-286`) has **no try/catch at all**, so a listing failure never reaches it. Tests exist (`__tests__/SelectWorkbookStep.test.tsx`, `__tests__/microsoft-excel-workflow.util.test.tsx`); there are no stories for either the container or the step.

### Precedent — and the anti-pattern to not repeat

`ConnectorInstance.view.tsx:86-103` gates the inline reconnect CTA on a Google sync failure with `isAuthFailureMessage` — a substring match for the `GoogleAuthError` kinds (`refresh_failed`, `invalid_grant`) that the access-token cache surfaces verbatim in a message. Its own comment records that upgrading the event to carry a structured `code` is the intended replacement. That is the exact trap `MICROSOFT_EXCEL_LIST_FAILED` is already in with its raw-body message, and the thing a new typed code must not recreate on the frontend. For copy register, `ConnectorInstanceSyncButton.component.tsx:7-11` sets the house convention: short, imperative, remedy-first tooltip strings.

## The design space

### Decision 1 — where the no-drive cause gets classified

**A. At the Graph-service boundary.** Parse Graph's error envelope in one shared helper and add a `no_drive` kind to `MicrosoftGraphErrorKind`. All three throw sites use it, so `searchWorkbooks`, `headWorkbook`, and `downloadWorkbook` classify identically.

**B. On the search path only.** Classify inside `searchWorkbooks`, leave head/download as-is.

**C. In the router.** Regex the message inside `mapMicrosoftGraphError`.

| | A (service boundary) | B (search only) | C (router regex) |
|---|---|---|---|
| Covers `/workbooks` | Yes | Yes | Yes |
| Covers select-workbook + sheet-slice | Yes | No | Yes |
| Parses the real Graph envelope | Yes | Yes | No — string-matches our own interpolation |
| New surface area | One helper + one kind | One helper, one call site | None |
| Repeats `isAuthFailureMessage`'s mistake | No | No | **Yes** |

**Lean: A.** The cause is a property of the account, not of which endpoint noticed — and the three endpoints are one 400 apart from each other. C is disqualified on principle: it string-matches a message we ourselves built, which is the anti-pattern `ConnectorInstance.view.tsx:90-93` is already waiting to be rescued from. B leaves two of three routes still returning a raw 502 for a cause we've already learned to name.

### Decision 2 — what to match on

**A. `error.code === "BadRequest"` + message substring `"SPO license"`.** Narrow and literal.

**B. A small predicate over the parsed envelope** covering the known no-drive family: the SPO-license 400, plus `404 ResourceNotFound` / `itemNotFound` on `/me/drive` root (a never-provisioned drive), plus `403` on a guest identity with no drive.

**C. Any 4xx on `/me/drive` is "your account can't do this".** Broadest.

| | A (literal) | B (predicate over known family) | C (all 4xx) |
|---|---|---|---|
| False positives | None | Low | High — swallows a genuine 404 for a deleted workbook |
| False negatives | Unprovisioned-drive 404 still 502s | Few | None |
| Sensitive to Microsoft's copy | Yes — a message reword silently regresses it | Partly — `error.code` is the stable half | No |

**Lean: B, keyed on `error.code` first and the message only as a secondary signal.** Matching a vendor's prose is a regression waiting to happen, so the license string can confirm but must not be the sole key. C is wrong outright: `downloadWorkbook` legitimately 404s for a workbook the user deleted, and calling that "your tenant has no OneDrive" would be a worse lie than today's 502.

### Decision 3 — status code

409 (the `REST_API_MISSING_CREDENTIALS` / `SYNC_ALREADY_RUNNING` precedent), 422, or 424 Failed Dependency.

**Lean: 409, code `MICROSOFT_EXCEL_NO_ONEDRIVE`.** It matches the two in-repo eligibility-gate precedents exactly — a conflict with the state of the connected account, not malformed client input (422) and not an unnamed upstream dependency (424, which no route in this repo uses). Consistency with an established local pattern beats a marginally more precise but unprecedented status.

### Decision 4 — how the message reaches the user

**A. Optional `onSearchError` callback on `AsyncSearchableSelect`.** The component catches, clears options, and hands the error up; consumers that don't pass it keep today's behavior.

**B. Component renders the error itself** via an internal error state.

**C. Leave core alone; wrap the search function in the workflow's `try/catch`.**

| | A (`onSearchError`) | B (renders internally) | C (wrap at call site) |
|---|---|---|---|
| Fixes the other 8 consumers | Opt-in, one prop each | Yes, automatically | No |
| Stops the unhandled rejection | Yes | Yes | Only for this one consumer |
| Respects the house error-display split | Yes — parent routes it to `FormAlert` | **No** — a shared primitive would own error copy | Yes |
| Breaking for existing consumers | No (optional prop) | No, but changes their rendering | No |

**Lean: A, plus routing it into the existing `serverError` → `<FormAlert>` seam at `SelectWorkbookStep.component.tsx:53`.** B violates the Form & Dialog Pattern — server errors render through `FormAlert` in the owning surface, and a `packages/core` primitive has no business holding error copy. C leaves the same landmine in eight other consumers and doesn't stop the unhandled rejection. A also needs the empty-state fixed: on error, `noOptionsText` must not claim "No workbooks found", since that sentence is a factual assertion the component can no longer make.

## Tradeoff comparison

|  | D1: classify at service boundary | D2: predicate on `error.code` | D3: 409 + new `ApiCode` | D4: `onSearchError` → `FormAlert` |
|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes |
| Package touched | `apps/api` | `apps/api` | `apps/api` | `packages/core` + `apps/web` |
| Changes an existing contract | New kind (additive) | No | **Yes** — 502 → 409 on 3 routes | No (optional prop) |
| Fixes routes beyond `/workbooks` | Yes (3 routes) | Yes | Yes | Search surfaces only |

## Recommendation

1. Add a `no_drive` member to `MicrosoftGraphErrorKind` (`microsoft-graph.service.ts:45`) and a single private helper that parses Graph's error envelope (`error.code`, `error.message`) from a non-ok response body.
2. Classify with a predicate keyed on `error.code`, using the message only as a secondary signal: the SPO-license 400, an unprovisioned-drive `404 ResourceNotFound` / `itemNotFound` against the drive root, and a guest-identity 403. Never classify a plain item-level 404 as no-drive.
3. Use the helper at all three non-ok throw sites (`:190`, `:233`, `:265`) so `searchWorkbooks`, `headWorkbook`, and `downloadWorkbook` agree on the cause.
4. Stop interpolating the Graph body into any thrown message. Log the raw body and Graph's `request-id` at the service layer via Pino; carry only structured fields forward on `details`.
5. Add `MICROSOFT_EXCEL_NO_ONEDRIVE` to `ApiCode` in the `MICROSOFT_EXCEL_*` group (`api-codes.constants.ts:331-337`), and map `no_drive` → **409** in `mapMicrosoftGraphError` (`:243`).
6. Write remedy-facing copy in the `ApiError` message, in the register of `ConnectorInstanceSyncButton.component.tsx:7-11`: name the cause (this Microsoft account has no OneDrive) and the fix (reconnect with a personal account, or a work account whose tenant has OneDrive/SharePoint enabled).
7. Add the 409 response to the `@openapi` blocks of all three affected routes (`:299`, `:365`, and the sheet-slice block at `:403`). No swagger component registration needed.
8. Add an optional `onSearchError?: (err: unknown) => void` to `AsyncSearchableSelectProps` (`:10-24`); catch on all three promise paths (`:56`, `:66`, `:86`), clear `options`, and invoke it. Mirror it in `MultiAsyncSearchableSelect.tsx:47-77`.
9. Wire `handleSearchWorkbooks` (`MicrosoftExcelConnectorWorkflow.component.tsx:272-286`) to route the error into the existing `serverError` state so `<FormAlert>` at `SelectWorkbookStep.component.tsx:53` renders it.
10. Make the empty state honest: when a search errored, don't render "No workbooks found — make sure the right Microsoft account is connected" (`SelectWorkbookStep.component.tsx:31`).
11. Correct the `searchWorkbooks` docstring, which describes a `/me/drive/search` call the method doesn't make (`:177` is a `/children` BFS).

## Open questions

1. **Does the 409 break any existing frontend branch on 502?** The three routes' failures currently land in `toServerErrorFromUnknown`, which is status-agnostic — but `useAuthMutation`/`useAuthQuery` may treat some statuses differently (auth-error handling). **Lean: verify in spec, expect no break.** Nothing in the Microsoft workflow reads `status`; it reads `message` and `code`.
2. **Should the no-drive condition be detected at OAuth-callback time instead, so the connector never reaches a broken select-workbook step?** A single `GET /me/drive` probe in `handleCallback` would fail the connection immediately with the same code. **Lean: not here.** It's a genuinely better UX and #416 explicitly parks it; it also raises its own question (does a connector instance get created at all?). Do the reactive fix first, then decide with evidence.
3. **Do the other eight `AsyncSearchableSelect` consumers get `onSearchError` in this PR?** **Lean: no — leave them.** The prop is optional and their behavior is unchanged; retrofitting eight surfaces would balloon a bugfix into an audit. Worth its own ticket, and the `try/catch` added in core already stops the unhandled rejection everywhere.
4. **Does `no_drive` need to reach `ConnectorInstance.view`'s reconnect affordance?** A no-drive account is exactly a "reconnect with a different account" situation, and that view currently string-matches `refresh_failed` to decide (`:86-103`). **Lean: out of scope, note the adjacency.** Fixing that heuristic is #416-adjacent but is really the structured-code migration its own comment asks for.
5. **Guest (`#EXT#`) identities on a *licensed* tenant.** A guest in a tenant that does have SPO still has no personal drive there, and Graph's error for that case may differ from the license 400. **Lean: cover what we can observe and let the predicate degrade to today's 502 otherwise.** We have one reproduction (an unlicensed tenant); inventing matchers for unobserved shapes is how false positives get in.

## Enterprise-scale considerations

- **Concurrency & correctness** — N/A because this is a read path with no check-then-act, no shared state, and no writes. Classification is a pure function of one HTTP response.
- **Accuracy & auditability** — the Graph `request-id` / `client-request-id` currently reaching the browser is exactly what belongs in a log line instead. **Lean:** log the full envelope with the ids at the service layer (Pino, per the API style guide), and let the user-facing message carry none of it. That's strictly better for support: today the id is visible to the one person who can't use it and absent from the logs of the people who can.
- **Failure modes** — the predicate must **fail open to today's behavior**: an unrecognized Graph error stays `search_failed`/`head_failed`/`download_failed` → 502. **Lean: fail open,** because a false "your account has no OneDrive" sends a user to re-authorize an account that was fine, which is worse than an unhelpful 502.
- **Scale & unbounded growth** — N/A because nothing is accumulated, fanned out, or paginated by this change. The one bounded concern is that the `searchWorkbooks` BFS issues many `/children` calls, so an unlicensed tenant burns its node/result budget on repeated 400s; classifying at the boundary lets the walk abort on the first no-drive response instead of retrying its way through the queue. **Lean: abort the walk immediately on `no_drive`.**
- **Multi-tenancy** — per-org isolation is unchanged; credentials are already per-`ConnectorInstance`. Worth noting the inverse: this is a *tenant-shaped* failure in the Microsoft sense, and one org's users may legitimately span several Microsoft tenants, so the classification must stay per-instance and must never be cached against the org.
- **Contract stability** — the new `ApiCode` is the extension point. Shaping it as "a typed, remediable connector-precondition code" rather than "a Microsoft-Excel string" is what lets the reconnect affordance (`ConnectorInstance.view.tsx:86-103`) eventually branch on codes instead of substrings, and lets Google Sheets add its analogue without re-plumbing. **Lean:** name and document it as an eligibility-gate code in the `REST_API_MISSING_CREDENTIALS` family.
- **Data lifecycle** — N/A because nothing is persisted, windowed, or retained by this change.

## What this doesn't decide

- **Proactive detection at callback time** (open question 2). Deferred because it changes connector-creation semantics — whether an instance is even persisted for an account that can't work — which is a larger contract question than this bug's error path.
- **Retrofitting `onSearchError` onto the other eight consumers.** Deferred as scope: optional prop, unchanged behavior, and the core-level `catch` already removes the unhandled rejection everywhere.
- **Replacing `isAuthFailureMessage`'s substring match with structured codes** (`ConnectorInstance.view.tsx:86-103`). Adjacent and tempting, but it's a migration across every connector's auth-failure surface, not a line in this fix.
- **Narrowing `MICROSOFT_OAUTH_TENANT` away from `common`** (`microsoft-auth.service.ts:148`). Ruled out in #416 — business customers are the target and `consumers` would lock them out. `prompt=select_account` (`:160`) already offers the personal account at the picker.
- **The 43 stale doc pointers** found while scoping this (#417). The 3 in this connector's files are fixed on this branch because #416's implementation reads them; the rest are their own ticket.

## Next step

`docs/MICROSOFT_EXCEL_NO_ONEDRIVE.spec.md` fixes the contract — the `no_drive` predicate's exact match conditions, the 409 + `MICROSOFT_EXCEL_NO_ONEDRIVE` shape, the `onSearchError` prop signature, and the user-facing copy verbatim. Then `.plan.md` slices it roughly three ways, each independently green: (1) service-layer classification + kind, with unit tests over recorded Graph error bodies including the fail-open case; (2) `ApiCode` + router mapping + `@openapi` on all three routes; (3) `packages/core` error channel + `apps/web` wiring and the honest empty state, tested through `SelectWorkbookStep`'s pure UI component. Slice 1 carries the most test weight, since the predicate's false-positive behavior is the part that can make things worse than they are today.
