# Microsoft Excel no-OneDrive error surfacing — Plan

**TDD-sequenced implementation of the no-drive classification: the `no_drive` kind + Graph-envelope predicate, the 409 `MICROSOFT_EXCEL_NO_ONEDRIVE` mapping, the `AsyncSearchableSelect` error channel, the select-workbook wiring, and the 4xx no-retry policy.**

Spec: `docs/MICROSOFT_EXCEL_NO_ONEDRIVE.spec.md`. Discovery: `docs/MICROSOFT_EXCEL_NO_ONEDRIVE.discovery.md`. Issue: #416. No dependency on unshipped work — everything extends code live on `main`.

Five slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `fix/microsoft-excel-no-onedrive`** — one fix, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly):

```bash
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd packages/core && npm run test:unit
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — the classification is a pure function of one HTTP response, so it is fully testable before anything maps it to a status or renders it:

- **Slice 1** — the predicate + parser + the `no_drive` kind, inside the Graph service. Carries the fail-open proof (the part that can make things worse than today) and the body-stripping. Still surfaces as a 502, because nothing maps the new kind yet.
- **Slice 2** — `ApiCode` + router mapping + the `@openapi` blocks. The API contract is complete and verifiable by integration test at this boundary; the frontend still can't show it.
- **Slice 3** — the `packages/core` error channel. Independent of slices 1–2; sequenced here so slice 4 has no forward dep.
- **Slice 4** — the `apps/web` wiring + honest empty state. This is the slice that makes the fix visible to a user.
- **Slice 5** — the 4xx no-retry policy. Deliberately last and alone: it is the one change that touches every query and mutation in the app, so it reviews and reverts independently of the rest.

No migration, no seed — no schema change (spec § Migration / Seed).

---

## Slice 1 — `no_drive` classification in the Graph service

The predicate, the envelope parser, the new kind, the logger, and the removal of raw Graph bodies from thrown messages. Nothing maps `no_drive` yet, so the observable API behavior is unchanged — a no-drive account still gets a 502, just without the leaked body.

**Files**

- Edit: `apps/api/src/services/microsoft-graph.service.ts` — add `"no_drive"` to `MicrosoftGraphErrorKind` (`:45`); add module-private `parseGraphError` + `isNoDriveError`; add `createLogger({ module: "microsoft-graph" })`; rework the four non-ok throw sites (`:190`, `:233`, `:265`, `:295`); correct the `searchWorkbooks` docstring's `/me/drive/search` claim.
- Edit: `apps/api/src/__tests__/services/microsoft-graph.service.test.ts` — the classification cases.

**Steps**

1. **Tests (spec cases 1–13).** In the existing `searchWorkbooks` (`:40`), `headWorkbook` (`:255`), and `downloadWorkbook` (`:294`) describe blocks: the SPO-license 400 → `no_drive` and its message carrying the remedy copy with no `request-id` (1, 2); root 404 / 403 → `no_drive` (3, 4); the `atDriveRoot` gate — a depth-≥1 folder 404 stays `search_failed` (5); fail-open on a different `error.code`, a message without "SPO license", and a non-JSON body (6, 7, 8); `headWorkbook`/`downloadWorkbook` SPO-license → `no_drive` (9, 11) but item-level 404/403 → their existing kinds (10, 12); the three existing messages no longer contain the body (13). Run; fail.
2. **Implement** the parser, the predicate with `atDriveRoot` threaded from the BFS (`true` only at `folderId === "root"`, `depth === 0`), the logger call on every non-ok branch, and the four rebuilt throws. Green.
3. Lint + type-check.

**Done when:** cases 1–13 pass, the pre-existing `:239` case (401 → `search_failed`) is still green untouched, and `no_drive` is thrown but mapped nowhere.

**Risk:** the fail-open cases are the point of this slice — if 6, 7, or 8 are weak, a mis-parse silently becomes a false no-drive verdict for real users. Assert the resulting `kind` in each, not just the absence of a throw.

---

## Slice 2 — `ApiCode` + 409 mapping + `@openapi`

The API contract. After this slice a no-drive account gets a 409 with a remediable code and copy on all three `/me/drive`-backed routes.

**Files**

- Edit: `apps/api/src/constants/api-codes.constants.ts` — `MICROSOFT_EXCEL_NO_ONEDRIVE` appended to the `// Microsoft Excel connector data ops` group (`:331-337`), with the eligibility-gate JSDoc from the spec.
- Edit: `apps/api/src/routes/microsoft-excel-connector.router.ts` — `case "no_drive"` → `409` in `mapMicrosoftGraphError` (`:243`); `409` added to the `@openapi` responses of `GET /workbooks` (`:279-302`) and `POST /instances/:id/select-workbook` (`:337-368`); a **whole `responses:` section** added to `GET /instances/:id/sheet-slice` (`:403-435`), which has none today.
- Edit: `apps/api/src/__tests__/__integration__/routes/microsoft-excel-connector.router.integration.test.ts` — the per-route status cases.

