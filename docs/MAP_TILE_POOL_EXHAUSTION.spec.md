# Map tiles exhausting the DB pool — Spec

This spec pins the contract for [#698](https://github.com/EnterpriseBT/portal-ai/issues/698): simplify line/point tiles per geometry kind, a per-process tile admission gate, cancelling DB work its client has abandoned, and a request-level DB admission deadline. It turns the recommendation in [`MAP_TILE_POOL_EXHAUSTION.discovery.md`](./MAP_TILE_POOL_EXHAUSTION.discovery.md) into a contract.

## Key decisions (flag for review)

1. **Line/point tiles use `ST_Simplify`; polygons keep `ST_SimplifyPreserveTopology`.** Measured on the real layer: z3 tile 2,731 → 363 ms, and the features lost are < 0.4 px.
2. **One admission gate per process wraps the tile query work** (`runTileQuery`, after the 304 short-circuit). Limits: concurrency **4**, queue **8**, wait **5 s**, at most **2 slots per org**. Overload returns `503 MAP_TILE_BUSY` + `Retry-After: 2`. The gate **fails closed for tiles** so everything else stays available.
3. **Discovery's open question 1 is resolved: cancellation is possible without a spike.** postgres.js 3.4.9 `Query.cancel()` handles both states. A query still waiting for a connection is removed from the pool queue and rejected with `57014` (`node_modules/postgres/src/index.js:350-362`). An active query is cancelled through a protocol-level cancel request on a short-lived socket, so it **never needs a pool slot** (`connection.js:145`). Drizzle 0.45.2 sends every statement through `client.unsafe()`, including a transaction's `begin` and its in-transaction statements (`drizzle-orm/postgres-js/session.js:33-43,103-109`). A wrapper around the postgres.js instance therefore sees every `Query` before it runs.
4. **The cancel policy has two settings.** The default, `"before-start"`, only cancels a request's queries while it has **not yet started DB work**: no write ever gets half-applied. Tile routes opt into `"always"`, which also cancels running statements; that is safe because tile transactions are read-only and always roll back.
5. **Admission deadline: 30 s per query, enforced only before the request has started DB work** (resolves discovery Q4–Q5). It applies inside a request context only, so workers are untouched.
6. **The client honours `503 MAP_TILE_BUSY`.** It shows a distinct "busy" notice and pauses the tab's tile queue for the `Retry-After` window.

## Scope

### In scope
- Per-kind simplify in `buildRawTileSql` and `buildLineHybridTileSql`.
- `AdmissionGate` utility; the tile gate instance; `MAP_TILE_BUSY` + `Retry-After` (exposed via CORS).
- A per-request `AbortSignal` and DB cancel state in `RequestContext`, set by `requestContextMiddleware`.
- `instrumentSqlForRequests()` wrapping the pool handed to drizzle: request-scoped cancel + admission deadline.
- Typed errors `DB_ADMISSION_TIMEOUT` (503) and `REQUEST_ABANDONED` (499); `mapTileError` and the app error handler both understand them.
- Web: `TileStatus.busy`, the `Retry-After` pause, and the busy notice.
- Structured log fields for gate rejections and cancellations.

### Out of scope
- A vertex budget for `fitsWholeLayer`, mutation idempotency, changing pool/RDS size, splitting workers out, and a DB-aware health check (see discovery → *What this doesn't decide*).
- Making pool size an env var.

## Surface

### 1. Per-kind simplify — `apps/api/src/services/portal-map-tile.service.ts`

```ts
/** Simplify expression for one geometry kind. Polygons keep topology (ring
 *  validity); lines/points use Douglas-Peucker. tolerance 0 → bare expr. */
export function tileSimplifyExpr(
  geomExpr: string,
  tolerance: number,
  kind: MapLayerKind | null
): string;
// "polygons"           → `ST_SimplifyPreserveTopology(${geomExpr}, ${tolerance})`
// "lines" | "points"   → `ST_Simplify(${geomExpr}, ${tolerance})`
// null (unknown kind)  → `ST_SimplifyPreserveTopology(...)` (the safe pre-#698 default)
```

- `buildRawTileSql(pipelineSql, envelope, propertyColumns, tolerance, cap, rankByLength = false, kind: MapLayerKind | null = null)`: the new trailing `kind` replaces the hard-coded SPT at `:594`.
- `buildLineHybridTileSql(pipelineSql, z, envelope, tolerance, cap)` always uses `tileSimplifyExpr("r.g", tolerance, "lines")`, replacing the SPT at `:687`.
- The call sites at `:862` and `:897` pass `aggregation.kind`. `TileAggregation.kind` already exists, set by `aggregationFromSpec` at `:365`.

### 2. `AdmissionGate` — new `apps/api/src/utils/admission-gate.util.ts`

```ts
export interface AdmissionGateOptions {
  concurrency: number;   // max holders at once
  maxQueue: number;      // max waiters; beyond → "queue_full"
  maxWaitMs: number;     // a waiter not admitted in time → "timeout"
  perKeyLimit: number;   // max concurrent holders per key (org)
}
export type GateRejectReason = "queue_full" | "timeout" | "aborted";
export class GateRejectedError extends Error {
  constructor(readonly reason: GateRejectReason) { super(`admission rejected: ${reason}`); }
}
export class AdmissionGate {
  constructor(opts: AdmissionGateOptions);
  /** Run `fn` holding one slot for `key`. Waiters are admitted FIFO, skipping a
   *  waiter whose key is at `perKeyLimit` (so a busy org can't block another
   *  org behind it). The slot is released when `fn` settles (resolve or reject).
   *  An abort while queued removes the waiter and rejects "aborted"; an abort
   *  while holding does NOT release early (fn owns its own cancellation). */
  run<T>(key: string, signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T>;
  /** Observability: { active, queued, activeByKey } snapshot. */
  stats(): { active: number; queued: number; activeByKey: Record<string, number> };
}
```

- Plain in-memory and per-process: no Redis and no timers when nothing is queued. One `setTimeout` per waiter, cleared on admission or abort.

### 3. The tile gate — `portal-map-tile.service.ts`

```ts
export const TILE_GATE_CONCURRENCY = 4;
export const TILE_GATE_MAX_QUEUE = 8;
export const TILE_GATE_MAX_WAIT_MS = 5_000;
export const TILE_GATE_PER_ORG = 2;
export const TILE_BUSY_RETRY_AFTER_S = 2;
export const tileAdmissionGate = new AdmissionGate({ concurrency: TILE_GATE_CONCURRENCY, maxQueue: TILE_GATE_MAX_QUEUE,
  maxWaitMs: TILE_GATE_MAX_WAIT_MS, perKeyLimit: TILE_GATE_PER_ORG });
```

- `RenderTileDeps` gains `gate?: Pick<AdmissionGate, "run">`, which defaults to `tileAdmissionGate`.
- In `renderTile`, the `runTileQuery(...)` call (`:1393`) becomes `gate.run(organizationId, getRequestSignal(), () => runTileQuery(...))`.
- The 304 short-circuit (`:1379`), the pipeline resolution and the scope hash all stay **outside** the gate. One slot covers the probe and the follow-up txn, which run sequentially on one connection at a time.
- When the gate rejects: `queue_full`/`timeout` → `ApiError(503, ApiCode.MAP_TILE_BUSY, "Map tiles are busy — retry shortly", { details: { retryAfterSeconds: TILE_BUSY_RETRY_AFTER_S } })`. `aborted` → `REQUEST_ABANDONED`.
- Every rejection logs `warn` with `{ gate: "map-tile", reason, organizationId, ...stats() }`.

### 4. Tile router — `apps/api/src/routes/portal-map.router.ts`

- `handle()` calls `setDbCancelPolicy("always")` before `renderTile`.
- On an `ApiError` with code `MAP_TILE_BUSY`, it sets `Retry-After: <retryAfterSeconds>` before `next(err)`.
- Both tile routes' `@openapi` blocks gain a `503` response (`MAP_TILE_BUSY`, `Retry-After` header) using the same error-body `$ref` as the existing `504`.
- `apps/api/src/app.ts:69`: `exposedHeaders` adds `"Retry-After"`. It isn't one of the response headers browsers let scripts read by default, so without this `fetch` can't see it.

### 5. Request context — `apps/api/src/utils/request-context.util.ts`

```ts
export type DbCancelPolicy = "before-start" | "always";
export type DbCancelReason = "client_gone" | "admission_timeout";
export interface RequestContext {
  log: pino.Logger;
  memo?: Map<string, unknown>;
  /** Fires once when the client disconnects before the response finished. */
  signal?: AbortSignal;
  dbCancelPolicy?: DbCancelPolicy;          // default "before-start"
  /** Set by the SQL instrumentation when it cancels a query of this request. */
  dbCancelReason?: DbCancelReason;
  /** True once any of this request's queries has acquired a connection. */
  dbStarted?: boolean;
}
export function getRequestSignal(): AbortSignal | undefined;
export function setDbCancelPolicy(policy: DbCancelPolicy): void;   // no-op outside a request
export function getDbCancelReason(): DbCancelReason | undefined;
```

`requestContextMiddleware` (`middleware/request-context.middleware.ts`) creates an `AbortController` per request and registers `res.on("close", () => { if (!res.writableFinished) controller.abort("client_gone"); })`. It then runs `next()` inside `{ log, signal: controller.signal }`.

### 6. SQL instrumentation — new `apps/api/src/db/request-cancellation.util.ts`

```ts
export const DB_ADMISSION_MAX_WAIT_MS = 30_000;
/** Wrap a postgres.js `Sql` so every Query created inside a request context is
 *  tracked for cancellation. Outside a request context (workers, scripts, tests
 *  without the middleware) it is a pure passthrough. */
export function instrumentSqlForRequests<T extends postgres.Sql>(sql: T, opts?: { maxWaitMs?: number }): T;
/** Map a 57014 caused by request cancellation to its typed ApiError; undefined otherwise. */
export function toDbCancellationApiError(err: unknown): ApiError | undefined;
```

Behaviour, per `Query` created via `unsafe()` on the root sql or on a `begin`/`savepoint` scope (the wrapper wraps the scoped `sql` handed to the transaction callback):

| Event | `"before-start"` (default) | `"always"` (tiles) |
|---|---|---|
| Request signal already aborted at creation | cancel if `!dbStarted` | cancel |
| Signal aborts while the query is queued (no `state`) | cancel if `!dbStarted` → reason `client_gone` | cancel → `client_gone` |
| Signal aborts while the query is active (`state` set) | **not cancelled** | cancel → `client_gone` |
| Query still queued `maxWaitMs` after creation, request has not started | cancel → `admission_timeout` | cancel → `admission_timeout` |
| Query acquires a connection or settles successfully | `dbStarted = true`; deadline timer cleared | same |

- Timers and listeners are removed when the query settles.
- `client.ts` hands `drizzle()` `instrumentSqlForRequests(connection)`. `reserveConnection` and `closeDatabase` keep using the raw `connection`.
- `toDbCancellationApiError`: `unwrapPgError(err).code === "57014"` with `getDbCancelReason()` set gives `admission_timeout` → `ApiError(503, DB_ADMISSION_TIMEOUT, "The database is busy — retry shortly")`, and `client_gone` → `ApiError(499, REQUEST_ABANDONED, "Client disconnected")`.
- Each cancel logs `{ dbCancel: reason, policy, queued: !state }`: `warn` for `admission_timeout`, `info` for `client_gone`.

### 7. Error mapping

- `mapTileError` (`:87`) checks `toDbCancellationApiError(err)` **first**, so a cancelled tile is never reported as `MAP_TILE_TIMEOUT`.
- In the app error handler (`app.ts:100`), a non-`ApiError` error goes through `toDbCancellationApiError` before the generic 500. `REQUEST_ABANDONED` logs at `info` and skips the write when `res.destroyed`.
- `ApiCode` additions (`constants/api-codes.constants.ts`, each with a JSDoc citing #698): `MAP_TILE_BUSY`, `DB_ADMISSION_TIMEOUT`, `REQUEST_ABANDONED`.

### 8. Web — `apps/web/src/modules/MapWidget/`

- `utils/tile-source.util.ts`: `TileStatus` gains `busy: boolean` (`EMPTY_TILE_STATUS.busy = false`). `readTileStatus`: `busy: status === 503`, and `failed` excludes both 503 and 504.
- `utils/tile-protocol.util.ts`:
  - `export function parseRetryAfter(value: string | null): number` gives milliseconds: integer seconds clamped to **[1, 30]**, defaulting to 2 when missing or invalid.
  - `export function pauseTileFetches(ms: number): void` holds new slot grants until `now + ms`. A longer pause extends it; a shorter one never shortens it.
  - `fetchTile` calls `pauseTileFetches(parseRetryAfter(res.headers.get("Retry-After")))` on a 503 before throwing.
  - Tiles waiting during a pause still drop on abort (the #350 behaviour).
- `MapWidget.component.tsx`: a busy notice `data-testid="map-widget-tile-busy"` reading "Map server is busy — tiles will load when you pan or zoom." It sits alongside the existing timeout/failed notices.

## Migration

None. There's no schema change.

## Seed

None.

## TDD test plan

Run each package's own scripts: `npm run test:unit` / `npm run test:integration` in `apps/api`, and `npm run test:unit` in `apps/web` (with `--testPathPattern` locally).

### `apps/api` — unit
- **`__tests__/utils/admission-gate.util.test.ts` (new)**, 11 cases:
  - admits up to `concurrency`, FIFO after that
  - `queue_full` beyond `maxQueue`
  - `timeout` after `maxWaitMs` (fake timers)
  - abort while queued → `aborted`, and the waiter is removed
  - abort while holding doesn't release
  - a slot is released when `fn` rejects
  - `perKeyLimit` skips a capped key's waiter in favour of another key
  - `stats()` reflects the state
  - no timer leaks after drain
  - concurrent release ordering
  - per-key count drops back to 0
- **`__tests__/db/request-cancellation.util.test.ts` (new)**, 11 cases, using fake `Query` objects (`state`, `cancel`, thenable) and a fake `Sql`:
  - passthrough outside a request context
  - queued + abort, `"before-start"` → cancelled with reason `client_gone`
  - active + abort, `"before-start"` → not cancelled
  - active + abort, `"always"` → cancelled
  - abort after `dbStarted` → later queued query not cancelled under `"before-start"`
  - deadline fires on a queued query → `admission_timeout`
  - deadline doesn't fire once the query acquired a connection
  - listeners and timers are cleared on settle
  - `begin` scope wraps the inner sql
  - `toDbCancellationApiError` maps both reasons
  - `toDbCancellationApiError` ignores a plain 57014 with no reason
- **`__tests__/services/portal-map-tile.service.test.ts` (extend)**, 9 cases:
  - `tileSimplifyExpr` per kind, including null and tolerance 0
  - `buildRawTileSql` with `"lines"` contains `ST_Simplify(` and not `ST_SimplifyPreserveTopology`
  - `buildRawTileSql` with `"polygons"` keeps SPT
  - `buildLineHybridTileSql` uses `ST_Simplify(`
  - `renderTile` runs `runTileQuery` through `deps.gate` with the org key
  - the 304 path never calls the gate
  - gate `queue_full` → `MAP_TILE_BUSY` 503 with `retryAfterSeconds`
  - gate `aborted` → `REQUEST_ABANDONED`
  - `mapTileError` prefers the cancellation mapping over `MAP_TILE_TIMEOUT`
- **`__tests__/middleware/request-context.middleware.test.ts` (new or extend)**, 3 cases: the signal aborts on `close` before finish; it doesn't abort after a normal finish; the default policy is `"before-start"`.

### `apps/api` — integration (real Postgres)
- **`__tests__/__integration__/db/request-cancellation.integration.test.ts` (new)**, 6 cases. Each uses its own `postgres(url, { max: 1 })` wrapped by `instrumentSqlForRequests` and run inside `requestContext.run`, with one connection held by `pg_sleep`:
  - a queued `INSERT` cancelled by abort never executes (the row is absent)
  - a queued `INSERT` past `maxWaitMs` (set to 200 ms) never executes and maps to `DB_ADMISSION_TIMEOUT`
  - an active `pg_sleep(5)` under `"always"` returns `57014` within ~1 s, and `pg_stat_activity` shows it gone
  - an active statement under `"before-start"` runs to completion after abort
  - a transaction's `begin` queued past the deadline rejects, with no partial writes
  - no request context → nothing is cancelled
- **`__tests__/__integration__/routes/portal-map.router.integration.test.ts` (extend)**, 4 cases:
  - a lines layer tile still renders features (the fast path) with `ST_Simplify`
  - an injected saturated gate → `503`, body code `MAP_TILE_BUSY`, `Retry-After: 2`
  - the CORS response exposes `Retry-After`
  - the 503 is documented in the OpenAPI spec (`/api/docs/spec`)
- **`__tests__/__integration__/db/map-aggregation.integration.test.ts` (extend)**, 1 case: a ranked raw lines tile built with `"lines"` returns the same feature set as before for non-sub-pixel lines.

### `apps/web` — unit
- **`modules/MapWidget/__tests__/tile-protocol.util.test.ts` (extend)**, 5 cases:
  - a 503 pauses the next slot grant for the `Retry-After` window (fake timers)
  - `parseRetryAfter`: missing gives 2 s, `"0"` clamps to 1 s, `"999"` clamps to 30 s
  - a longer pause extends, a shorter one doesn't shorten
  - an abort during the pause drops the queued tile
  - a 503 still throws, so MapLibre retries
- **`modules/MapWidget/__tests__/tile-source.util.test.ts` (extend or new)**, 2 cases: 503 → `busy` and not `failed`; 504 → `timedOut` only.
- **`modules/MapWidget/__tests__/MapWidget.test.tsx` (extend)**, 1 case: the busy status renders `map-widget-tile-busy`.

**Totals ≈ 53 cases** (34 api unit, 11 api integration, 8 web unit).

## Acceptance criteria

- [ ] On app-dev, the contour portal (`a57a7db1…`) renders contours at z2–z10 with no `MAP_TILE_TIMEOUT`. A warm z3 tile serves in < 1 s.
- [ ] While any map is open, each API task holds **≤ 4** tile query connections, and other endpoints (lists, portal delete) answer at their normal latency.
- [ ] A tile request the browser abandons stops consuming a DB connection within ~1 s (`pg_stat_activity`). No `MAP_TILE_TIMEOUT` is logged for an aborted tile.
- [ ] When the tile gate is saturated, the client receives `503 MAP_TILE_BUSY` with a readable `Retry-After`, the busy notice shows, and the tab's tile fetches pause for that window.
- [ ] A request whose first DB operation can't get a connection within 30 s fails with `503 DB_ADMISSION_TIMEOUT` and applies **no** write. A request whose client is gone before its first DB operation never executes it.
- [ ] Workers and scripts (no request context) behave exactly as before.
- [ ] Polygon tiles are unchanged (they still use SPT).

## Risks & rollback

- **The instrumentation relies on postgres.js internals.** `Query.cancel()` is public, but `Query.state` (used to tell queued from active) is internal. A major upgrade could change it silently. *Detection:* the integration suite above runs against the real driver; `postgres` stays on `^3.4.x`. *Fail mode:* if `state` disappeared, every query would look queued, so `"before-start"` would cancel more than intended on disconnect. The integration test "active statement under before-start completes" catches exactly that.
- **The gate fails closed for tiles.** A mis-sized gate shows a busy map, not a broken app, and that trade is the point of the design. *Rollback:* raise the constants, or revert the gate commit on its own (each surface lands in its own slice).
- **False `REQUEST_ABANDONED` cancels.** `res.on("close")` before finish only fires on a real client disconnect. The `"before-start"` policy means it never interrupts started work.
- **Simplify output.** `ST_Simplify` can drop sub-pixel lines that SPT kept. They were invisible (< 0.4 px), and polygons don't change.

## Files touched

- **Edit:** `apps/api/src/services/portal-map-tile.service.ts`, `apps/api/src/routes/portal-map.router.ts`, `apps/api/src/app.ts`, `apps/api/src/db/client.ts`, `apps/api/src/utils/request-context.util.ts`, `apps/api/src/middleware/request-context.middleware.ts`, `apps/api/src/constants/api-codes.constants.ts`
- **New:** `apps/api/src/utils/admission-gate.util.ts`, `apps/api/src/db/request-cancellation.util.ts`
- **Edit (web):** `apps/web/src/modules/MapWidget/utils/tile-source.util.ts`, `apps/web/src/modules/MapWidget/utils/tile-protocol.util.ts`, `apps/web/src/modules/MapWidget/MapWidget.component.tsx`
- **Tests:** as listed in the TDD plan.
- **Docs:** none of the durable docs describe tile limits. The *Async Job State* / *API Style Guide* sections of `CLAUDE.md` gain one bullet on the request cancel policy (so new long-running read routes know they can opt into `"always"`), mirrored to `.github/copilot-instructions.md`.

## Next step

`/plan 698` writes `docs/MAP_TILE_POOL_EXHAUSTION.plan.md` as about six TDD slices, each one commit on this branch:
1. Per-kind simplify. It fixes the contour map alone.
2. `AdmissionGate` utility.
3. Request context signal + SQL instrumentation + typed errors.
4. Tile gate + router (`MAP_TILE_BUSY`, `Retry-After`, CORS, OpenAPI, `"always"` policy).
5. Web busy state + `Retry-After` pause.
6. CLAUDE.md convention bullet + logging polish.
