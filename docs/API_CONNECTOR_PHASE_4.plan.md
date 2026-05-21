# API connector — Phase 4 — Plan

**TDD-sequenced implementation of phase 4: column inference util, in-process probe cache, shared `fetchFirstPage` helper, real `discoverColumns` on the adapter, new probe route + SDK hook, and the `ProbeReviewStep` that replaces phase 1's `FieldMappingsStep` in the workflow. After this phase, the API connector is feature-complete for v1 — PR #71 graduates from draft to ready-for-review.**

Spec: `docs/API_CONNECTOR_PHASE_4.spec.md`. Phases 1–3: `docs/API_CONNECTOR_PHASE_{1,2,3}.{spec,plan}.md`.

Seven slices, each behind a green test suite. The first three slices are pure leaves with no live caller. Slice 4 wires `discoverColumns` to actually probe. Slice 5 exposes it through a route. Slice 6 is the visible activation — the workflow swaps in the new step. Slice 7 locks behavior with an end-to-end test and confirms phase-1 manual mappings still work for legacy users.

Run tests with the same commands as phases 1–3.

The slices are sequenced so that:

- **Slice 1** lands `inferColumns` — biggest unit-test surface in this phase. Pure.
- **Slice 2** lands `ProbeCache` — small leaf with TTL semantics + invalidation.
- **Slice 3** lands `fetchFirstPage` — pulls out shared "drive iterator once, get records" code; retroactively refactors phase 2's `testConnection` to use it (no behavior change, pure refactor).
- **Slice 4** rewrites `RestApiAdapter.discoverColumns` from the phase-1 `return []` stub to the real probe + cache + infer flow.
- **Slice 5** lands the new route + SDK hook. After this slice the probe is reachable from the frontend, but the workflow doesn't render it yet.
- **Slice 6** is the visible activation: swap `FieldMappingsStep` → `ProbeReviewStep` in `RestApiConnectorWorkflow`. New components for the per-endpoint section, inferred-columns table, etc.
- **Slice 7** lands the end-to-end integration test against a mocked endpoint (covering happy path, cache hit, force-refresh, fallback-to-manual), plus the manual smoke against a real public API.

After every slice, the repo type-checks, the existing test suite is green, and (through slice 5) the workflow's user-visible behavior is unchanged from phase 3.

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

## Slice 4 — `RestApiAdapter.discoverColumns` real implementation

Replace the phase-1 stub that returned `[]`. Wire `ProbeCache` + `fetchFirstPage` + `inferColumns`. Add the `discoverColumnsWithSamples` adapter method (or equivalent) that the route uses to access samples alongside columns.

**Files**

- Edit: `apps/api/src/adapters/rest-api.adapter.ts` — implement `discoverColumns`, add `discoverColumnsWithSamples` (adapter-internal method exposed via the registry for the route).
- Edit: `apps/api/src/adapters/adapter.registry.ts` — inject a singleton `ProbeCache<InferenceResult>` into `RestApiAdapter`.
- Edit: `apps/api/src/__tests__/adapters/rest-api.adapter.test.ts` — new cases.

**Steps**

