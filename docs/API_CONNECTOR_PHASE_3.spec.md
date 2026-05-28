# API connector — Phase 3 — Spec

**Widen the connector from "single-shot fetch against one URL" to "paginated, templated, retry-aware fetch against any cooperating REST endpoint." Ships the three pagination strategies beyond `none` (page/offset, cursor, link-header), the closed-set template substitution (`{{cursor}}`, `{{pageNumber}}`), and the `Retry-After`-honoring retry wrapper around every fetch.** After this phase, the connector can ingest APIs whose responses are split across many requests (the common case for SaaS APIs and large open-data endpoints) and survives transient upstream failures without operator intervention.

Discovery: `docs/API_CONNECTOR.discovery.md`. Phase 1 spec: `docs/API_CONNECTOR_PHASE_1.spec.md`. Phase 2 spec: `docs/API_CONNECTOR_PHASE_2.spec.md`.

Resolved phase-3 decisions:

- **Templating scope.** Substitution runs in `headers` values, `queryParams` values, and the POST `bodyTemplate`. Not in `path` — discovery decided against arbitrary path templating; users that need path-based pagination should use a query-param strategy or treat each "page" as a separate endpoint.
- **Templating variable set.** Exactly two: `{{cursor}}` and `{{pageNumber}}`. Substituting any other placeholder is a hard error (`REST_API_TEMPLATE_UNKNOWN_VARIABLE`). Closed-set semantics is what makes templating safe to ship without a sandbox.
- **Pagination scaffolding location.** One iterator function per strategy (`pageOffsetIterator`, `cursorIterator`, `linkHeaderIterator`) living in `apps/api/src/adapters/rest-api/pagination/`. Each iterator is an async generator that yields `{ pageNumber, cursor, response }` tuples. The adapter's per-endpoint sync code is the same async-for-of loop for every strategy — the iterator owns the strategy-specific math.
- **Retry shape.** Wrap every `fetchJson` call inside `syncInstance` and `testConnection` with `withRetry`. The wrapper handles only 429 (`Retry-After`-honoring) and 5xx (exponential backoff `250ms → 8s`, max 5 retries). 4xx errors other than 429 are not retried — they indicate a config problem the user has to fix.
- **`fetchJson` refactor.** Phase 1's wrapper raises on non-2xx. Phase 3 leaves that shape but always attaches `{ status, headers }` to the `ApiError.details`, so `withRetry` can read `Retry-After` without changing the return type.
- **Phase-1 static `headers` and `queryParams` start being applied.** Phase 1 documented them as round-tripped-but-unused. Phase 3 wires them into the URL + RequestInit at sync time. This is a behavioral change on existing endpoints — they remain valid (the columns were nullable / empty by default), but any user who manually populated them now sees them take effect.
- **No `lastSyncAt` variable** — Decision 4 + 8 from discovery dropped it for v1. Incremental sync is v2.

After this phase: a paginated GitHub `/repos/<org>/<repo>/issues` endpoint (cursor via `Link` header, optional auth from phase 2) syncs every page until the link header omits `rel="next"`. A SEC EDGAR or similar government endpoint paginated by `?offset=` paginates through to the end. A SaaS API that returns `429 Retry-After: 30` after burst usage stalls and resumes automatically. Templating in headers + query + body works only for the two declared variables; an unknown variable rejects at save time, not at sync time.

---

## Scope

### In scope

1. **Migration `api_connector_phase_3`** that drops the phase-1 CHECK constraint on `pagination` (which pinned the value to `'none'`) and replaces it with `pagination IN ('none', 'pageOffset', 'cursor', 'linkHeader')`.
2. **`PaginationConfigSchema`** in `packages/core/src/models/api-connector.model.ts` — discriminated union over the four strategies; each non-`none` arm carries strategy-specific config. Composed into a widened `ApiEndpointConfigSchema` so `config.pagination` is a structured object instead of just the table's string column.
3. **`applyTemplate` util** (`apps/api/src/adapters/rest-api/template.util.ts`) — pure function `applyTemplate(input, vars): string` that substitutes the closed set; throws `REST_API_TEMPLATE_UNKNOWN_VARIABLE` on any unrecognized `{{…}}` placeholder.
4. **`applyTemplateToConfig`** helper in the same file — applies `applyTemplate` to every value in a `Record<string, string>` (used for `headers` + `queryParams`).
5. **`withRetry` util** (`apps/api/src/adapters/rest-api/retry.util.ts`) — async wrapper that retries on 429 / 5xx per the resolved policy. Reads `Retry-After` from the `ApiError.details.headers` when present (seconds-since-now or HTTP-date); falls back to exponential backoff `250 * 2^attempt` clamped to `8000ms`. Max 5 retries.
6. **Pagination iterators** (`apps/api/src/adapters/rest-api/pagination/`):
   - `none.iterator.ts` — yields exactly once.
   - `page-offset.iterator.ts` — yields until response array empties (or length < `pageSize`, configurable termination policy).
   - `cursor.iterator.ts` — yields until `cursorResponsePath` resolves to null/undefined/missing.
   - `link-header.iterator.ts` — yields until the response's `Link` header lacks a `rel="next"` link.
   - `index.ts` — `resolveIterator(strategy): Iterator` dispatches by strategy.
