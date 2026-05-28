# API connector — Phase 4 — Plan

**TDD-sequenced implementation of phase 4: heuristic column inference util, in-process probe cache, shared `fetchFirstPage` helper, `ColumnDefinitionClassifier` dep + Haiku 4.5 default, real `discoverColumns` on the adapter, new probe route + SDK hook, and the `ProbeReviewStep` that replaces phase 1's `FieldMappingsStep` in the workflow. After this phase, the API connector is feature-complete for v1 — PR #71 graduates from draft to ready-for-review.**

Spec: `docs/API_CONNECTOR_PHASE_4.spec.md`. Phases 1–3: `docs/API_CONNECTOR_PHASE_{1,2,3}.{spec,plan}.md`.

Eight slices, each behind a green test suite. The first four slices are pure leaves with no live caller. Slice 5 wires `discoverColumns` to actually probe and consume the classifier. Slice 6 exposes it through a route. Slice 7 is the visible activation — the workflow swaps in the new step. Slice 8 locks behavior with an end-to-end test and confirms phase-1 manual mappings still work for legacy users.

Run tests with the same commands as phases 1–3.

The slices are sequenced so that:

- **Slice 1** lands `inferColumns` (heuristic-only) — biggest unit-test surface in this phase. Pure.
- **Slice 2** lands `ProbeCache` — small leaf with TTL semantics + invalidation.
- **Slice 3** lands `fetchFirstPage` — pulls out shared "drive iterator once, get records" code; retroactively refactors phase 2's `testConnection` to use it (no behavior change, pure refactor).
- **Slice 4** lands the `ColumnDefinitionClassifier` dep contract + a stub implementation + the default Haiku-backed implementation + the prompt builder. Pure leaf — no caller yet. Mirrors `apps/api/src/services/spreadsheet-parsing-llm.service.ts:101` patterns.
- **Slice 5** rewrites `RestApiAdapter.discoverColumns` from the phase-1 `return []` stub to the real probe + cache + heuristic + AI-assist flow. This is where the two inference layers come together. Adapter consumes a stub classifier in tests; production wiring is in this slice.
- **Slice 6** lands the new route + SDK hook (response shape now carries `suggestion` + `degradation`).
- **Slice 7** is the visible activation: swap `FieldMappingsStep` → `ProbeReviewStep` in `RestApiConnectorWorkflow`. New components for the per-endpoint section, inferred-columns table, Adopt-suggestion chip, degradation banner.
- **Slice 8** lands the end-to-end integration test against a mocked endpoint (covering happy path with suggestions, classifier-failure degradation, classifier-disabled, cache hit, force-refresh, fallback-to-manual), plus the manual smoke against a real public API.

After every slice, the repo type-checks, the existing test suite is green, and (through slice 6) the workflow's user-visible behavior is unchanged from phase 3.

---

## Slice 1 — `inferColumns` util

The biggest test surface in this phase. Inference rules cover empty inputs, primitive-only inputs, mixed-type fields, nested fields, and null/missing handling.

**Files**

- New: `apps/api/src/adapters/rest-api/inference.util.ts`
- New: `apps/api/src/__tests__/adapters/rest-api/inference.util.test.ts`

**Steps**

1. **Write the unit tests** for the full inference matrix:
   1. Empty input → `{ columns: [], samples: {} }`.
   2. Single record with two string fields → two `string` columns, both `required: true`, samples = the single value.
   3. 10 records with `age: number` everywhere → one `number` column, `required: true`, samples = first 5 distinct.
   4. 10 records with `age` as number in 9 of them, string in 1 → `string` (mixed-scalar collapse).
   5. 10 records with `age` as number in 9 of them, missing in 1 → `number`, `required: false`.
   6. 10 records with `tags: string[]` → `json` column, sample = first 5 distinct array values.
   7. 10 records with `meta: object` → `json`.
   8. 10 records with `id` always present and `note` sometimes null → `id: { required: true }`, `note: { required: false }`.
   9. 10 records all matching `{ value: "x" }` and 10 all matching `{ other: "y" }` → 2 columns (union of keys), both `required: false`.
   10. All records are primitives (e.g., array of strings) → one `value: json` column with first 5 elements as samples.
   11. Single record with mixed types per field (one record so no mixing happens) → each field gets its type from the single value.
   12. Records with > 25 length input — the util doesn't slice; that's the caller's job. The util processes everything passed in.
   13. Sample list length capped at 5 distinct values; duplicates don't fill it.
   14. Sample list excludes nulls.
   15. Required flag: a value of `null` (vs. missing) still counts as "value present" → `required: true` if all records have the key (even with null values). (Decision-point at implementation; document the chosen behavior in the test.)
   16. All-null field → `string`, `required: true` or `false` depending on the decision above.
   Run; all fail.