1. **Write the adapter cases:**
   1. `discoverColumns` against a mock endpoint returning 10 records → returns inferred `DiscoveredColumn[]` (full structure asserted).
   2. Second call within TTL returns the cached columns; the mock `fetch` is called exactly once across the two calls.
   3. Second call after TTL re-probes; `fetch` is called twice.
   4. `discoverColumns` against an endpoint returning 0 records → returns `[]`.
   5. `discoverColumns` against an endpoint that 401s → throws `REST_API_AUTH_FAILED` (per phase 2's classification); cache is NOT populated.
   6. `discoverColumnsWithSamples` returns `{ columns, samples, source: "live" | "cache", recordsScanned }`. The `source` field flips from `"live"` on first call to `"cache"` on second.
   7. The 25-record slice is enforced: a mock returning 100 records causes the inference util to be called with 25 records.
   8. After explicit cache invalidation, the next call re-probes.
   Run; fail.

2. **Implement `discoverColumns`** per the spec pseudocode. Resolve endpoint config → check cache → drive `fetchFirstPage` → slice to MAX_RECORDS_SCANNED → infer → cache → return.

3. **Implement `discoverColumnsWithSamples`** that's identical but exposes the samples + source + recordsScanned. Route uses this; the public `discoverColumns` interface method exposes only `columns` (the existing contract).

4. **Register the cache singleton** in the adapter registry (or in the `RestApiAdapter` factory invocation in slice-7 phase-1's activation slice — but adjust to inject the cache here).

5. **Run focused tests.** All 8 green; prior adapter tests still green.

6. **Lint + type-check.** Clean.

**Done when:** discoverColumns probes, caches, infers, and falls back to existing behavior on errors.

---

## Slice 5 — Route + SDK hook

Expose `discoverColumnsWithSamples` through a new POST route + a frontend SDK hook. After this slice the probe is reachable from the frontend but the workflow doesn't render it.

**Files**

- Edit: `apps/api/src/routers/api-endpoints.router.ts` — add `POST /:entityId/discover-columns`.
- New: `apps/api/src/__tests__/__integration__/routers/api-endpoints.discover-columns.integration.test.ts`.
- Edit: `packages/core/src/contracts/api-connector.contracts.ts` (or wherever the existing `TestConnectionResult` lives) — add `DiscoverColumnsResultSchema`.
- Edit: `apps/web/src/api/api-connector.api.ts` — add `useDiscoverColumns`.
- Edit: `apps/web/src/api/sdk.ts` — re-export.

**Steps**

1. **Write the route integration tests:**
   1. `POST /discover-columns` against an endpoint with mocked records → 200 + `DiscoverColumnsResult` with `source: "live"`.
   2. Second call within TTL → 200 + `source: "cache"` + `cachedAt` populated.
   3. `forceRefresh: true` invalidates cache → `source: "live"` again.
   4. 401 from upstream → 502 + `REST_API_AUTH_FAILED`.
   5. Endpoint not found → 404 + `REST_API_ENDPOINT_NOT_FOUND`.
   6. Non-REST-API instance → 404 (per the existing middleware).
   Run; fail.

2. **Define `DiscoverColumnsResultSchema`** in `@portalai/core`.

3. **Author the route.** Resolve endpoint → call `discoverColumnsWithSamples` (with cache invalidate first if `forceRefresh`) → respond.

4. **Author the SDK hook.** `useDiscoverColumns()` returns the `useAuthMutation` handle.

5. **Run focused tests.** Route + (web) SDK tests green.

6. **Lint + type-check.** Clean.

**Done when:** the route round-trips correctly through the case matrix; the SDK hook is callable from React but no component uses it yet.

---

## Slice 6 — `ProbeReviewStep` (the visible activation)

Replace `FieldMappingsStep` in the workflow. Container + per-endpoint section + inferred-columns table.

**Files**

- New: `apps/web/src/workflows/RestApiConnector/ProbeReviewStep.component.tsx` (container + `ProbeReviewStepUI`)
- New: `apps/web/src/workflows/RestApiConnector/EndpointColumnReview.component.tsx` (per-endpoint section + `EndpointColumnReviewUI`)
- New: `apps/web/src/workflows/RestApiConnector/InferredColumnsTable.component.tsx` (editable table + `InferredColumnsTableUI`)
- Edit: `apps/web/src/workflows/RestApiConnector/RestApiConnectorWorkflow.component.tsx` — swap `FieldMappingsStep` → `ProbeReviewStep` in the step list; commit-time payload writes one `field_mapping` per row in each endpoint's draft.
- Edit: `apps/web/src/workflows/RestApiConnector/utils/rest-api-validation.util.ts` — add per-column-row validation (normalizedKey required + unique within endpoint; type valid).
- Delete: `apps/web/src/workflows/RestApiConnector/FieldMappingsStep.component.tsx` + its tests + stories.
- New: `apps/web/src/workflows/RestApiConnector/__tests__/ProbeReviewStep.test.tsx`
- New: `apps/web/src/workflows/RestApiConnector/__tests__/EndpointColumnReview.test.tsx`
- New: `apps/web/src/workflows/RestApiConnector/__tests__/InferredColumnsTable.test.tsx`
- Edit: `apps/web/src/workflows/RestApiConnector/__tests__/RestApiConnectorWorkflow.test.tsx` — step-list assertion now expects ProbeReviewStep.
- New: `apps/web/src/workflows/RestApiConnector/stories/ProbeReviewStep.stories.tsx`

**Steps**

1. **Write the component tests** for each `*UI`:
   - `InferredColumnsTableUI`:
     1. Renders one row per inferred column.
     2. Editing a row's `normalizedKey` calls `onChange` with the new value.
     3. Type dropdown shows all `ColumnDataType` options; selecting one calls `onChange`.
     4. Required checkbox toggles call `onChange`.
     5. Sample value preview renders truncated JSON (long strings ellipsized).
     6. "Add column" button appends an empty row.
     7. Remove-row buttons remove the row.
     8. Duplicate `normalizedKey` shows a validation error on both rows.
   - `EndpointColumnReviewUI`:
     1. Loading state renders a spinner.
     2. Success state renders `InferredColumnsTableUI` populated from props.
     3. Error state renders `<FormAlert>` + a "Try manual entry" button that flips to an empty manual table.
     4. Empty-records state renders a hint + Add-column button.
     5. "Re-probe" button calls the `onReprobe` callback.
     6. Existing field_mappings are overlaid: a mapping that matches an inferred column's sourceField shows "Already configured" badge.
   - `ProbeReviewStepUI`:
     1. Renders one `EndpointColumnReviewUI` per endpoint.
     2. Validates all sections before allowing `onNext`.

2. **Write the validation util tests** for the new per-column-row checks.

3. **Author the components** following the Component File Policy. Each `*UI` is purely props-driven; containers wire SDK hooks.

4. **Wire workflow container.** Swap the step in the workflow's step array; remove `FieldMappingsStep` imports; carry the per-endpoint column drafts in the container's state; commit-time materializes them as field-mapping inserts.

5. **Delete `FieldMappingsStep` files** (component, tests, stories).

6. **Run focused tests.** All new tests green; workflow integration test reflects the new step.

7. **Storybook smoke.** New stories render without console errors.

8. **Lint + type-check.** Clean.

**Done when:** the workflow shows the new step; users can probe, review, edit, add, and remove columns; the commit-time writes match phase 1's field-mapping shape.

---

## Slice 7 — End-to-end integration + manual smoke

Lock the full pipeline behind an integration test; manually verify against a real public API.

**Files**

- New: `apps/api/src/__tests__/__integration__/connectors/rest-api.probe.integration.test.ts`

**Steps**

1. **Write the integration test:**
   1. Seed: org + user + REST API connector definition + instance + endpoint with `recordsPath: "items"` + `pagination: { strategy: "none" }`.
   2. Stub `fetchJson` to return a 25-record array of `{ id, name, age, tags }` objects (mixed nested + scalar to exercise inference).
   3. POST `/discover-columns` → assert response: 4 columns (`id: string`, `name: string`, `age: number`, `tags: json`), each with samples populated, `source: "live"`.
   4. Second POST without `forceRefresh` → `source: "cache"`; `fetch` called exactly once across both requests.
   5. POST with `forceRefresh: true` → cache invalidated, `source: "live"`, `fetch` called twice total.
   6. Stub `fetch` to throw 401 → POST returns 502 + `REST_API_AUTH_FAILED`; cache state unchanged.

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
- **`discoverColumns` interface is unchanged** — the cross-cutting widening from phase 2 (`testConnection`, `toPublicAccountInfo`) is not repeated here. The richer payload (samples + source + recordsScanned) flows through the route layer, not through the adapter interface itself.
- **Cache singleton lifecycle.** One `ProbeCache` instance per Node process; injected at adapter registration. Tests that need a fresh cache get a new instance per test via the test harness's adapter factory.
- **No new job type, no new SSE channel, no new migration.** Phase 4 adds code surface only — no schema changes.
- **Phase 1 manually-declared mappings keep working** through the existing field-mapping routes + the probe-review step's "existing mappings" overlay. The Edit flow for an instance configured pre-phase-4 routes through the same step; users see their existing mappings (marked "Already configured") and can adopt new inferences alongside them.
- **After phase 4 lands, the PR has all four phases of docs.** Implementation work starts immediately afterward or in a follow-up cycle; the docs are the contract the implementer follows.
