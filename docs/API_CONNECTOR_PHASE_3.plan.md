# API connector — Phase 3 — Plan

**TDD-sequenced implementation of phase 3: relax the pagination CHECK constraint, widen the Zod schemas with the four-strategy discriminated union, land `applyTemplate` and `withRetry` as pure leaf utils, build per-strategy page iterators, rewrite the adapter's per-endpoint sync to drive an iterator-shaped loop, and surface the new fields in `ApiEndpointForm`.**

Spec: `docs/API_CONNECTOR_PHASE_3.spec.md`. Phases 1 + 2: `docs/API_CONNECTOR_PHASE_{1,2}.{spec,plan}.md`.

Seven slices, each behind a green test suite. The first four slices are pure leaf changes that don't touch the live sync path; slice 5 is the integration where everything wires together. Slice 6 exposes the new options in the UI. Slice 7 locks the end-to-end behavior with an integration test.

Run tests with the same commands as phases 1–2.

The slices are sequenced so that:

- **Slice 1** lands the migration + Zod widening. Existing rows still validate (all `none`); the broader space is now legal at the DB level but no adapter code reads it yet.
- **Slice 2** lands `applyTemplate` — pure, leaf, no caller.
- **Slice 3** lands `withRetry` — pure (modulo the `setTimeout` it owns), no caller. Touches `fetchJson` to attach status/headers to error details so `withRetry` can read `Retry-After`.
- **Slice 4** lands the four iterators behind a unified contract. Each is unit-testable in isolation against synthetic page sequences.
- **Slice 5** rewrites `syncInstance` and `testConnection` to drive an iterator loop and to apply templating + retries on every fetch. This is when the connector starts behaving as the new spec describes.
- **Slice 6** widens `ApiEndpointForm` so users can configure non-`none` pagination + body templates from the workflow. Up to this point, the only way to set a non-`none` strategy was a direct API call — useful for tests, intentional for safety.
- **Slice 7** lands the end-to-end paginated sync integration test, plus the manual smoke against a real paginated API.

After every slice, the repo type-checks, the existing test suite is green, and a user who hasn't opened the workflow since phase 2 sees no change in the UI until slice 6.

---

## Slice 1 — Migration + widened Zod schemas

The CHECK constraint widens from `pagination = 'none'` to `pagination IN ('none', 'pageOffset', 'cursor', 'linkHeader')`. The `PaginationConfigSchema` discriminated union ships. The widened `ApiEndpointConfigSchema` now requires `pagination` as a structured object.

**Files**