2. **Author the util** per spec. Helper functions: `classify(value): "null" | "string" | "number" | "boolean" | "object"`; `inferType(observedClasses: Set): ColumnDataType`; `collectSamples(records, key): unknown[]`.

3. **Run focused tests.** All 16 cases green.

4. **Lint + type-check.** Clean.

**Done when:** all 16 cases pass; no caller imports `inferColumns` yet.

---

## Slice 2 — `ProbeCache`

Small leaf with TTL semantics. Pure modulo `Date.now()`.

**Files**

- New: `apps/api/src/adapters/rest-api/probe-cache.util.ts`
- New: `apps/api/src/__tests__/adapters/rest-api/probe-cache.util.test.ts`

**Steps**

1. **Write the cache tests** (using `jest.useFakeTimers()` for time control):
   1. `get` on a missing key returns `null`.
   2. `set` then `get` within TTL returns the value.
   3. `set` then `get` after TTL returns `null`.
   4. `set` with custom TTL overrides the default.
   5. `invalidate(key)` after `set` makes `get` return `null` even within the original TTL window.
   6. `invalidate` on a missing key is a no-op (no throw).
   7. After expiry, `get` returns `null` AND prunes the expired entry (assert via `size()`).
   8. Two different keys are independent (set one, get the other).
   Run; fail.

2. **Author the class.** `Map<string, CacheEntry<T>>` backing store; lazy pruning on `get`.

3. **Run focused tests.** Green.

4. **Lint + type-check.** Clean.

**Done when:** all 8 cases pass; no caller uses the cache yet.

---

## Slice 3 — `fetchFirstPage` helper + `testConnection` refactor

Pull the "drive iterator once, get records out" code into a shared helper. Retroactively refactor phase-2's `testConnection` to use it. Behavior preserved end-to-end; this slice exists to deduplicate code before slice 4 adds a second caller.

**Files**

- New: `apps/api/src/adapters/rest-api/fetch-first-page.util.ts`
- New: `apps/api/src/__tests__/adapters/rest-api/fetch-first-page.util.test.ts`
- Edit: `apps/api/src/adapters/rest-api.adapter.ts` — refactor `testConnection` to use the helper. Other adapter code unchanged.
- Edit: `apps/api/src/__tests__/adapters/rest-api.adapter.test.ts` — phase-2 `testConnection` tests should still pass without changes (regression check).

**Steps**

1. **Write the helper tests:**
   1. `none` pagination: returns the first page's records; iterator is closed afterwards.
   2. `pageOffset` pagination: returns only page-1 records; second-page fetcher is never called.
   3. `cursor` pagination: returns page-1 records; cursor extraction happens but iterator is discarded.
   4. `linkHeader` pagination: returns page-1 records; Link header parsing happens but the next-link fetch never fires.
   5. Auth is applied (mocked `applyAuth` called once with the right args).
   6. Templating substitutes `{{pageNumber}}: 1` and `{{cursor}}: ""` on the first page.
   7. Returns both the parsed records and the raw `FetchedPage` for caller diagnostics.
   Run; fail.

2. **Author the helper** per spec.

3. **Refactor `testConnection`** to call `fetchFirstPage` instead of inline single-fetch logic. The adapter's existing testConnection tests should pass without changes.

4. **Run focused tests.** Helper tests + all phase-2 testConnection tests green.