**Steps**

1. **Tests (spec cases 14–18).** In the `/workbooks` (`:604`), select-workbook (`:705`), and sheet-slice (`:876`) describe blocks: an SPO-license 400 from the mocked Graph fetch → `409` + `MICROSOFT_EXCEL_NO_ONEDRIVE` + remedy copy (14, 15, 16); an unrecognized Graph 500 → still `502 MICROSOFT_EXCEL_LIST_FAILED` (17); the 409 body carries no Graph `request-id` (18). Run; fail.
2. **Implement** the enum entry, the mapper case, and the three `@openapi` edits. Green.
3. Lint + type-check.

**Done when:** cases 14–18 pass; `GET /api/docs/spec` renders a `409` for all three routes and a full `responses:` block for sheet-slice.

**Risk:** the sheet-slice `responses:` section is new prose, not a behavior change — but it must reference the payload component the handler actually returns, not an invented one. Read the handler's response shape before writing the `200`.

---

## Slice 3 — `onSearchError` on the async selects

The `packages/core` error channel. Options are cleared on a rejected search, and consumers that pass the new optional prop hear about it. No consumer passes it yet.

**Files**

- Edit: `packages/core/src/ui/searchable-select/AsyncSearchableSelect.tsx` — `onSearchError?: (error: unknown) => void` on the props interface (`:10-24`); a `catch` on all three promise paths (`:56`, `:66`, `:86`), each clearing state and invoking the callback under the existing `cancelled` guard.
- Edit: `packages/core/src/ui/searchable-select/MultiAsyncSearchableSelect.tsx` — the identical prop and catches (`:47-77`).
- Edit: `packages/core/src/__tests__/ui/SearchableSelect.test.tsx` (async block at `:91`) and `MultiSearchableSelect.test.tsx` (`:211`).

**Steps**

1. **Tests (spec cases 19–26).** Debounced rejection → `onSearchError` called once, options cleared, loading cleared (19, 20, 24); initial `onSearch("")` rejection → callback fired, no unhandled rejection (21); `loadSelectedOption` rejection → callback fired, spinner clears (22); rejection with **no** callback passed → no throw, options still cleared (23); cases 19 + 20 repeated for `MultiAsyncSearchableSelect` (25, 26). Run; fail.
2. **Implement** the prop and the six catches (three per component). Green.
3. Lint + type-check.

**Done when:** cases 19–26 pass and the existing `SearchableSelect` / `MultiSearchableSelect` suites are green unchanged — the nine current consumers must behave exactly as before.

**Risk:** the unconditional option-clear is a behavior change for all nine consumers, not just this connector. It is the intended fix (a stale list behind a failed search is what hid this bug), but the existing suites are the guard — run the full `packages/core` unit suite at this boundary, not just the two touched files.

---

## Slice 4 — select-workbook wiring + honest empty state

The slice that makes the fix visible: a failed workbook search now renders the 409's copy in the step's existing `<FormAlert>`, and the empty state stops claiming there are no workbooks.

**Files**

- Edit: `apps/web/src/workflows/MicrosoftExcelConnector/utils/microsoft-excel-workflow.util.ts` — expose `setServerError: core.setServerError` on the hook's return object (`:258-291`).
- Edit: `apps/web/src/workflows/MicrosoftExcelConnector/MicrosoftExcelConnectorWorkflow.component.tsx` — `try/catch` in `handleSearchWorkbooks` (`:272-286`): clear `serverError` on success, set it and **re-throw** on failure so core clears its options.
- Edit: `apps/web/src/workflows/MicrosoftExcelConnector/SelectWorkbookStep.component.tsx` — `SEARCH_FAILED_LABEL` and an error-aware `noOptionsText` (`:31`).
- Edit: `apps/web/src/workflows/MicrosoftExcelConnector/__tests__/SelectWorkbookStep.test.tsx` and `utils/__tests__/microsoft-excel-workflow.util.test.tsx`.

**Steps**

1. **Tests (spec cases 27–30).** `serverError` set → `<FormAlert>` renders message + code (27); `serverError` set → empty state reads "Workbook search failed", not "No workbooks found" (28); `serverError` null with zero results → the original copy, guarding the existing `:51` case (29); `setServerError` is exposed on the hook's return (30). Run; fail.
2. **Implement** the setter exposure, the try/catch/re-throw, and the conditional `noOptionsText`. Green.
3. Lint + type-check.

