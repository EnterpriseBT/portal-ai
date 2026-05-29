# REST API streaming JSON parse — Plan

**TDD-sequenced implementation of the contract in `docs/REST_API_STREAM_PARSE.spec.md`. Five slices, each behind a green test suite, each landing as one commit on `feat/rest-api-stream-parse`. The first slice ships the streaming primitive in isolation (no consumers); the last slice wires it into the sync loop and runs the gated memory test. The existing buffered tests are the load-bearing regression net at every slice boundary.**

Spec: `docs/REST_API_STREAM_PARSE.spec.md`. Ticket: [#72](https://github.com/EnterpriseBT/portal-ai/issues/72).

Run tests with:

```bash
# fast feedback during a slice
cd apps/api && npm run test:unit -- --testPathPattern="rest-api"

# full unit suite at slice boundary
cd apps/api && npm run test:unit

# integration suite at slice boundary (final slice gates on the memory test)
cd apps/api && npm run test:integration

# slow / memory smoke (final slice only)
RUN_SLOW_TESTS=1 npm --prefix apps/api run test:integration -- \
  --testPathPattern="rest-api.stream-sync"

# repo gates at every slice boundary
npm run lint
npm run type-check
```

Per-slice loop:

1. Write failing tests for the slice's new behavior.
2. Implement the smallest change that makes them pass.
3. Run the focused suite; confirm green.
4. **Run the full rest-api unit suite** — every existing buffered test must continue to pass. This is the primary regression gate.
5. Lint + type-check at slice boundary.
6. Commit with a conventional `feat(api):` / `test(api):` / `chore(api):` subject per the slice.

The slices are sequenced so the destructive cut (slice 4 — `syncInstance` branches and the cap lifts) comes strictly after the streaming primitive is fully tested in isolation.

---

## Slice 0 — Add `stream-json` + scaffold `streamFetchRecords` (no consumers)

**Why first.** The streaming primitive is the load-bearing component every later slice depends on. Landing it as a standalone, exhaustively-tested unit with zero callers means slice 4's wiring is mechanical and no regression can trace back to a parsing surprise.

**Files**

- New: `apps/api/src/adapters/rest-api/stream.util.ts`.
- New: `apps/api/src/__tests__/adapters/rest-api/stream.util.test.ts`.
- Edit: `apps/api/package.json` — add `stream-json` (latest 1.x).
- Edit: `apps/api/src/constants/api-codes.constants.ts` — add `REST_API_RECORD_TOO_LARGE`, `REST_API_STREAM_ALREADY_CONSUMED`. Refresh the `REST_API_RESPONSE_TOO_LARGE` JSDoc to mention "buffered path".

**Steps**

1. `npm --prefix apps/api install stream-json` and confirm types are available via the bundled `.d.ts` (no `@types/stream-json` needed for recent versions; if missing, install).
2. Add the two new `ApiCode` enum entries. Run `npm run type-check` — should be clean since no consumers exist yet.
3. Stub `stream.util.ts` with:
   - `StreamFetchResult` interface (status, headers, recordsStream).
   - `StreamFetchOptions` interface (fetchImpl, maxRecordBytes).
   - `streamFetchRecords(url, init, recordsPath, opts)` exporting an empty body that throws "not implemented".
4. Write the test fixtures (cases 1–11 from spec § Tests § Unit — `streamFetchRecords`):
   - Build a small helper `makeFakeFetch(chunks: string[]): typeof fetch` that returns a `Response` whose `body` is a `ReadableStream` driven by `enqueue(chunks[i])` calls. The helper exposes a `pushChunk(c)` + `close()` + `errorOut(err)` surface so individual tests can interleave consumer pulls with producer pushes.
   - Each case from the spec gets one `it()` block. Some are mechanical (cases 4, 9); others (case 1 — "consumer sees record 1 before chunk 2 arrives") need a `pushChunk` / `nextRecord` interleave.
5. Implement `streamFetchRecords`:
   - `fetchImpl(url, init)`; throw `REST_API_FETCH_FAILED` on non-2xx.
   - `Readable.fromWeb(response.body)` → pipe through `stream-json`'s `Parser` → `Pick({ filter: recordsPath || /^/ })` → `StreamArray`.
   - Wrap the resulting object stream in an `AsyncIterable<unknown>`. Use a small queue + a `Promise<{ value, done } | Error>`-shaped `next()`. Honor early `return()` by calling `stream.destroy()` which propagates to the upstream reader.
   - Track `bytesObserved` via a `Transform` placed between `Readable.fromWeb` and the JSON parser. Expose via a getter on the iterator (not part of the public `AsyncIterable` contract — used by the integration test).
   - Per-record size check: each emitted record's serialized length (`Buffer.byteLength(JSON.stringify(record))`) is compared against `opts.maxRecordBytes ?? 50_000_000`. Throw `REST_API_RECORD_TOO_LARGE` when the limit trips.
   - Re-iteration guard: keep an internal `consumed = false` flag; the second `Symbol.asyncIterator` call throws `REST_API_STREAM_ALREADY_CONSUMED`.
6. Run cases 1–11. Green.
7. Run the entire rest-api unit suite. Unchanged — no consumers.
8. Lint + type-check. Clean.
9. Commit: `feat(api): add stream-json-backed streamFetchRecords primitive (#72)`.

**Done when:** `streamFetchRecords` is a fully-tested standalone unit; zero consumers; no behavior change anywhere else.

**Risk:** `stream-json`'s `Pick` filter syntax accepts a string OR a regex. A typo in the filter shape (e.g., passing `"items"` when `Pick` expects `/^items$/` for a top-level array) would silently emit nothing. Test case 1 catches it deterministically — if the filter is wrong, the consumer observes zero records.

---

## Slice 1 — Lift `MAX_RESPONSE_BYTES` to 500 MB

**Why now.** Independent of the streaming wiring; landing it as its own slice keeps the diff trivially reviewable. The change is one constant + a docstring + a test fixture update.

**Files**

- Edit: `apps/api/src/adapters/rest-api/fetch.util.ts` — bump constant; refresh docstring.
- Edit: `apps/api/src/constants/api-codes.constants.ts` — refresh `REST_API_RESPONSE_TOO_LARGE` JSDoc + user copy reference.
- Edit: `apps/api/src/__tests__/adapters/rest-api/fetch.util.test.ts` — the existing too-large cases reference `MAX_RESPONSE_BYTES`. They still pass against `500 * 1024 * 1024` because they construct their fake body relative to the constant; verify no hard-coded `50` references.

**Steps**

1. Bump the constant: `export const MAX_RESPONSE_BYTES = 500 * 1024 * 1024;`
2. Update the JSDoc on `fetchJson` + on `REST_API_RESPONSE_TOO_LARGE` to mention the 500 MB ceiling and the streaming-eligible alternative.
3. Run `fetch.util.test.ts` — the three existing too-large cases (Content-Length, slow-path buffered, slow-path mid-stream) should still pass because they trip the cap by setting `MAX_RESPONSE_BYTES + 1`.
4. Skim the test for any hard-coded `50 * 1024 * 1024` / `52428800` literals; rewrite to use the imported constant.
5. Run the full rest-api unit suite.
6. Lint + type-check.
7. Commit: `chore(api): lift buffered rest-api response cap to 500 MB (#72)`.

**Done when:** the cap is 500 MB; user copy on the ApiCode mentions streaming; no test regressions.

**Risk:** vanishingly low. The cap is only consulted by the buffered path; streaming doesn't touch it.

---

## Slice 2 — Add `streamFetchOnePage` (still no consumers in `syncInstance`)

**Why now.** Slice 0 gave us the primitive. This slice wraps it with the same auth / URL / template plumbing that `fetchOnePage` uses today, so slice 4's eligibility branch is one line that picks between two equivalent functions. Doing it independent of the sync loop keeps the test surface small.

**Files**

- Edit: `apps/api/src/adapters/rest-api/fetch-first-page.util.ts` — export `streamFetchOnePage`.
- Edit: `apps/api/src/__tests__/adapters/rest-api/fetch-first-page.util.test.ts` (or split into a sibling file if it doesn't exist; check current layout).

**Steps**

1. Implement `streamFetchOnePage(endpoint, baseUrl, auth, credentials)`:
   - Build the URL via the existing `buildUrl` + `applyTemplateToConfig` helpers (same as `fetchOnePage`'s non-overrideUrl branch).
   - Build headers via `applyTemplateToConfig` + auth.
   - Read `recordsPath = endpoint.config.recordsPath ?? ""`. Reject with `REST_API_INVALID_CONFIG` when `recordsPath` is empty and `transform` is non-empty.
   - Call `streamFetchRecords(url, init, recordsPath)` and return its result verbatim.
   - Wrap the *initial fetch* in `withRetry` — but the streaming read itself is single-attempt (resumable streaming is out-of-scope per spec).
2. Write tests:
   - Case 12: route auth + URL + template through to a stubbed `streamFetchRecords` (jest module mock). Assert the URL the wrapper passes matches what `fetchOnePage` would have built.
   - Case 13: throws `REST_API_INVALID_CONFIG` for empty `recordsPath` + set `transform`.
   - One smoke case asserting headers + status pass through verbatim.
3. Run the focused suite. Green.
4. Run the full rest-api unit suite. Unchanged.
5. Lint + type-check.
6. Commit: `feat(api): add streamFetchOnePage wrapper for streaming sync path (#72)`.

**Done when:** `streamFetchOnePage` is callable + tested; nothing in production calls it yet.

**Risk:** the auth/template plumbing has subtle branches (linkHeader override, body template, header merging). Cross-reference against `fetchOnePage` line-by-line during implementation; the test asserts URL equivalence to catch any drift.

---

## Slice 3 — Extract the per-record upsert body into `upsertRecord` helper (no behavior change)

**Why now.** The streaming branch needs to reuse the ~120 lines of per-record upsert logic that today lives inside `syncInstance`'s `for (const record of fetched.records)` loop. Extracting it now — as a pure refactor with the existing buffered path still calling it — makes slice 4's diff a clean two-branch `if/else` instead of a copy-paste.

**Files**

- Edit: `apps/api/src/adapters/rest-api/rest-api.adapter.ts` — extract `upsertRecord(record, ctx)` helper.
- Edit: `apps/api/src/__tests__/adapters/rest-api/rest-api.adapter.test.ts` — no new tests; the existing suite is the regression net.

**Steps**

1. Survey the existing inner loop (`rest-api.adapter.ts` ~`358–~470`). Identify the closed-over state: `recordIndex`, `inserted`, `updated`, `unchanged`, `runStartedAt`, `endpoint`, `instance`, `mappingsForNormalize`, `wideProjection`.
2. Define `interface UpsertContext { ... }` that captures the needed inputs by reference (counter fields stay as a `{ counts: { inserted: number; updated: number; unchanged: number; recordIndex: number } }` mutable bag).
3. Extract a function `async function upsertRecord(record: unknown, ctx: UpsertContext): Promise<void>` that contains the existing inner-loop body. Update the call site in `syncInstance` to `await upsertRecord(record, ctx)`.
4. Run the entire `rest-api.adapter.test.ts` suite — every existing assertion should pass without modification (pure refactor).
5. Run the integration suite (`rest-api.*.integration.test.ts`). Pass.
6. Lint + type-check.
7. Commit: `refactor(api): extract per-record upsert helper for streaming reuse (#72)`.

**Done when:** the helper is the single source of truth for "process one record"; buffered tests pass unchanged.

**Risk:** subtle closure drift — a counter not propagated by reference. The existing `inserted` / `updated` / `unchanged` test assertions catch this deterministically.

---

## Slice 4 — Wire the streaming branch into `syncInstance`

**Why now.** Every dependency is in place: the primitive, its wrapper, the cap lift, and the reusable upsert helper. The eligibility predicate + a single `if/else` is the only code change.

**Files**

- Edit: `apps/api/src/adapters/rest-api/rest-api.adapter.ts` — add `isStreamingEligible`, branch `syncInstance`.
- Edit: `apps/api/src/__tests__/adapters/rest-api/rest-api.adapter.test.ts` — cases 14–16.

**Steps**

1. Define `isStreamingEligible(endpoint)`: `pagination.strategy === "none"` && empty `transform`.
2. In `syncInstance`, after the field-mappings + wide-projection setup (the shared prelude), branch:
   ```ts
   if (isStreamingEligible(endpoint)) {
     const page = await streamFetchOnePage(endpoint, baseUrl, auth, credentials);
     const startedAt = Date.now();
     let bytesObserved = 0;
     try {
       for await (const record of page.recordsStream) {
         if (record === null || typeof record !== "object") {
           ctx.counts.recordIndex++;
           continue;
         }
         await upsertRecord({ ...(record as Record<string, unknown>) }, ctx);
       }
       bytesObserved = (page.recordsStream as { getBytesObserved?: () => number })
         .getBytesObserved?.() ?? 0;
     } finally {
       logger.info(
         { event: "rest-api.sync.stream-page", /* … */ bytesObserved, recordsEmitted: ctx.counts.recordIndex, durationMs: Date.now() - startedAt },
         "Streaming page drained"
       );
     }
   } else {
     // existing iterator-driven buffered path, unchanged
   }
   ```
3. Write tests:
   - Case 14 — table-driven `isStreamingEligible`: every pagination strategy × `{empty, set}` transform, asserting exactly the spec'd cell is `true`.
   - Case 15 — streaming branch consumes `recordsStream`: jest-mock `streamFetchOnePage` to return a fake AsyncIterable of 3 records; assert `upsertRecord` (or the repo it calls) fires 3 times.
   - Case 16 — non-eligible endpoint falls through: fixtures from today's tests; pass unchanged.
4. Run the unit suite. Green.
5. Run the integration suite (non-gated). Green.
6. Lint + type-check.
7. Commit: `feat(api): stream-parse unpaginated rest-api responses (#72)`.

**Done when:** `syncInstance` streams records for the eligible config; every existing buffered test still passes.

**Risk:**
- Forgetting to set `ctx.counts.recordIndex++` for the `null`/non-object skip case. Caught by an existing test that asserts `recordIndex` is the post-loop value.
- The `getBytesObserved` getter being attached to the wrong object (the AsyncIterable itself vs. its iterator). Caught by the integration test in slice 5; if the bytes log reports `0`, fix the getter location.

---

## Slice 5 — Memory smoke + ApiCode user-copy on the frontend

**Why now.** The streaming code is live as of slice 4; this slice proves it works under the constrained heap and surfaces the new ApiCodes in the user-visible error path.

**Files**

- New: `apps/api/src/__tests__/__integration__/connectors/rest-api.stream-sync.integration.test.ts` (`RUN_SLOW_TESTS=1` gated).
- Edit: `apps/web/src/utils/api.util.ts` (or wherever the `ApiCode → user copy` map lives — locate via `grep -n REST_API_RESPONSE_TOO_LARGE apps/web/src/`) — add display strings for `REST_API_RECORD_TOO_LARGE` and `REST_API_STREAM_ALREADY_CONSUMED`.

**Steps**

1. Build the integration test:
   - Spin a `node:http` server on a random port. Body handler writes `{"items":[` then loops emitting `,{"id":${i},"name":"row-${i}","payload":"<small-blob>"}` for `i in [0, 1_000_000)` (skipping the leading comma on `i=0`), then `]}`. Each `res.write` returns `false` (`drain`-aware) on backpressure.
   - Seed a connector instance + endpoint via the existing integration-test factories: `pagination: { strategy: "none" }`, `recordsPath: "items"`, no transform.
   - Invoke `syncInstance` directly. (No worker queue — the integration test imports the adapter and calls it under a process-wide `NODE_OPTIONS=--max-old-space-size=512`.)
   - Sample `process.memoryUsage().heapUsed` every 250 ms during the sync; collect max.
   - Assert:
     - The call resolves (no OOM).
     - `entity_records` count for the entity == 1_000_000.
     - Max heap < 200 MB.
     - The `rest-api.sync.stream-page` log line fires with `bytesObserved > 400_000_000`.
2. Locate the web's ApiCode display-string map; add the two new codes with copy:
   - `REST_API_RECORD_TOO_LARGE` → "A single record exceeded the 50 MB streaming size. Check that the Records path points at an array of records, not the whole document."
   - `REST_API_STREAM_ALREADY_CONSUMED` → "Streaming response was already consumed. Retry the sync — if it persists, report this."
3. Run the integration test under `RUN_SLOW_TESTS=1`. It must pass on the same hardware our CI uses; if heap creeps over 200 MB, profile via `--prof` and revisit `stream-json`'s queue settings (typically `Pick`'s `pathSeparator` and `StreamArray`'s default `highWaterMark`).
4. Run `RUN_SLOW_TESTS=0` (default) one more time; the test skips, the rest of the suite is unaffected.
5. Run web unit tests for the SDK copy change.
6. Lint + type-check.
7. Commit: `test(api): add memory smoke for streaming rest-api sync (#72)`.

**Done when:**
- The memory smoke passes under a constrained heap. **Landed as `src/__tests__/utils/rest-api-stream-memory-smoke.test.ts` + `src/scripts/rest-api-stream-memory-smoke.ts`** — spawn-based child-process smoke matching the existing `row-async-memory-smoke` precedent. The in-process integration test originally specced (driving `syncInstance` against an http server + sampling heap mid-run) produced too-noisy a signal — V8 GC behavior + per-record DB overhead dominated the measurement. The standalone-script approach gives a clean pass/fail on the actual property: process survives `--max-old-space-size=256` while streaming ~300 MB. Plus a focused `getBytesObserved` unit test in `stream.util.test.ts` covers the "getter attached to wrong object" risk from slice 4.
- The two new ApiCodes have user-facing copy. **Landed in the server-side `ApiError` messages** — apps/web renders `serverError.message` verbatim via `FormAlert`, with no central ApiCode → display-string map. The plan's note anticipated this; the right place was the server messages.
- All gates (lint, type-check, full unit + non-gated integration) green.

**Risk:**
- The smoke test is timing-sensitive; on a slow CI runner it could take 60+ seconds. Cap the per-emit payload size to keep total ≤ ~30 s. If still flaky, add a `jest.setTimeout(120_000)` at the top of the file.
- Locating the ApiCode display-string map: it might not be centralized (`grep` may surface inline strings). If so, add to wherever the closest existing REST_API_* code lives — that's the precedent.

---

## Open the PR

After slice 0 lands (i.e., the first commit on the branch exists), open the PR as **draft** per `CLAUDE.md`'s issue → PR workflow. The PR's body uses the standard template and includes `Closes #72`. Subsequent slice commits push to the same branch; mark **ready for review** after slice 5's gates are green.

```bash
gh pr create --draft \
  --title "feat(api): stream-parse large unpaginated rest-api responses" \
  --body "$(cat <<'EOF'
## Summary

- Streams JSON record arrays from unpaginated REST API responses via `stream-json`, lifting the 50 MB whole-body cap for the dominant case (recordsPath + pagination: none).
- Bumps the buffered-path cap to 500 MB for JSONata + preview/probe.
- Implements the design in `docs/REST_API_STREAM_PARSE.spec.md`; slices follow `docs/REST_API_STREAM_PARSE.plan.md`.

## Test plan

- [ ] `cd apps/api && npm run test:unit` — all rest-api buffered tests pass + new streaming tests.
- [ ] `cd apps/api && npm run test:integration` — all green.
- [ ] `RUN_SLOW_TESTS=1 npm --prefix apps/api run test:integration -- --testPathPattern="rest-api.stream-sync"` — memory smoke green under `--max-old-space-size=512`.
- [ ] `npm run lint && npm run type-check` — clean.
- [ ] Manually exercise an unpaginated public open-data endpoint (e.g., data.gov.uk) ≥ 50 MB end-to-end.

Closes #72
EOF
)"
```

## Cross-references

- Spec: `docs/REST_API_STREAM_PARSE.spec.md`.
- Ticket: [#72](https://github.com/EnterpriseBT/portal-ai/issues/72).
- Prior art: `docs/LARGE_FILE_PARSE_STREAMING.plan.md`, `docs/SPREADSHEET_PARSER_ROW_ASYNC.plan.md`.
- Streaming library: [`stream-json`](https://github.com/uhop/stream-json).