5. **Lint + type-check.** Clean.

**Done when:** the helper is unit-tested; `testConnection` regression suite is unchanged; no duplication of "single page fetch" logic remains in the adapter.

---

## Slice 4 — `ColumnDefinitionClassifier` dep + Haiku 4.5 default

Pure leaf. Defines the dep type, ships a stub for tests, ships the default Haiku-backed implementation, ships the prompt builder. No caller yet — slice 5 wires it into the adapter.

Mirrors the spreadsheet LLM service (`apps/api/src/services/spreadsheet-parsing-llm.service.ts:101–233`) and prompt builder (`packages/spreadsheet-parsing/src/interpret/llm/prompt.ts:53–77`). Reuse those patterns verbatim where applicable — don't invent a parallel set of conventions.

**Files**

- New: `apps/api/src/adapters/rest-api/classifier.types.ts` — `ApiClassifierCandidate`, `ApiColumnClassification`, `ColumnDefinitionCatalogEntry`, `ColumnDefinitionClassifier` interface.
- New: `apps/api/src/adapters/rest-api/classifier.prompt.ts` — `buildApiClassifierPrompt(candidates, catalog)`. Lifts the spreadsheet's prompt structure; column-shaped instead of cell-shaped.
- New: `apps/api/src/adapters/rest-api/classifier.haiku.ts` — `createDefaultClassifier(env): ColumnDefinitionClassifier`. Calls `generateObject` with Haiku 4.5. `pLimit(8)` concurrency on a per-call basis (matches `DEFAULT_INTERPRET_CONCURRENCY`). Emits the same `interpret.llm.call` telemetry shape so dashboards aggregate it cleanly.
- New: `apps/api/src/adapters/rest-api/classifier.stub.ts` — `createStubClassifier(responses): ColumnDefinitionClassifier`. Returns canned `ApiColumnClassification[]` per the test fixture. Used by adapter + e2e tests in slices 5 and 8.
- New: `apps/api/src/__tests__/adapters/rest-api/classifier.haiku.test.ts` — unit tests against a mocked `generateObject`.
- New: `apps/api/src/__tests__/adapters/rest-api/classifier.prompt.test.ts` — snapshot test of the prompt's structure (asserts the catalog is rendered + candidates are listed + the JSON shape requested in the prompt matches the parse target).

**Steps**

1. **Define the type module** (`classifier.types.ts`). Pure type exports; no runtime code.

2. **Write the prompt-builder snapshot test.** Input: a 2-entry catalog + a 3-column candidate list. Output: a string that contains every catalog entry's `normalizedKey`, every candidate's `sourceField`, every sample (truncated to 5 per column), the response-shape contract. Snapshot the rendered prompt for regression detection.

3. **Author the prompt builder.** Templated string; sample values JSON-encoded with 80-char truncation per value. Catalog entries listed in a stable order (sorted by `normalizedKey`).

4. **Write the Haiku-classifier tests:**
   1. Successful Haiku response → parses into `ApiColumnClassification[]` with the right shape, one per candidate.
   2. Haiku returns extra classifications for unknown `sourceField`s → filtered out (silent drop).
   3. Haiku returns fewer classifications than candidates → missing candidates get no entry (caller handles via the merge step in slice 5).
   4. Haiku response is malformed JSON → throws `ClassifierError("malformed-response")`.
   5. Haiku request times out → throws `ClassifierError("timeout")`.
   6. `pLimit(8)` honored: invoking `classify` with 16 candidates results in `generateObject` being called in two batches of 8 (assertable via mock call ordering).
   7. Telemetry event emitted on each call (assert `logger.info` called with `interpret.llm.call`).

5. **Author the Haiku classifier** per the spreadsheet pattern. The exact `generateObject` call mirrors `apps/api/src/services/spreadsheet-parsing-llm.service.ts:112–165`; only the prompt + output schema differ.

6. **Author the stub classifier.** Trivial: returns the canned response array verbatim.

7. **Run focused tests.** Clean.

8. **Lint + type-check.** Clean.