- New: Drizzle migration `<timestamp>_api_connector_phase_3.sql`
- Edit: `apps/api/src/db/schema/api-endpoint-configs.table.ts` — replace the phase-1 CHECK with the phase-3 CHECK.
- New: `apps/api/src/__tests__/__integration__/db/migrations/api_connector_phase_3.test.ts`
- Edit: `packages/core/src/models/api-connector.model.ts` — add `PaginationConfigSchema` + arms; widen `ApiEndpointConfigSchema`; add `.refine()` for `bodyTemplate` vs method.
- Edit: `packages/core/src/__tests__/models/api-connector.model.test.ts` — new pagination + bodyTemplate cases.
- Edit: `apps/api/src/db/schema/zod.ts` — no change (the drizzle-zod-derived schema continues to mirror the table; the structured pagination config lives in the consumer-side Zod, not in the table's row schema).

**Steps**

1. **Write the new model unit tests:**
   1. `PaginationConfigSchema.parse({ strategy: "none" })` succeeds.
   2. `PaginationConfigSchema.parse({ strategy: "pageOffset", style: "page", param: "page" })` succeeds with defaults applied.
   3. `PaginationConfigSchema.parse({ strategy: "pageOffset", style: "page" })` fails (missing param).
   4. `PaginationConfigSchema.parse({ strategy: "cursor", cursorParam: "cursor", cursorResponsePath: "meta.next" })` succeeds.
   5. `PaginationConfigSchema.parse({ strategy: "cursor", cursorParam: "cursor" })` fails (missing cursorResponsePath).
   6. `PaginationConfigSchema.parse({ strategy: "linkHeader" })` succeeds.
   7. `ApiEndpointConfigSchema.parse({ path: "/x", method: "POST", recordsPath: "", pagination: { strategy: "none" }, bodyTemplate: '{"q":1}' })` succeeds.
   8. `ApiEndpointConfigSchema.parse({ path: "/x", method: "GET", recordsPath: "", pagination: { strategy: "none" }, bodyTemplate: '{"q":1}' })` fails (bodyTemplate disallowed on GET via refine).
   9. `ApiEndpointConfigSchema.parse(<no pagination field>)` fails (pagination is required in phase 3).
   Run; all fail.

2. **Author the schemas** per spec. Discriminated union on `strategy`; refine on `bodyTemplate` vs `method`.

3. **Migration test cases:**
   1. Pre-migration: insert a row with `pagination = 'cursor'` → fails the phase-1 CHECK.
   2. Apply phase-3 migration: the constraint widens; the row now inserts cleanly.
   3. Rollback: the constraint narrows back; the cursor row now violates the constraint (but it remains because constraints aren't backfilled on rollback — the test asserts the constraint shape, not the row).
   4. Rolling the migration both directions on a fresh DB produces the documented final state.

4. **Generate the migration.** `cd apps/api && npm run db:generate -- --name api_connector_phase_3`. Review SQL — should contain only the two `ALTER TABLE` statements. Apply.

5. **Wire the schema export.** No new exports needed if `PaginationConfigSchema` is exported through the same barrel.

6. **Run focused tests.** Cases pass.

7. **Lint + type-check.** Clean. **Important:** phase-1 + phase-2 tests that constructed `ApiEndpointConfigSchema` without a `pagination` field will now fail to compile — fix each by adding `pagination: { strategy: "none" }`. This is the single biggest source of churn in this slice.

**Done when:** model + migration tests green; all prior tests still green after the test-fixture updates.

---

## Slice 2 — `applyTemplate` util

Pure leaf function. The closed variable set is enforced at substitution time and at lint time (frontend slice 6 reuses the lint helper).

**Files**

- New: `apps/api/src/adapters/rest-api/template.util.ts`
- New: `apps/api/src/__tests__/adapters/rest-api/template.util.test.ts`

**Steps**

1. **Write the util tests:**
   1. `applyTemplate("hello {{pageNumber}}", { cursor: "", pageNumber: 1 })` → `"hello 1"`.
   2. `applyTemplate("c={{cursor}}", { cursor: "abc", pageNumber: 1 })` → `"c=abc"`.
   3. `applyTemplate("p={{pageNumber}}&c={{cursor}}", { cursor: "abc", pageNumber: 2 })` → `"p=2&c=abc"`.
   4. `applyTemplate("c={{cursor}}", { cursor: "", pageNumber: 1 })` → `"c="` (empty substitution is fine).
   5. `applyTemplate("{{foo}}", ...)` throws `ApiError("REST_API_TEMPLATE_UNKNOWN_VARIABLE", details: { name: "foo" })`.
   6. `applyTemplate("plain string", ...)` returns the input unchanged.
   7. `applyTemplate("{{ pageNumber }}", ...)` — whitespace inside `{{ }}` is trimmed (defensive); resolves to `pageNumber` → `"1"`.
   8. `applyTemplate("{{}}", ...)` throws on empty name.
   9. `applyTemplateToConfig({ "X-Page": "{{pageNumber}}", "X-Other": "static" }, vars)` → both values substituted appropriately.
   10. `applyTemplateToConfig(undefined, vars)` → `{}`.
   Run; fail.

2. **Author the util.** Regex over `{{\s*([a-zA-Z_]\w*)?\s*}}` — capture the name, validate against the closed set, substitute. Throw with structured details on miss.

3. **Run focused tests.** Green.

4. **Lint + type-check.** Clean.

**Done when:** all 10 cases pass; no caller consumes `applyTemplate` yet.

---

## Slice 3 — `withRetry` util + `fetchJson` details

Wrapper around any retryable async. Pure (modulo `setTimeout`). Also: extends `fetchJson` so its error path attaches `{ status, headers }` to `ApiError.details`, which `withRetry` then reads for `Retry-After`.

**Files**

- New: `apps/api/src/adapters/rest-api/retry.util.ts`
- New: `apps/api/src/__tests__/adapters/rest-api/retry.util.test.ts`
- Edit: `apps/api/src/adapters/rest-api.fetch.util.ts` — attach `{ status, headers }` to `ApiError.details` on non-2xx and on JSON parse failure.
- Edit: `apps/api/src/__tests__/adapters/rest-api.fetch.util.test.ts` (extend or create if absent) — assert the new details payload.

**Steps**

1. **Write the `withRetry` tests** (using fake timers + a controllable stub for `fn`):
   1. `fn` returns successfully on first call → result returned, no delay.
   2. `fn` throws `ApiError(REST_API_FETCH_FAILED, details.status=502)` on attempts 1–2, then succeeds → result returned; delay sequence is 250ms, 500ms.
   3. `fn` throws 502 on every attempt → after 5 retries, rethrows the final error (now as `REST_API_FETCH_FAILED` with `details.attempts: 6`).
   4. `fn` throws `ApiError(REST_API_FETCH_FAILED, details.status=429, details.headers["retry-after"]="3")` once, then succeeds → waits 3000ms, then succeeds.
   5. Same with `retry-after` as HTTP-date (e.g., 2 seconds from now) → waits ~2000ms.
   6. Same with unparseable `retry-after` → falls back to exp backoff.
   7. `fn` throws `ApiError(REST_API_FETCH_FAILED, details.status=400)` → no retry, error rethrown immediately.
   8. `fn` throws after 5 retries on a 429 → rethrown as `REST_API_RATE_LIMITED` (not `REST_API_FETCH_FAILED`).
   9. `onRetry` hook is called once per retry with `(attempt, delayMs, status)`.
   Run; fail.

2. **Edit `fetchJson`** to attach `{ status, headers }` to every `ApiError.details` it throws. Headers are a plain object copy from `Headers` (lowercase keys).

3. **Author `withRetry`.** Loop with `attempt` counter; catch `ApiError` whose `details.status ∈ policy.retryOnStatus`; compute delay (Retry-After if present else `min(base * 2^attempt, max)`); `await new Promise(r => setTimeout(r, delay))`; retry. After max, rethrow (rewriting the code to `REST_API_RATE_LIMITED` on 429-exhaust).

4. **Run focused tests.** All 9 green; existing `rest-api.fetch.util` tests still green after the details additions.

5. **Lint + type-check.** Clean.

**Done when:** `withRetry` works end-to-end against synthetic errors; the `fetchJson` details extension doesn't break any phase-1/2 tests.

---

## Slice 4 — Pagination iterators

Four iterators, one per strategy. Each is a small async generator that the adapter consumes. Pure modulo the iterator's own state.

**Files**

- New: `apps/api/src/adapters/rest-api/pagination/types.ts`
- New: `apps/api/src/adapters/rest-api/pagination/none.iterator.ts`
- New: `apps/api/src/adapters/rest-api/pagination/page-offset.iterator.ts`
- New: `apps/api/src/adapters/rest-api/pagination/cursor.iterator.ts`
- New: `apps/api/src/adapters/rest-api/pagination/link-header.iterator.ts`
- New: `apps/api/src/adapters/rest-api/pagination/index.ts` — `resolveIterator` factory + `MAX_PAGES` constant.
- New: `apps/api/src/__tests__/adapters/rest-api/pagination/*.test.ts` (one file per iterator)

**Steps**

1. **Write the per-iterator tests:**
   - **none:**
     1. Yields exactly one `PageContext` with `pageNumber=1, isFirstPage=true, isLastPage=true`.
     2. After the first `next(page)`, returns (the generator is done).
   - **pageOffset:**
     1. Yields `pageNumber=1, 2, 3, …` until a response with `recordsPath` resolving to an empty array.
     2. With `stopOnShortPage=true` + `pageSize=50` + a 30-record response on page 1, terminates after page 1.
     3. With `stopOnShortPage=false` + the same response, continues to page 2.
     4. Honors `startPage` (e.g., `startPage=0` → first `pageNumber=0`).
     5. Hits `MAX_PAGES` → throws `REST_API_PAGINATION_EXCEEDED`.
   - **cursor:**
     1. Yields `cursor=""` on page 1; reads cursor from `cursorResponsePath` of the response and yields it on page 2; terminates when path resolves to null/undefined.
     2. Missing path on page 1 → `REST_API_CURSOR_NOT_FOUND`.
     3. Missing path on page ≥ 2 → terminates (treated as no-more-pages).
   - **linkHeader:**
     1. Yields page 1; parses `Link: <https://x?page=2>; rel="next"` from page-1 response → yields page 2; absent `rel="next"` → terminates.
     2. Multiple `Link` values in one header parsed correctly.
     3. Missing `Link` header on page 1 → terminates.
   Run; fail (iterators don't exist).

2. **Author the iterator types + factory.** `PageContext`, `FetchedPage`, `PageIterator` (`AsyncGenerator<PageContext, void, FetchedPage>`), `resolveIterator(config)` that switches on `config.strategy`.

3. **Author each iterator** per the spec. Each uses `walkPath` (existing util from phase 1) for response inspection.

4. **Run focused tests.** All cases green.

5. **Lint + type-check.** Clean.

**Done when:** every iterator's termination + safety-cap behavior is locked by tests; no caller drives the iterators yet.

---

## Slice 5 — Adapter rewrite + integration

Rewrite `syncInstance` and `testConnection` to drive iterators, apply templating, and wrap every fetch in `withRetry`. Phase-1 static `headers` / `queryParams` are now applied at fetch time. This is the integration slice — every util built in slices 2–4 finds its caller.

**Files**

- Edit: `apps/api/src/adapters/rest-api.adapter.ts` — replace the per-endpoint fetch block; apply auth/template/retry consistently.
- Edit: `apps/api/src/__tests__/adapters/rest-api.adapter.test.ts` — add multi-page sync cases.
- Edit: `apps/api/src/adapters/rest-api/credentials.util.ts` — no change (phase 2 already populated this).
- Edit: `apps/api/src/constants/api-codes.constants.ts` — add `REST_API_TEMPLATE_UNKNOWN_VARIABLE`, `REST_API_RATE_LIMITED`, `REST_API_PAGINATION_INVALID`, `REST_API_CURSOR_NOT_FOUND`, `REST_API_PAGINATION_EXCEEDED`.

**Steps**

1. **Write the adapter integration tests** (mocking `fetch` to return a programmable sequence of responses):
   1. `none` strategy: single fetch, records inserted (regression check — phase 1 behavior preserved).
   2. `pageOffset` strategy with 3 pages of records → 3 fetches; URL gains `?page=1`, `?page=2`, `?page=3`; final fetch terminates on empty array; record counts merge across pages.
   3. `cursor` strategy with 2 pages (cursor `"a"` then null) → 2 fetches; second fetch carries `?cursor=a`; terminates on null cursor.
   4. `linkHeader` strategy with 2 pages → second fetch URL comes from the `Link` header.
   5. Templated query param `?since={{pageNumber}}` → each page substitutes correctly.
   6. POST endpoint with `bodyTemplate: '{"page":{{pageNumber}}}'` → body substitutes per page.
   7. 429 on page 2 with `Retry-After: 1` → sync waits 1s and continues; total page count + counts are correct.
   8. Persistent 502 → `withRetry` exhausts, `REST_API_FETCH_FAILED` propagates, sync fails. Pages already upserted remain (by design, watermark-based deletion).
   9. `testConnection` with cursor strategy → only the first page is fetched, returns sample of first 5 records (terminates after page 1 by design — testConnection is page-1-only).
   10. Phase-2 auth scenarios still pass after the rewrite (regression check).
   Run; fail.

2. **Implement the adapter rewrite** per the spec pseudocode. Pull templating + iterators + retries into the per-endpoint loop; preserve auth handling.

3. **`testConnection` change:** previously fetched once via the simple fetch path. Now fetches via iterator (so `none` strategy keeps phase-2 behavior; other strategies fetch only page 1). The retry wrapper still applies.

4. **Wire the new ApiCodes.**

5. **Run focused tests.** All adapter cases green; phase-1 + phase-2 adapter cases still green.

6. **Lint + type-check.** Clean.

**Done when:** the adapter handles all four strategies end-to-end against mocked responses; testConnection still works under phase 2's auth.

---

## Slice 6 — Frontend `ApiEndpointForm` upgrade

Surface pagination + body templating in the workflow. Users can now configure non-`none` strategies through the UI for the first time in phase 3.

**Files**

- Edit: `apps/web/src/workflows/RestApiConnector/ApiEndpointForm.component.tsx` — add strategy dropdown, sub-forms, body-template textarea.
- New: `apps/web/src/workflows/RestApiConnector/PaginationFields.component.tsx` — the per-strategy sub-form (one component, switches on `strategy`).
- New: `apps/web/src/workflows/RestApiConnector/BodyTemplateField.component.tsx` — labeled textarea + variable hint tooltip.
- Edit: `apps/web/src/workflows/RestApiConnector/utils/rest-api-validation.util.ts` — new lint helper `validatePlaceholders(value): FormErrors`.
- Edit: `apps/web/src/workflows/RestApiConnector/__tests__/ApiEndpointForm.test.tsx` — new cases.
- New: `apps/web/src/workflows/RestApiConnector/__tests__/PaginationFields.test.tsx`
- New: `apps/web/src/workflows/RestApiConnector/__tests__/BodyTemplateField.test.tsx`
- Edit: `apps/web/src/workflows/RestApiConnector/stories/*` — pagination stories + body-template story.

**Steps**

1. **Write the validation tests:**
   1. `validatePlaceholders("c={{cursor}}")` → no errors.
   2. `validatePlaceholders("{{lastSyncAt}}")` → error `REST_API_TEMPLATE_UNKNOWN_VARIABLE` with `details.name: "lastSyncAt"`.
   3. `validatePlaceholders("static")` → no errors.

2. **Write the form-component tests:**
   1. `PaginationFieldsUI` with `strategy: "pageOffset"` renders the right inputs; toggling style flips param suggestions; changing `pageSize` calls `onChange`.
   2. `PaginationFieldsUI` with `strategy: "cursor"` renders cursorParam + cursorPlacement + cursorResponsePath.
   3. `PaginationFieldsUI` with `strategy: "linkHeader"` renders an info chip ("Reads `Link: rel=\"next\"`. No further config needed.") and nothing else.
   4. `BodyTemplateFieldUI`: renders only when method === "POST"; hint tooltip lists the two variables.
   5. `ApiEndpointFormUI`: changing method from POST to GET clears `bodyTemplate`; changing back doesn't restore it.
   6. `ApiEndpointFormUI`: submitting with an unknown template variable in any field shows the `REST_API_TEMPLATE_UNKNOWN_VARIABLE` error on the offending field via `<FormAlert>` + `aria-invalid`.

3. **Author the components.** PaginationFields and BodyTemplateField follow the Component File Policy (pure UI sibling per file). ApiEndpointForm wires them in.

4. **Run focused tests.** All cases green.

5. **Storybook smoke.** Each new story renders without console errors.

6. **Lint + type-check.** Clean.

**Done when:** users can configure all four pagination strategies + POST body templates from the workflow; placeholder lint catches unknown variables before submission.

---

## Slice 7 — End-to-end paginated integration + manual smoke

A single big integration test driving a multi-page sync against a mocked endpoint, then a manual smoke against a real paginated public API.

**Files**

- New: `apps/api/src/__tests__/__integration__/connectors/rest-api.paginated.integration.test.ts`

**Steps**

1. **Write the test:**
   1. Seed: org + user + REST API connector definition + instance with cursor pagination + an endpoint with `recordsPath: "items"` + `cursorResponsePath: "meta.next"`.
   2. Stub `fetchJson` to return:
      - Page 1: `{ status: 200, headers: {}, body: { items: [{ id: "a" }, { id: "b" }], meta: { next: "c2" } } }`
      - Page 2: `{ status: 429, headers: { "retry-after": "1" }, body: {} }` (forces a retry inside withRetry)
      - Page 2 (retry): `{ status: 200, headers: {}, body: { items: [{ id: "c" }, { id: "d" }], meta: { next: null } } }`
   3. POST a sync; drain queue.
   4. Assert: 4 records in `entity_records`, all 4 with the right `sourceId`. Sync result: `created: 4, updated: 0, unchanged: 0, deleted: 0`.
   5. Stub a second sync that re-fetches with one record removed → assert `deleted: 1`.

2. **Run focused test.** Green deterministically across re-runs.

3. **Manual smoke** (checklist, executed by the implementer):
   - Boot the stack.
   - Configure a REST API connector against `https://api.github.com/repos/EnterpriseBT/portal-ai/issues?state=all` (no auth required for low-volume reads on public repos; or use a phase-2 bearer with a personal access token to avoid rate limits) with `pagination: linkHeader`, `recordsPath: ""`.
   - Add field mappings for `id`, `title`, `state`.
   - Run a sync; confirm pages 1..N all fetch; final issue count matches GitHub's UI.

4. **Lint + type-check.** Clean.

**Done when:** the e2e test passes, the smoke produces a synced corpus of real records from a paginated public API, and the prior phase 1 / 2 happy paths still work.

---

## Cross-cutting notes

- **No new job type or queue config.** Phase 3 stays inside `connector_sync`.
- **`maxPages` safety cap** lives in the iterator module as a constant. If a future ticket needs per-endpoint overrides, expose it through `pagination_config` JSONB without rewriting the iterators.
- **`Retry-After` precedence.** Whenever the upstream sends `Retry-After`, we honor it — even if the value is larger than `maxDelayMs`. The clamp on misbehaving servers is `2 * maxDelayMs`; beyond that the wait gets clamped back. Documented in `retry.util.ts` so the test that exercises the clamp lives next to the constant.
- **Logging discipline.** The pagination loop logs `pageNumber`, `cursor` (truncated), elapsed time, and final record count per endpoint. Does NOT log full URLs after auth is applied (would leak query-param auth). Reuse the existing redaction helper from phase 2.
- **No web-app changes outside `ApiEndpointForm`.** The connector card, dashboard, and entity-detail views are pagination-agnostic — they read from `entity_records`, which doesn't know how the upstream was fetched.