7. **Adapter rewrite of the per-endpoint fetch path** in `syncInstance`. Replace phase 1's `for (const endpoint of endpoints)` body with: build the iterator, loop pages, apply templating to URL/headers/body per page, run `applyAuth`, hand to `withRetry`, parse records out of each page, feed to the upsert pipeline.
8. **Apply phase-1 static `headers` and `queryParams`** at fetch time. Empty / null values pass through as no-ops. Templating runs over these values too.
9. **Frontend `ApiEndpointForm` upgrade.** Add a pagination strategy dropdown; render per-strategy sub-forms; add a body-template textarea visible only when method is `POST`. Surface a hint tooltip listing the two template variables.
10. **Frontend validation.** Reject endpoint saves where:
    - `bodyTemplate` references unknown placeholders (lints against the same set as the backend).
    - `headers` / `queryParams` values reference unknown placeholders.
    - Pagination strategy fields are missing (e.g., `cursor` strategy with empty `cursorResponsePath`).
11. **New `ApiCode` entries** — `REST_API_TEMPLATE_UNKNOWN_VARIABLE`, `REST_API_RATE_LIMITED` (only fires after retries exhaust), `REST_API_PAGINATION_INVALID` (pagination config malformed), `REST_API_CURSOR_NOT_FOUND` (cursor strategy and the response doesn't contain the expected path).
12. **Tests.**
    - Migration apply/rollback round-trip.
    - `applyTemplate` unit tests (closed set, unknown placeholder rejection, multi-occurrence, escaping).
    - `withRetry` unit tests (429 with Retry-After seconds, 429 with HTTP-date, exponential backoff on 502, max-retries exhaust → `REST_API_RATE_LIMITED`).
    - Each iterator: termination, page-count correctness, malformed response handling.
    - Adapter integration tests for paginated syncs (one per strategy).
    - Frontend tests for the new form fields + validation.
    - End-to-end test: a mocked paginated endpoint with `Retry-After` injected on page 2 → sync completes correctly and reports the right counts.

### Out of scope

- **Per-instance rate-limit cap** (e.g., "no more than 60 requests per minute, total"). v2.
- **Adaptive backoff** based on observed 429 patterns. v2.
- **Request concurrency control** — phase 3 fetches pages sequentially. Parallel/concurrent page fetch is a v2 optimization, not safe today because most APIs use 429 the moment you exceed their rate.
- **Streaming responses** (`text/event-stream`, chunked NDJSON). v2+.
- **`lastSyncAt` template variable + incremental sync.** v2 per Decision 4.
- **Path templating.** Explicitly out per the resolved decision above.
- **Probe + hybrid column discovery.** Phase 4.
- **Body templating for `GET` methods.** GET requests have no body; the bodyTemplate field is method-conditional in the schema.

---

## Concept changes

### "Page" = one HTTP request's worth of records

A *page* is the unit of fetch. With `none`, one endpoint = one page. With every other strategy, one endpoint = many pages — the iterator decides when to stop. Inside one sync, pages are fetched **sequentially**; the iterator's next call waits for the current page's response.

### Termination policies, made explicit

Each strategy has a stop condition that the iterator owns:

| Strategy | Stops when |
|---|---|
| `none` | The first page has been yielded. |
| `pageOffset` | `recordsPath` resolves to an empty array. Optionally also when `length < pageSize` (saves one wasted request — gated by config). |
| `cursor` | `cursorResponsePath` resolves to `null`, `undefined`, an empty string, or the path doesn't exist on the response. |
| `linkHeader` | The response `Link` header lacks a `rel="next"` member. |

A misbehaving API that never terminates is a real risk; each iterator carries a `maxPages` safety cap (default 1000) and raises `REST_API_PAGINATION_EXCEEDED` past it.

### Template variables and what they mean per strategy

| Variable | When set | Value type |
|---|---|---|
| `{{pageNumber}}` | Always — equals 1 on the first page, increments before each subsequent fetch. | `number` (stringified at substitution). |
| `{{cursor}}` | Set after the first page for `cursor` strategy (lifted from the response); empty string on the first page; unset (substitution → empty string) for other strategies. | `string`. |

A template that uses `{{cursor}}` under a non-`cursor` strategy is *not* an error — it substitutes to empty string. It's a configuration smell, surfaced as a validation warning (not blocking) in the frontend.

### `Retry-After` parsing

The spec allows two forms:

- **Seconds:** `Retry-After: 30` → wait 30 seconds.
- **HTTP-date:** `Retry-After: Wed, 21 Oct 2026 07:28:00 GMT` → wait until that wall-clock time, clamped between 0 and `maxDelayMs * 2` (so a misbehaving server can't lock us for an hour).

`withRetry` parses both. Unparseable values fall back to exponential backoff.

---

## Surface

### Migration

**File:** `apps/api/src/db/migrations/<timestamp>_api_connector_phase_3.sql` (generated)

```sql
ALTER TABLE api_endpoint_configs
  DROP CONSTRAINT api_endpoint_configs_pagination_phase1_check;

ALTER TABLE api_endpoint_configs
  ADD CONSTRAINT api_endpoint_configs_pagination_check
  CHECK (pagination IN ('none', 'pageOffset', 'cursor', 'linkHeader'));
```

No data migration needed; phase-1 rows all have `pagination = 'none'`, which satisfies the new constraint.

### `PaginationConfigSchema` and widened `ApiEndpointConfigSchema`

**File:** `packages/core/src/models/api-connector.model.ts` (edit)

```ts
// ── Pagination strategies (config side) ───────────────────────────────

export const PaginationNoneSchema = z.object({ strategy: z.literal("none") });

export const PaginationPageOffsetSchema = z.object({
  strategy: z.literal("pageOffset"),
  style: z.enum(["page", "offset"]),
  param: z.string().min(1),                       // request param name
  pageSize: z.number().int().positive().default(50),
  pageSizeParam: z.string().optional(),           // optional size param name
  startPage: z.number().int().nonnegative().default(1),
  stopOnShortPage: z.boolean().default(true),     // true → stop when length < pageSize
});

export const PaginationCursorSchema = z.object({
  strategy: z.literal("cursor"),
  cursorParam: z.string().min(1),                 // request param name (e.g., "cursor")
  cursorPlacement: z.enum(["query", "header", "body"]).default("query"),
  cursorResponsePath: z.string().min(1),          // dotted path in response
});

export const PaginationLinkHeaderSchema = z.object({
  strategy: z.literal("linkHeader"),
  // No config — the Link header is fully self-describing per RFC 5988.
});

export const PaginationConfigSchema = z.discriminatedUnion("strategy", [
  PaginationNoneSchema,
  PaginationPageOffsetSchema,
  PaginationCursorSchema,
  PaginationLinkHeaderSchema,
]);
export type PaginationConfig = z.infer<typeof PaginationConfigSchema>;

// ── Widened endpoint config ───────────────────────────────────────────

export const ApiEndpointConfigSchema = z.object({
  path: z.string().min(1),
  method: z.enum(["GET", "POST"]),
  recordsPath: z.string().default(""),
  idField: z.string().nullable().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  queryParams: z.record(z.string(), z.string()).optional(),
  bodyTemplate: z.string().optional(),            // phase 3: now in use; method must be POST
  pagination: PaginationConfigSchema,             // phase 3: required
});
```

`bodyTemplate` is rejected at validation time when `method === "GET"` via a `.refine()` chained onto the schema.

### `applyTemplate` util

**File:** `apps/api/src/adapters/rest-api/template.util.ts` (new)

```ts
export interface TemplateVariables {
  cursor: string;          // empty string before first cursor is captured
  pageNumber: number;
}

const KNOWN_VARIABLES = new Set(["cursor", "pageNumber"]);

export function applyTemplate(input: string, vars: TemplateVariables): string {
  // Replace every {{name}} placeholder. If `name` is in KNOWN_VARIABLES,
  // substitute the string form of vars[name]. If not, throw
  // ApiError("REST_API_TEMPLATE_UNKNOWN_VARIABLE", ..., { name }).
  // Multiple placeholders in one string are all substituted.
}

export function applyTemplateToConfig(
  config: Record<string, string> | undefined,
  vars: TemplateVariables
): Record<string, string> {
  // Map each value through applyTemplate; return the new object.
  // Undefined input returns {}.
}
```

### `withRetry` util

**File:** `apps/api/src/adapters/rest-api/retry.util.ts` (new)

```ts
export interface RetryPolicy {
  maxRetries: number;                // default 5
  baseDelayMs: number;               // default 250
  maxDelayMs: number;                // default 8000
  retryOnStatus: Set<number>;        // default {429, 502, 503, 504}
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 5,
  baseDelayMs: 250,
  maxDelayMs: 8000,
  retryOnStatus: new Set([429, 502, 503, 504]),
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  hooks?: {
    onRetry?: (attempt: number, delayMs: number, status?: number) => void;
  }
): Promise<T> {
  // Try fn(); on ApiError with details.status in retryOnStatus, wait
  // (Retry-After if present, otherwise exp backoff), then retry up to
  // maxRetries times. After max, rethrow the final error as
  // REST_API_RATE_LIMITED (for 429) or REST_API_FETCH_FAILED (others).
}
```

### Pagination iterators

**Files:** `apps/api/src/adapters/rest-api/pagination/` (new directory)

```ts
// pagination/types.ts
export interface PageContext {
  pageNumber: number;       // 1-based
  cursor: string;           // empty on first page; updated by cursor iterator
  isFirstPage: boolean;
  isLastPage: boolean;      // set on the final yield
}

export interface FetchedPage {
  body: unknown;
  headers: Record<string, string>;
  status: number;
}

export type PageIterator = AsyncGenerator<
  PageContext,                          // emitted page context
  void,                                 // return
  FetchedPage                           // value passed back via .next(page)
>;

// pagination/index.ts
export function resolveIterator(config: PaginationConfig): PageIterator;
```

Each iterator yields a `PageContext`, the caller fetches the page and passes the response back via `iterator.next(response)`. The iterator inspects the response, decides whether to continue, and either yields the next `PageContext` or returns.

Reference iterator (cursor):

```ts
export async function* cursorIterator(
  config: PaginationCursorSchema
): PageIterator {
  let cursor = "";
  let pageNumber = 1;

  while (true) {
    const page = yield { pageNumber, cursor, isFirstPage: pageNumber === 1, isLastPage: false };
    const next = walkPath(page.body, config.cursorResponsePath);
    if (next == null || next === "") {
      // emit one final yield with isLastPage so the caller's loop can mark progress
      yield { pageNumber, cursor, isFirstPage: false, isLastPage: true };
      return;
    }
    cursor = String(next);
    pageNumber += 1;
  }
}
```

(The exact shape of the iterator handshake is a slice-time detail; the spec locks the contract that pagination is iterator-driven and that the adapter's per-endpoint code is strategy-agnostic.)

### Adapter rewrite of per-endpoint sync

Phase 1's `syncInstance` body iterated endpoints with a single fetch each. Phase 3 wraps each endpoint in a page loop:

```ts
for (const endpoint of endpoints) {
  const iterator = resolveIterator(endpoint.config.pagination);

  let next = await iterator.next();
  while (!next.done) {
    const { pageNumber, cursor } = next.value;
    const vars: TemplateVariables = { cursor, pageNumber };

    const url = buildUrl(
      instance.config.baseUrl,
      endpoint.config.path,
      applyTemplateToConfig(endpoint.config.queryParams, vars)
    );
    const headers = applyTemplateToConfig(endpoint.config.headers, vars);
    const body = endpoint.config.bodyTemplate
      ? applyTemplate(endpoint.config.bodyTemplate, vars)
      : undefined;

    const init: RequestInit = { method: endpoint.config.method, headers, body };
    const { url: authedUrl, init: authedInit } = applyAuth(url, init, instance.config.auth, credentials);

    const page = await withRetry(() => fetchJson(authedUrl, authedInit));

    const records = walkRecordsPath(page.body, endpoint.config.recordsPath);
    assertArray(records);
    upsertRecords(records, endpoint, runStartedAt);

    next = await iterator.next({ body: page.body, headers: page.headers, status: page.status });
  }
}
```

### Frontend `ApiEndpointForm` upgrade

**File:** `apps/web/src/workflows/RestApiConnector/ApiEndpointForm.component.tsx` (edit)

New fields:

- **Pagination strategy** dropdown (none / pageOffset / cursor / linkHeader). Default `none`.
- **Strategy sub-form** below the dropdown, rendered by mode:
  - `none`: no fields.
  - `pageOffset`: style (page/offset radio), param name, pageSize, pageSizeParam (optional), startPage, stopOnShortPage (checkbox, default on).
  - `cursor`: cursorParam, cursorPlacement (query/header/body), cursorResponsePath.
  - `linkHeader`: no fields.
- **Body template** textarea (rendered only when method === "POST"). Multi-line; hint shows the closed variable set.
- **Hint tooltip** next to the headers / queryParams / body inputs: "Available variables: `{{cursor}}`, `{{pageNumber}}`. Other `{{...}}` placeholders will be rejected on save."

Validation runs through the widened `ApiEndpointConfigSchema` and additional refinements:

- `bodyTemplate` requires `method === "POST"`.
- Strategy-specific required-field checks.
- Unknown-placeholder lint: every templated string is parsed for `{{name}}` patterns; if any `name` isn't `cursor` or `pageNumber`, the form rejects with `REST_API_TEMPLATE_UNKNOWN_VARIABLE`.

### New `ApiCode` entries

| Code | When |
|---|---|
| `REST_API_TEMPLATE_UNKNOWN_VARIABLE` | A template contains `{{name}}` where `name` isn't in the closed set. Fired by both `applyTemplate` and the frontend lint. 400 from route validation. |
| `REST_API_RATE_LIMITED` | `withRetry` exhausted retries on a 429. 502. `details.lastRetryAfter` carries the final Retry-After value. |
| `REST_API_PAGINATION_INVALID` | Pagination config malformed (e.g., cursor without cursorResponsePath). 400. |
| `REST_API_CURSOR_NOT_FOUND` | Cursor strategy and the configured `cursorResponsePath` doesn't exist in the response on page 1 (downgrade: subsequent missing path is the termination signal, not an error). 502. |
| `REST_API_PAGINATION_EXCEEDED` | Iterator hit `maxPages` (default 1000) without terminating — probable misbehaving API or wrong config. 502. |

---

## Failure modes

| Failure | Surface | User-facing copy |
|---|---|---|
| API returns 429 indefinitely | `REST_API_RATE_LIMITED` after 5 retries | "API is rate-limiting us (HTTP 429). Try again later or contact the provider." |
| 5xx persists across all retries | `REST_API_FETCH_FAILED` with `details.lastStatus` | "Upstream returned HTTP <status> repeatedly. Service may be down." |
| Cursor pagination configured but first page doesn't contain the path | `REST_API_CURSOR_NOT_FOUND` | "Couldn't find the cursor at `<path>` in the response. Check the cursor configuration." |
| Iterator runs past `maxPages` | `REST_API_PAGINATION_EXCEEDED` | "Pagination didn't terminate after 1000 pages. Check the configuration." |
| Template references unknown variable | `REST_API_TEMPLATE_UNKNOWN_VARIABLE` (at save time) | "Unknown template variable `{{<name>}}`. Use `{{cursor}}` or `{{pageNumber}}`." |
| All prior failure modes | Same as phases 1–2 | (Unchanged.) |

---

## What this phase doesn't decide

- **Per-instance rate-limit caps** beyond honoring `Retry-After`. Out of v1.
- **Concurrent page fetches.** Phase 3 is strictly sequential per endpoint. Cross-endpoint concurrency (fetching multiple endpoints in parallel) is also sequential; deferred.
- **Partial-success semantics.** If sync fetches 50 pages then page 51 fails after retries, the upserts from pages 1–50 are kept (they used the run's `runStartedAt` watermark). The endpoint's sync result reports the failure; subsequent runs re-fetch from scratch. Other connectors do the same.
- **Iterator state persistence across runs.** Each sync starts pagination from page 1 — no resume. Incremental sync (v2) will pick up the durability concern.
- **Backoff jitter.** Phase 3's `withRetry` uses deterministic exponential backoff without jitter. Adding jitter is a v2 polish if observed multi-tenant herding becomes a concern.
- **Customizing the retry policy per endpoint.** Default policy applies everywhere; per-endpoint overrides are a v2 polish.

---

## Next step

Phase 3 plan: `docs/API_CONNECTOR_PHASE_3.plan.md`. Slicing target: ~7 slices — migration + Zod first (leaf), `applyTemplate` second (leaf), `withRetry` third (leaf), per-strategy iterators fourth (leaf), adapter rewrite fifth (integration), frontend ApiEndpointForm sixth, end-to-end paginated integration test seventh.