**Done when:** dep contract + Haiku default + stub are tested in isolation; no caller imports them yet.

---

## Slice 5 — `RestApiAdapter.discoverColumns` real implementation (heuristic + AI-assist)

Replace the phase-1 stub that returned `[]`. Wire `ProbeCache` + `fetchFirstPage` + `inferColumns` + the slice-4 classifier dep. Add the `discoverColumnsWithSamples` adapter method (or equivalent) that the route uses to access samples + suggestions + degradation alongside columns.

**Files**

- Edit: `apps/api/src/adapters/rest-api.adapter.ts` — implement `discoverColumns`, add `discoverColumnsWithSamples` (adapter-internal method exposed via the registry for the route). Consumes `deps.columnDefinitionClassifier` if wired.
- Edit: `apps/api/src/adapters/adapter.registry.ts` — inject a singleton `ProbeCache<InferenceResult>` + `createDefaultClassifier(env)` into `RestApiAdapter`.
- Edit: `apps/api/src/__tests__/adapters/rest-api.adapter.test.ts` — new cases (heuristic-only, classifier-success, classifier-failure, classifier-disabled).
- Edit: `packages/core/src/contracts/api-connector.contracts.ts` — define `DiscoveredColumnWithSuggestion` + `DiscoverColumnsResultSchema` per the spec.

**Steps**

1. **Write the adapter cases:**
   1. `discoverColumns` against a mock endpoint returning 10 records, **classifier wired with stub returning suggestions** → returns inferred `DiscoveredColumn[]`; `discoverColumnsWithSamples` returns `{ columns: DiscoveredColumnWithSuggestion[], samples, source: "live", recordsScanned: 10, degradation: null }`. Every column has a `suggestion`.
   2. Same as (1) but **classifier dep not wired** → `degradation: "llm-disabled"`; no `suggestion` fields.
   3. Same as (1) but **stub classifier throws** → `degradation: "llm-failed"`; heuristic columns still returned; logger called at error level.
   4. Same as (1) but stub returns classifications for a different `sourceField` set (LLM hallucination) → only matching ones produce `suggestion`s; unknown ones dropped silently.
   5. Second call within TTL returns the cached columns + suggestions + degradation; mock `fetch` called once; classifier called once.
   6. Second call after TTL re-probes both the fetch AND the classifier (cache invalidates the whole package).
   7. `discoverColumns` against an endpoint returning 0 records → returns `[]`; classifier is not called (no candidates).
   8. `discoverColumns` against an endpoint that 401s → throws `REST_API_AUTH_FAILED`; cache is NOT populated; classifier is not called.
   9. The 25-record slice is enforced: a mock returning 100 records causes the inference util to be called with 25 records; classifier candidates use samples from those 25.
   10. After explicit cache invalidation, the next call re-probes both layers.
   Run; fail.

2. **Implement `discoverColumns`** per the spec pseudocode. Resolve endpoint config → check cache → drive `fetchFirstPage` → slice to MAX_RECORDS_SCANNED → heuristic infer → if classifier wired: build candidates + load catalog + call classifier in try/catch → merge by `sourceField` → cache the merged result → return.

3. **Implement `discoverColumnsWithSamples`** that's identical but exposes the samples + source + recordsScanned + degradation. Route uses this.

4. **Register the cache singleton + classifier** in the adapter registry. Wire `createDefaultClassifier(env)` from slice 4.

5. **Define `DiscoveredColumnWithSuggestion` + `DiscoverColumnsResultSchema`** in `@portalai/core/contracts`.

6. **Run focused tests.** All 10 cases green; prior adapter tests still green.

7. **Lint + type-check.** Clean.

**Done when:** discoverColumns runs heuristic + (optionally) AI-assist; falls back gracefully on every classifier failure mode; cache holds the merged result.

---

## Slice 6 — Route + SDK hook

Wire the new route into the connector-instances router; ship the `useDiscoverColumns` SDK hook on the web side. The response carries the slice-5 `degradation` + per-column `suggestion` fields.

**Files**

