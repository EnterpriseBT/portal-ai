# REST API streaming JSON parse — Spec

**The REST API connector's sync loop streams records out of an unpaginated JSON response as bytes arrive, never holding the full response body in V8 heap. After this change, a single-shot endpoint that returns a multi-GB JSON array of records syncs successfully on a worker with a 512 MB heap. The buffered `fetchJson` path stays as the fallback for cases that genuinely need a whole-document view (JSONata transform, Preview/probe samples).**

Ticket: [#72](https://github.com/EnterpriseBT/portal-ai/issues/72). No standalone discovery doc — the design space lives in the ticket body plus this spec's *Decisions* section below. Prior art: `docs/LARGE_FILE_PARSE_STREAMING.plan.md` and `docs/SPREADSHEET_PARSER_ROW_ASYNC.{discovery,spec,plan}.md` (lazy row windows for spreadsheets).

## Scope

### In scope

1. **`streamFetchRecords(url, init, recordsPath)` primitive** in `apps/api/src/adapters/rest-api/stream.util.ts` (new). Returns `{ status, headers, recordsStream: AsyncIterable<unknown> }`. Pipes the `fetch` body through a `stream-json` parser configured with a path filter so each element under `recordsPath` is emitted as it arrives. Never buffers the full body.
2. **`streamFetchOnePage(...)` adapter wrapper** in `apps/api/src/adapters/rest-api/fetch-first-page.util.ts`. Same external shape as `fetchOnePage` but returns `{ status, headers, recordsStream }` instead of `{ status, headers, records: unknown[], body: unknown }`. Used by the sync loop when streaming is eligible; everything else (preview, probe, testConnection) keeps `fetchOnePage`.
3. **Streaming-eligibility branch in `syncInstance`** (`rest-api.adapter.ts`). When `pagination.strategy === "none"` **and** the endpoint's records extraction is `recordsPath` (not `transform`), the sync loop drives the streaming primitive and consumes records via `for await`. Every other configuration falls through to the existing buffered path unchanged.
4. **Buffered cap lifted** on `fetchJson`. `MAX_RESPONSE_BYTES` becomes a soft guardrail at **500 MB** (was 50 MB). The `REST_API_RESPONSE_TOO_LARGE` ApiCode + check stay in place — for JSONata mode + preview/probe, the cap is the only protection against an OOM. User-facing copy on the code updates to "Response exceeded 500 MB on the buffered path. Switch to a recordsPath extraction (streams parse) or enable pagination."
5. **Streaming path has no fixed byte cap**, only a per-record sanity ceiling: if a single record's serialized JSON exceeds 50 MB, the parser throws `REST_API_RECORD_TOO_LARGE` (new ApiCode). This is a programmer-error guard against `recordsPath` being misconfigured at the root of a 5 GB blob.
6. **Integration test under a constrained heap.** A new `RUN_SLOW_TESTS=1`-gated integration test seeds a fake upstream that streams a synthetic 500 MB JSON array (~1M small records), runs `syncInstance` against it under `NODE_OPTIONS=--max-old-space-size=512`, and asserts the sync completes without OOM and writes the expected record count.
7. **Telemetry.** The sync log emits `event: "rest-api.sync.stream-page"` with `{ recordsEmitted, bytesObserved, durationMs }` once the stream drains (or aborts). Mirrors the existing per-page log structure.

### Out of scope

- **Streaming for paginated cases** (`pagination.strategy !== "none"`). Pagination already bounds memory per page; the win-per-complexity for streaming inside a page is small and the existing per-page upsert batching stays intact.
- **Streaming JSONata transform.** JSONata is a whole-document expression language — no streaming evaluator exists, and writing one is out of scope. JSONata stays on the buffered path; the lifted 500 MB cap is the user's headroom.
- **Mid-stream resume / partial-progress recovery.** Same behavior as v1 buffered parse: a mid-stream parse error or socket reset fails the sync. Adding resume requires checkpointing logic that doesn't exist anywhere else in the adapter and is its own ticket.
- **Replacing the buffered Preview / `discover-columns` probe path.** Those paths only ever need page 1 of the sample data; the 500 MB cap is more than enough. Forcing them through the streaming primitive would add complexity without a memory win.
- **Backpressure between the network read and the DB writer.** The sync loop awaits each record's DB upsert before pulling the next record from `recordsStream`. That naturally throttles the read — `stream-json` pauses the upstream socket when its internal queue fills. No new concurrency primitives.
- **Format detection / auto-fallback** ("try streaming first, fall back to buffered on failure"). The decision is config-driven at the call site; no runtime detection.
- **Web frontend changes.** None. The form's `Records path` vs. `Transform expression` toggle already steers the user toward the streaming-eligible mode; updating the help-text copy to mention "best for large responses" is a follow-up doc-change, not part of this spec.

## Decisions

1. **Streaming primitive: `stream-json`.** It's the most-vetted Node streaming JSON library, has a clean `Pick + StreamArray` pipeline that matches our `recordsPath → array` semantics, and is already exercised by the spreadsheet streaming work referenced in the ticket. The alternative `JSONStream` is unmaintained; `clarinet` is lower-level than we need.
2. **`recordsPath` only — no JSONata.** JSONata expressions can reference arbitrary parts of the document (`$sum`, cross-array joins, etc.) and require the full parsed tree. Building a "streaming JSONata" is a research project, not a feature. The lifted 500 MB cap is the user's escape hatch when the response is JSONata-shaped but too large; the right longer-term answer is to add a `streamingTransform` option that's `recordsPath`-shaped (e.g. a JSONPath subset) — separate ticket.
3. **`pagination: "none"` only.** Paginated endpoints already keep memory bounded by fetching pages sequentially (see the existing iterator pattern in `pagination/`). Extending streaming into paginated cases would require teaching every pagination strategy how to surface incremental records, which is mostly a no-op win — a single page is already small.
4. **Sync loop owns the iteration boundary.** The sync loop's record-by-record DB pattern (find → checksum → upsert → mirror) doesn't change. The only change is the source: `for (const r of fetched.records)` becomes `for await (const r of fetched.recordsStream)`. Per-record DB hits provide implicit backpressure to the stream.
5. **No batch flush change.** Today the sync loop hits the DB once per record (no batching). Streaming inherits that. A separate batching optimisation is orthogonal and worth its own ticket — it'd help both buffered and streamed paths.
6. **Buffered cap lifted to 500 MB, not removed.** Removing the cap leaves OOM as the only failure mode on the buffered path, which is harder to debug than an explicit error code. 500 MB is comfortably above the typical JSONata payload and well below the worker heap; the cap is a fence, not a feature.
7. **Per-record size ceiling = 50 MB on the streaming path.** Prevents a misconfigured `recordsPath` (pointing at the document root) from streaming the entire 5 GB body into a single "record" object. The 50 MB threshold matches the v1 whole-response cap — comfortably big for any legitimate single record.

## Concept changes

### `recordsStream` semantics

```ts
interface StreamFetchResult {
  status: number;
  headers: Record<string, string>;
  /**
   * Records emitted under `recordsPath` as bytes arrive. Iteration
   * progresses incrementally: the producer reads from the upstream
   * socket as the consumer pulls. Iteration order matches insertion
   * order in the upstream array.
   *
   * The iterable is single-use — re-iterating throws. Mid-stream
   * failures (socket reset, parser error, per-record size overrun)
   * surface as throws inside `for await`.
   */
  recordsStream: AsyncIterable<unknown>;
}
```

- **Single-use.** The underlying `ReadableStream` is consumed once. Re-iterating throws `REST_API_STREAM_ALREADY_CONSUMED`. Callers that need a snapshot use `fetchJson` instead.
- **No `body` field.** The streaming path never materializes a full body. Callers that need the body (preview, probe) call the buffered path.
- **Mid-stream errors throw inside `for await`.** No swallowing. The sync loop's existing top-level try/catch catches them like any other page failure.
- **Cancellation.** If the consumer breaks out of `for await` (e.g., job cancelled), the AsyncIterable closes the upstream reader, aborting the in-flight `fetch`.

### `streamFetchRecords` shape

```ts
// apps/api/src/adapters/rest-api/stream.util.ts (new)

export interface StreamFetchOptions {
  /** Defaults to `globalThis.fetch`. Injectable for tests. */
  fetchImpl?: typeof globalThis.fetch;
  /** Throws REST_API_RECORD_TOO_LARGE when any single record exceeds this. Default 50 MB. */
  maxRecordBytes?: number;
}

export async function streamFetchRecords(
  url: string,
  init: RequestInit,
  recordsPath: string,
  opts?: StreamFetchOptions
): Promise<StreamFetchResult>;
```

Internally:
1. `fetch(url, init)`. Non-2xx → throw `REST_API_FETCH_FAILED` (same shape as `fetchJson`).
2. Convert the web `ReadableStream` (`response.body`) to a Node `Readable` via `Readable.fromWeb`.
3. Pipe through `stream-json/Parser` → `stream-json/filters/Pick({ filter: recordsPath })` → `stream-json/streamers/StreamArray`. Empty `recordsPath` uses the document root.
4. Wrap the resulting object stream in an `AsyncIterable<unknown>` whose `next()` resolves to the next emitted record, propagates `error` events as rejections, and runs a per-record size assertion.
5. The AsyncIterable's `return()` (called by `for await` on `break`) cancels the upstream reader.

### `streamFetchOnePage` shape

```ts
// apps/api/src/adapters/rest-api/fetch-first-page.util.ts (edit — add the streaming variant)

export async function streamFetchOnePage(
  endpoint: ApiEndpoint,
  baseUrl: string,
  auth: ApiAuthConfig,
  credentials: ApiCredentials | null
): Promise<{
  status: number;
  headers: Record<string, string>;
  recordsStream: AsyncIterable<unknown>;
}>;
```

Same URL / auth / template plumbing as `fetchOnePage`, except:
- `pagination` is hard-coded to `{ strategy: "none" }` — the only eligible mode.
- `recordsPath` is read from `endpoint.config.recordsPath`. If it's empty *and* `transform` is set, the caller mis-routed; throw `REST_API_INVALID_CONFIG`.
- `retry.util.ts` wraps the *initial fetch* but not the streaming read. Retrying mid-stream is the resumable-streaming scope the spec excludes.

### Eligibility predicate

```ts
// apps/api/src/adapters/rest-api/rest-api.adapter.ts (edit syncInstance)

function isStreamingEligible(endpoint: ApiEndpoint): boolean {
  const transform = endpoint.config.transform ?? "";
  return (
    endpoint.config.pagination.strategy === "none" &&
    transform.trim().length === 0
  );
}
```

Branch in `syncInstance`:

```ts
if (isStreamingEligible(endpoint)) {
  const page = await streamFetchOnePage(endpoint, baseUrl, auth, credentials);
  for await (const record of page.recordsStream) {
    // existing per-record upsert body, unchanged
  }
} else {
  // existing iterator-driven buffered path, unchanged
}
```

The inner record body (the ~120 lines that find/checksum/insert/mirror) factors into a helper called from both branches, so the streaming branch reuses it line-for-line.

### Updated `MAX_RESPONSE_BYTES` + ApiCodes

```ts
// apps/api/src/adapters/rest-api/fetch.util.ts (edit)
export const MAX_RESPONSE_BYTES = 500 * 1024 * 1024; // 500 MB — was 50 MB
```

```ts
// apps/api/src/constants/api-codes.constants.ts (edit)
/**
 * Response body exceeded `MAX_RESPONSE_BYTES` (default 500 MB) on the
 * buffered fetch path. Used by JSONata transform + Preview/probe.
 * Streaming-eligible syncs (recordsPath + pagination: none) don't hit
 * this — they parse incrementally.
 */
REST_API_RESPONSE_TOO_LARGE = "REST_API_RESPONSE_TOO_LARGE",

/**
 * The streaming parser emitted a single record whose serialized JSON
 * exceeded `maxRecordBytes` (default 50 MB). Almost always means
 * `recordsPath` is pointing at a non-array node or the document root.
 */
REST_API_RECORD_TOO_LARGE = "REST_API_RECORD_TOO_LARGE",

/**
 * Caller tried to iterate a `recordsStream` more than once.
 * Programmer error — `fetchJson` is the right primitive for callers
 * that need a snapshot.
 */
REST_API_STREAM_ALREADY_CONSUMED = "REST_API_STREAM_ALREADY_CONSUMED",
```

### Telemetry

The sync loop emits one log per streaming page (there's only ever one streaming page since the predicate requires `pagination: "none"`):

```ts
logger.info(
  {
    event: "rest-api.sync.stream-page",
    connectorInstanceId,
    connectorEntityId: endpoint.entity.id,
    recordsEmitted,
    bytesObserved,
    durationMs: Date.now() - startedAt,
  },
  "Streaming page drained"
);
```

`bytesObserved` is the running counter the streaming primitive exposes via a `getBytesObserved()` callback on the iterator. Used in the integration test to assert the worker really streamed >50 MB without spiking heap.

## Surface

### New files

- `apps/api/src/adapters/rest-api/stream.util.ts` — `streamFetchRecords` + `StreamFetchResult` + the iterator implementation.
- `apps/api/src/__tests__/adapters/rest-api/stream.util.test.ts` — unit tests for the primitive.
- `apps/api/src/__tests__/__integration__/connectors/rest-api.stream-sync.integration.test.ts` — gated end-to-end test under constrained heap.

### Edited files

- `apps/api/src/adapters/rest-api/fetch.util.ts` — bump `MAX_RESPONSE_BYTES`, refresh the docstring + the `REST_API_RESPONSE_TOO_LARGE` user-copy.
- `apps/api/src/adapters/rest-api/fetch-first-page.util.ts` — add `streamFetchOnePage`.
- `apps/api/src/adapters/rest-api/rest-api.adapter.ts` — extract the per-record upsert body into a helper; branch `syncInstance` on `isStreamingEligible`.
- `apps/api/src/constants/api-codes.constants.ts` — add `REST_API_RECORD_TOO_LARGE`, `REST_API_STREAM_ALREADY_CONSUMED`; refresh the `REST_API_RESPONSE_TOO_LARGE` JSDoc.
- `apps/api/src/__tests__/adapters/rest-api/fetch.util.test.ts` — update the existing too-large assertions to use the new 500 MB constant.
- `apps/api/src/__tests__/adapters/rest-api/rest-api.adapter.test.ts` — add a streaming-branch unit test using a fake `streamFetchOnePage` stub.
- `apps/api/package.json` — add `stream-json` to `dependencies`.

### Deleted files / symbols

- None. The buffered path stays in place as the fallback; nothing is ripped out.

## Tests

### Unit tests — `streamFetchRecords` (`stream.util.test.ts`)

1. **Happy path: records emit incrementally.**
   Drive a fake `fetch` whose `body` is a manually-controlled `ReadableStream`. Push the JSON `{"data":{"items":[` then `{"id":1},{"id":2}` chunked across multiple `enqueue()` calls. Assert the consumer observes record `{id:1}` *before* the second chunk lands.

2. **`recordsPath = ""` streams document-root array.** Equivalent to today's `walkRecordsPath("", body)` semantics: the body itself is the array.

3. **Deep path emits.** `recordsPath = "data.results.items"` over a `{"data":{"results":{"items":[...]}}}` stream.

4. **Empty array → empty iteration.** Stream yields zero records, `for await` completes without throws.

5. **Non-2xx upstream → `REST_API_FETCH_FAILED`** before the consumer pulls.

6. **Malformed JSON mid-stream → throws inside `for await`** with `REST_API_INVALID_JSON`. Records emitted before the malformed point are still observable to the consumer.

7. **`recordsPath` doesn't exist → `REST_API_RECORDS_PATH_NOT_FOUND`** raised at first pull (after enough bytes have parsed for the missing path to be deterministic — i.e., the parser has closed the root object without finding the path).

8. **Per-record size ceiling.** A 60 MB single record under `maxRecordBytes: 50_000_000` throws `REST_API_RECORD_TOO_LARGE` at the offending record. Earlier records remain observable.

9. **Re-iteration throws `REST_API_STREAM_ALREADY_CONSUMED`.**

10. **Consumer `break` cancels upstream.** Wrap the fake stream's `cancel()` in a spy; assert it fires when the `for await` exits early.

11. **Cancellation rejects in-flight `next()`.** If the underlying reader rejects mid-record, the next pulled `for await` iteration throws.

### Unit tests — `streamFetchOnePage` (extend `rest-api.adapter.test.ts` or split into its own file)

12. **Routes auth + URL + template through to `streamFetchRecords`.** Stub `streamFetchRecords`; assert the URL the wrapper builds matches what `fetchOnePage` would have built for the same endpoint.

13. **Throws `REST_API_INVALID_CONFIG` when `recordsPath` is empty + `transform` is set.** Defensive: the caller mis-routed.

### Unit tests — `syncInstance` streaming branch (extend `rest-api.adapter.test.ts`)

14. **Eligibility predicate.** Table-driven test of `isStreamingEligible` over the matrix of `pagination.strategy ∈ {"none","pageOffset","cursor","linkHeader","linkBody"}` × `transform ∈ {"", "data.items"}`.

15. **Streaming branch consumes `recordsStream` and writes records.** Inject a fake `streamFetchOnePage` stub returning a hand-built AsyncIterable of 3 records; assert `entity_records` ends with 3 inserts (mock the repo).

16. **Non-eligible endpoint falls through to buffered path unchanged.** Same fixtures as today; behavior identical.

### Integration tests

17. **`rest-api.stream-sync.integration.test.ts` (new, `RUN_SLOW_TESTS=1` gated).**
    - Starts a `node:http` server that streams a `{"items":[...]}` body with ~1,000,000 small records (~500 MB on the wire). The server backpressures: it writes ~256 KB chunks and waits for `drain`.
    - Configures a connector instance with `pagination: "none"` + `recordsPath: "items"`.
    - Spawns the worker child process under `NODE_OPTIONS=--max-old-space-size=512`.
    - Calls `syncInstance` and asserts:
      - Completion without OOM.
      - `entity_records` count == 1,000,000.
      - Peak heap (sampled via `process.memoryUsage().heapUsed` at 250 ms intervals) stays under 200 MB.
      - The `rest-api.sync.stream-page` log line fires once with `bytesObserved > 400_000_000`.

### Existing tests stay

- All existing `fetch.util.test.ts` cases continue to pass against the bumped `MAX_RESPONSE_BYTES`. Only the numeric constant the tests reference changes.
- All existing `rest-api.adapter.test.ts` cases pass — they exercise the buffered path, which the streaming-eligibility branch falls through to whenever `transform` is set or pagination isn't `"none"`.

## Acceptance criteria

- [ ] An endpoint configured with `pagination: "none"` + `recordsPath: "items"` returning a 500 MB JSON body syncs successfully under `NODE_OPTIONS=--max-old-space-size=512`. (Integration test 17.)
- [ ] `MAX_RESPONSE_BYTES` lifted to 500 MB; `REST_API_RESPONSE_TOO_LARGE` user-copy updated.
- [ ] `REST_API_RECORD_TOO_LARGE` + `REST_API_STREAM_ALREADY_CONSUMED` added to `ApiCode`.
- [ ] Streaming branch in `syncInstance` covers exactly the eligibility predicate (verified by test 14).
- [ ] All existing rest-api unit + integration tests pass.
- [ ] `npm run type-check` clean across the repo.
- [ ] `npm run lint` clean (no new warnings).
- [ ] `stream-json` added as a direct dependency of `apps/api`.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| `stream-json` parse semantics drift from `JSON.parse` (e.g., handling of duplicate keys, numeric precision). | Unit test 1–7 covers the JSON cases the adapter cares about. The library is widely used; the surface we exercise is small (`Parser` + `Pick` + `StreamArray`). |
| Per-record upsert latency dominates and streaming gives no real perf win — but does add complexity. | Integration test 17 verifies the *memory* win, which is the actual goal. Throughput is a follow-up; the alternative (OOM on 50 MB+ responses) is already a worse outcome. |
| A streaming sync that fails mid-record leaves `entity_records` half-written with no resume path. | Same failure mode as today's buffered path (a page fetch that fails partway leaves the prior page's writes committed). Documented as out-of-scope; surfaced clearly via the existing job-failure telemetry. |
| Backpressure misbehaves — `stream-json` overruns its internal queue when DB writes block. | `stream-json` is a Node stream consumer and honors backpressure via its `_read` callback. The DB-write `await` in the sync loop is the natural backpressure source; manually verified in test 17 by sampling heap. |
| Increasing `MAX_RESPONSE_BYTES` from 50 MB → 500 MB invites JSONata users to push the limit and OOM. | The buffered path still has the cap (just higher); the `REST_API_RESPONSE_TOO_LARGE` copy now nudges toward the streaming-eligible config. Real OOMs were the v1 failure mode anyway when users disabled the cap via env override; the spec keeps the floor at the cap, not the heap. |
| Web frontend doesn't surface the new ApiCodes (`REST_API_RECORD_TOO_LARGE`, `REST_API_STREAM_ALREADY_CONSUMED`) → the user sees a generic error. | Add display strings to the existing `ApiCode → user copy` map in `apps/web` (typically a one-line edit per code). Tracked in the plan's final slice. |
| `Readable.fromWeb` not available in the runtime. | Node ≥ 17 ships it; `apps/api` already runs on Node 20+ (see `.nvmrc` / `package.json` engines). |

**Rollback**: revert the merge commit. The streaming code is purely additive — the buffered path is unchanged — so a revert restores v1 behavior including the 50 MB cap. If a partial rollback is needed (e.g., keep the lifted cap, drop the streaming branch), the `isStreamingEligible` predicate is the single boolean to flip to `false`; that disables streaming without touching the rest of the stack.

## Cross-references

- Ticket: [#72 — API connector: stream-parse large unpaginated responses](https://github.com/EnterpriseBT/portal-ai/issues/72).
- Prior art: `docs/LARGE_FILE_PARSE_STREAMING.plan.md`, `docs/SPREADSHEET_PARSER_ROW_ASYNC.{discovery,spec,plan}.md`.
- Upstream code: `apps/api/src/adapters/rest-api/fetch.util.ts` (cap + buffered fetch), `apps/api/src/adapters/rest-api/fetch-first-page.util.ts` (`fetchOnePage` / `fetchFirstPage`), `apps/api/src/adapters/rest-api/rest-api.adapter.ts` (`syncInstance` sync loop), `apps/api/src/constants/api-codes.constants.ts` (ApiCode enum).
- Streaming library: [`stream-json`](https://github.com/uhop/stream-json).