**Done when:** cases 27–30 pass and the existing `SelectWorkbookStep` / workflow-util suites are green.

**Risk:** the re-throw is load-bearing and easy to lose in review — without it `AsyncSearchableSelect` never learns the search failed and keeps a stale option list. Slice 3's catch is what makes the re-throw safe; that ordering is why this slice follows it.

---

## Slice 5 — stop retrying 4xx

The retry policy, alone in its own commit because it touches every query and mutation in the app.

**Files**

- Edit: `apps/web/src/client.ts` — a `status >= 400 && status < 500 → false` short-circuit in both `queries.retry` (`:19-25`) and `mutations.retry` (`:27-33`), after the existing 401 / `ORGANIZATION_USER_NOT_FOUND` rules.
- New: `apps/web/src/__tests__/client.test.ts` — nothing covers `client.ts` today.

**Steps**

1. **Tests (spec cases 31–34).** `retry` → `false` for a 409 and for a 404 `ApiError` (31, 32); `true` under three failures for a 502 (33); still `false` for 401 and for `ORGANIZATION_USER_NOT_FOUND` (34). Assert both the query and mutation predicates. Run; fail.
2. **Implement** the two-line short-circuit. Green.
3. Lint + type-check.

**Done when:** cases 31–34 pass and a failed workbook search is issued **once** rather than four times (the acceptance criterion this slice owns).

**Risk:** the widest-reach change in the PR. If a 4xx somewhere in the app was silently relying on retry to paper over a race, this exposes it — which is the correct outcome, but worth watching in the smoke walk. Revertible on its own.

---

## Sequence summary

| Slice | What lands | Gating check |
|---|---|---|
| 1 | `no_drive` kind, envelope parser, `atDriveRoot` predicate, logger, body-stripping | `apps/api` unit cases 1–13 + the pre-existing 401 case |
| 2 | `MICROSOFT_EXCEL_NO_ONEDRIVE`, 409 mapping, three `@openapi` blocks | `apps/api` integration cases 14–18 |
| 3 | `onSearchError` + six catches in `packages/core` | `packages/core` unit cases 19–26 + full existing select suites |
| 4 | `setServerError` exposed, try/catch/re-throw, error-aware empty state | `apps/web` unit cases 27–30 |
| 5 | 4xx no-retry in the query client | `apps/web` unit cases 31–34 |

## Cross-slice notes

- **Rebuild `@portalai/core` between slices 3 and 4.** `apps/web` type-checks against core's git-ignored `dist/`, so slice 4's `npm run type-check` will not see slice 3's new `onSearchError` prop until core is rebuilt. Run `npm run build` in `packages/core` at the slice-3 boundary or slice 4's type-check throws a spurious error.
- **Slice 1 is observable-behavior-neutral by design.** A no-drive account still gets a 502 at its boundary (nothing maps the kind). That is intentional, not an incomplete slice — the mapping is slice 2's whole job.
- **The remedy copy is defined once, in the service** (slice 1), and passed through the router unchanged (slice 2). If it needs rewording later, there is one place to change it — don't let a second copy appear in the router or the frontend.
- **Doc sync (`CLAUDE.md` → "Keeping Documentation in Sync with Capabilities").** Checked against the inventory: no new domain concept (no `glossary.util.ts` / `faq.util.ts` entry), no workflow step added or reordered (no `getting-started.util.ts` change), no tool contract touched, no CLI or convention change (no `CLAUDE.md` / `copilot-instructions.md` edit). The one surface that *is* in the inventory is **in-workflow helper text** — `SelectWorkbookStep`'s empty-state copy — and it changes inside slice 4 rather than as a separate pass. The stale `searchWorkbooks` docstring is corrected in slice 1.
- **The three stale doc pointers already removed on this branch** (`microsoft-excel-connector.router.ts`, `microsoft-auth.service.ts`, `environment.ts`) are unrelated to any slice; they can ride slice 1's commit or stand as their own `docs:` commit. The remaining 43 are #417.
- **`/smoke` runs after slice 5**, mapping the spec's acceptance criteria to a manual walk. The walk needs an account with no OneDrive — the `bbgrabbag_gmail.com#EXT#@bbgrabbaggmail.onmicrosoft.com` guest identity from #416's evidence reproduces it on app-dev.

## Next step

Implementation begins on `fix/microsoft-excel-no-onedrive`, slice 1 first, tests-first, one commit per slice — only after discovery, spec, and plan are reviewed and confirmed.