- Edit: `apps/api/src/routers/api-endpoints.router.ts` — add `POST /:entityId/discover-columns`.
- New: `apps/api/src/__tests__/__integration__/routers/api-endpoints.discover-columns.integration.test.ts`
- Edit: `apps/web/src/api/api-connector.api.ts` — add `useDiscoverColumns`.
- Edit: `apps/web/src/api/sdk.ts` — re-export.

**Steps**

1. **Write the route integration tests:**
   1. `POST /discover-columns` against an endpoint with mocked records → 200 + `DiscoverColumnsResult` with `source: "live"`, `degradation: null`, per-column suggestions.
   2. Second call within TTL → 200 + `source: "cache"` + `cachedAt` populated; suggestions persist from the cached result.
   3. `forceRefresh: true` invalidates cache → `source: "live"` again.
   4. With the classifier dep wired to a throwing stub → 200 + `degradation: "llm-failed"`; columns present without suggestions; error logged.
   5. 401 from upstream → 502 + `REST_API_AUTH_FAILED`.
   6. Endpoint not found → 404 + `REST_API_ENDPOINT_NOT_FOUND`.
   7. Non-REST-API instance → 404 (per the existing middleware).
   Run; fail.

2. **Author the route.** Resolve endpoint → call `discoverColumnsWithSamples` (with cache invalidate first if `forceRefresh`) → respond.

3. **Author the SDK hook.** `useDiscoverColumns()` returns the `useAuthMutation` handle.

4. **Run focused tests.** Route + (web) SDK tests green.

5. **Lint + type-check.** Clean.

**Done when:** the route round-trips correctly through the case matrix including the degradation paths; the SDK hook is callable from React but no component uses it yet.

---

## Slice 7 — `ProbeReviewStep` (the visible activation)

Replace `FieldMappingsStep` in the workflow. Container + per-endpoint section + inferred-columns table with Adopt-suggestion chips + degradation banner.

**Files**

- New: `apps/web/src/workflows/RestApiConnector/ProbeReviewStep.component.tsx` (container + `ProbeReviewStepUI`)
- New: `apps/web/src/workflows/RestApiConnector/EndpointColumnReview.component.tsx` (per-endpoint section + `EndpointColumnReviewUI`)
- New: `apps/web/src/workflows/RestApiConnector/InferredColumnsTable.component.tsx` (editable table + `InferredColumnsTableUI`)
- New: `apps/web/src/workflows/RestApiConnector/SuggestionChip.component.tsx` (Adopt-suggestion chip with confidence + rationale tooltip)
- New: `apps/web/src/workflows/RestApiConnector/DegradationBanner.component.tsx` (advisory `<Alert>` when `degradation !== null`)
- Edit: `apps/web/src/workflows/RestApiConnector/RestApiConnectorWorkflow.component.tsx` — swap `FieldMappingsStep` → `ProbeReviewStep` in the step list; commit-time payload writes one `field_mapping` per row in each endpoint's draft (carrying `columnDefinitionId` when the row adopted a suggestion).
- Edit: `apps/web/src/workflows/RestApiConnector/utils/rest-api-validation.util.ts` — add per-column-row validation (normalizedKey required + unique within endpoint; type valid).
- Delete: `apps/web/src/workflows/RestApiConnector/FieldMappingsStep.component.tsx` + its tests + stories.
- New: `apps/web/src/workflows/RestApiConnector/__tests__/ProbeReviewStep.test.tsx`
- New: `apps/web/src/workflows/RestApiConnector/__tests__/EndpointColumnReview.test.tsx`
- New: `apps/web/src/workflows/RestApiConnector/__tests__/InferredColumnsTable.test.tsx`
- New: `apps/web/src/workflows/RestApiConnector/__tests__/SuggestionChip.test.tsx`
- New: `apps/web/src/workflows/RestApiConnector/__tests__/DegradationBanner.test.tsx`
- Edit: `apps/web/src/workflows/RestApiConnector/__tests__/RestApiConnectorWorkflow.test.tsx` — step-list assertion now expects ProbeReviewStep.
- New: `apps/web/src/workflows/RestApiConnector/stories/ProbeReviewStep.stories.tsx`

**Steps**

1. **Write the component tests** for each `*UI`:
   - `SuggestionChipUI`:
     1. Renders the suggested normalizedKey + columnDefinition label + confidence percentage.
     2. Click invokes `onAdopt` with the suggestion payload.
     3. Low-confidence suggestions (< 0.5) render with disabled state + tooltip "Low confidence; review carefully".
     4. Hover shows the LLM rationale.
   - `DegradationBannerUI`:
     1. `degradation: "llm-failed"` renders an info alert with the right copy.
     2. `degradation: "llm-disabled"` renders nothing (silent — the spec calls for this).
     3. `degradation: null` renders nothing.
   - `InferredColumnsTableUI`:
     1. Renders one row per inferred column.
     2. Editing a row's `normalizedKey` calls `onChange` with the new value.
     3. Type dropdown shows all `ColumnDataType` options; selecting one calls `onChange`.
     4. Required checkbox toggles call `onChange`.
     5. Sample value preview renders truncated JSON (long strings ellipsized).
     6. Rows with `suggestion` render a `SuggestionChipUI`; Adopt copies suggestion into the editable fields.
     7. "Add column" button appends an empty row (no suggestion).
     8. Remove-row buttons remove the row.
     9. Duplicate `normalizedKey` shows a validation error on both rows.
   - `EndpointColumnReviewUI`:
     1. Loading state renders a spinner.
     2. Success state renders `DegradationBannerUI` + `InferredColumnsTableUI` populated from props.
     3. Error state renders `<FormAlert>` + a "Try manual entry" button that flips to an empty manual table.
     4. Empty-records state renders a hint + Add-column button.
     5. "Re-probe" button calls the `onReprobe` callback.
     6. Existing field_mappings are overlaid: a mapping that matches an inferred column's sourceField shows "Already configured" badge.
   - `ProbeReviewStepUI`:
     1. Renders one `EndpointColumnReviewUI` per endpoint.
     2. Validates all sections before allowing `onNext`.

2. **Write the validation util tests** for the new per-column-row checks.

3. **Author the components** following the Component File Policy. Each `*UI` is purely props-driven; containers wire SDK hooks.

4. **Wire workflow container.** Swap the step in the workflow's step array; remove `FieldMappingsStep` imports; carry the per-endpoint column drafts (including any `columnDefinitionId` set via Adopt) in the container's state; commit-time materializes them as field-mapping inserts.

5. **Delete `FieldMappingsStep` files** (component, tests, stories).

6. **Run focused tests.** All new tests green; workflow integration test reflects the new step.

7. **Storybook smoke.** New stories render without console errors. Include a story with `degradation: "llm-failed"` so the banner is visible in isolation.

8. **Lint + type-check.** Clean.

**Done when:** the workflow shows the new step; users can probe, review, edit, add, remove columns, and adopt suggestions; the commit-time writes match phase 1's field-mapping shape (now optionally carrying `columnDefinitionId`).

---

## Slice 8 — End-to-end integration + manual smoke

Lock the full pipeline behind an integration test; manually verify against a real public API.

**Files**

- New: `apps/api/src/__tests__/__integration__/connectors/rest-api.probe.integration.test.ts`

**Steps**

1. **Write the integration test:**
   1. Seed: org + user + REST API connector definition + instance + endpoint with `recordsPath: "items"` + `pagination: { strategy: "none" }` + a small `column_definitions` catalog containing entries that loosely match the test data (e.g. `firstName`, `email`, `age`).
   2. Stub `fetchJson` to return a 25-record array of `{ id, name, age, tags }` objects (mixed nested + scalar to exercise inference).
   3. Register a stub `ColumnDefinitionClassifier` that returns plausible classifications for the 4 candidates.
   4. POST `/discover-columns` → assert response: 4 columns (`id: string`, `name: string`, `age: number`, `tags: json`), each with samples populated, `source: "live"`, `degradation: null`, each column carries a `suggestion`.
   5. Second POST without `forceRefresh` → `source: "cache"`; `fetch` called exactly once across both requests; classifier called exactly once.
   6. POST with `forceRefresh: true` → cache invalidated, `source: "live"`, `fetch` called twice total, classifier called twice total.
   7. Re-register the classifier as a throwing stub → POST returns 200 + `degradation: "llm-failed"`; columns still present; no `suggestion` fields.
   8. Unregister the classifier dep (or set to `null`) → POST returns 200 + `degradation: "llm-disabled"`; columns still present.
   9. Stub `fetch` to throw 401 → POST returns 502 + `REST_API_AUTH_FAILED`; cache state unchanged; classifier never invoked.

2. **Run focused test.** Green deterministically across re-runs.

3. **Manual smoke** (checklist, executed by the implementer):
   - Boot the stack.
   - Configure an API connector against `https://api.github.com/users/EnterpriseBT/repos` (no auth needed for low-volume reads) with `recordsPath: ""`, `pagination: { strategy: "linkHeader" }`.
   - Navigate to the probe-review step.
   - Confirm inferred columns include `id` (number), `name` (string), `full_name` (string), `owner` (json), `private` (boolean), etc.
   - Edit a column's `normalizedKey`; commit.
   - Confirm `field_mappings` rows are created per the draft.
   - Run a sync; confirm `entity_records` populates with the right columns.

4. **Flip PR #71 from draft to ready-for-review.** All four phases of docs landed; the implementation is the next chapter.

5. **Lint + type-check.** Clean.

**Done when:** the e2e test passes, the smoke produces real GitHub-repo records flowing through inferred + reviewed columns, and PR #71 is ready-for-review.

---

## Cross-cutting notes

- **`FieldMappingsTable` module is not deleted.** Other connectors (file upload, Google Sheets, etc.) still embed it. Only the REST API workflow's wrapping `FieldMappingsStep` goes away.
- **`discoverColumns` interface is unchanged** — the cross-cutting widening from phase 2 (`testConnection`, `toPublicAccountInfo`) is not repeated here. The richer payload (samples + source + recordsScanned + degradation + suggestions) flows through the route layer, not through the adapter interface itself.
- **AI-assist mirrors the spreadsheet pattern.** Lift conventions verbatim from `apps/api/src/services/spreadsheet-parsing-llm.service.ts` and `packages/spreadsheet-parsing/src/interpret/llm/prompt.ts` — same Haiku 4.5 default, same `pLimit(8)` concurrency cap, same `interpret.llm.call` telemetry shape, same heuristic-fallback discipline. If the spreadsheet patterns ever change, the API connector inherits the change with minimal rework.
- **Cache holds heuristic + AI together.** The 60-second TTL covers both layers as one unit. Re-probe (or forceRefresh) re-fires both. No partial cache state (heuristic cached but AI re-fetched, or vice versa) — keeps the mental model simple.
- **Cache singleton lifecycle.** One `ProbeCache` instance per Node process; injected at adapter registration. Tests that need a fresh cache get a new instance per test via the test harness's adapter factory.
- **Classifier dep is per-process, not per-org.** One default classifier wired at registry construction. Different orgs share the underlying Haiku endpoint; the only per-org variation is the catalog passed into `classify()`.
- **Logging discipline.** Classifier inputs (candidates + catalog) and outputs are logged at `debug` level; do NOT log sample values at info level — they may contain user data. Mirror the spreadsheet pipeline's per-call telemetry but redact sample payloads in any aggregated cost-summary event.
- **No new job type, no new SSE channel, no new migration.** Phase 4 adds code surface only — no schema changes.
- **Phase 1 manually-declared mappings keep working** through the existing field-mapping routes + the probe-review step's "existing mappings" overlay. The Edit flow for an instance configured pre-phase-4 routes through the same step; users see their existing mappings (marked "Already configured") and can adopt new inferences alongside them.
- **After phase 4 lands, the PR has all four phases of docs.** Implementation work starts immediately afterward or in a follow-up cycle; the docs are the contract the implementer follows.
