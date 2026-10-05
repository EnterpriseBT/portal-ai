# Map tiles exhausting the DB pool — Discovery

**Issue:** [EnterpriseBT/portal-ai#698](https://github.com/EnterpriseBT/portal-ai/issues/698)

**Why this exists.** Opening a portal with a high-vertex `lines` map (6,452 contour linestrings, 1.32M vertices) takes app-dev down for every user for minutes, and it reproduces every time. Each low-zoom tile costs ~2.7s of CPU, ~90% of it in `ST_SimplifyPreserveTopology`. On the 2-vCPU RDS, ten concurrent tiles all pass the 10s `statement_timeout`, none succeed, and the map asks again. The failure sustains itself. Meanwhile tiles hold all 10 connections of the API's only pool. Every other route waits with no time limit, tiles the browser cancelled keep running, and requests the ALB cut off at 180s still execute their writes minutes later (a portal delete ran 3×).

The ticket has two halves, and both must ship. The **trigger** is a tile SQL simplify that is wrong for lines. The **blast radius** comes from having no server-side admission control or cancellation for DB work. Fixing the first fixes this layer. The second fix is what stops the next expensive query, tile or not, from becoming an outage of the whole app. This is the change that makes one slow widget degrade only itself.

## The current shape

### Tile request lifecycle

| Piece | Location | Note |
|---|---|---|
| Routes (message / pin) | `apps/api/src/routes/portal-map.router.ts:194`, `:230` → `handle()` `:130` | No `req`/`res` `close` handling. The header (`:9-12`) says tiles are kept out of the viz rate window on purpose, with `statement_timeout` as their only guard |
| `renderTile` | `portal-map-tile.service.ts:1292` | `resolvePipeline` (pooled reads + auth) → scope hash (memoized) → ETag/304 short-circuit `:1379` → `runTileQuery` (injectable) `:1393` |
| `defaultRunTileQuery` | `:727` | `validatedPipeline` → dissolve path, or points/lines: `fitsWholeLayer` (`:855`) → one raw txn. Otherwise a `cap+1` probe txn and, if over the cap, a second hybrid/aggregate txn |
| `runSessionViewTile` | `:988` | Builds views **outside** the txn on purpose (`:982-986`, #314 pool deadlock), then `db.transaction` → `openSqlSession` (`portal-sql.service.ts:182`: `DISCARD TEMP`, `SET LOCAL statement_timeout`, view DDL, reader role, read-only) → rollback via the `TileTxResult` sentinel |
| SQL builders | `buildRawTileSql` `:584` (SPT at `:594`), `buildLineHybridTileSql` `:677` (SPT at `:687`) | Builders never see `kind`, only the `rankByLength` boolean (`aggregationFromSpec` `:391`). `aggregation.kind` is available at the call sites `:862/:897/:919` |
| Timeout mapping | `TILE_STATEMENT_TIMEOUT_MS` `:78`; `mapTileError` `:87` | pg `57014` → `504 MAP_TILE_TIMEOUT` |

A tile makes a few short pooled reads (middleware org/user metadata, pipeline + auth, view build), then holds **one connection for the whole txn**, or two in sequence on the probe path. The heavy part is the txn.

### DB pool and who shares it

| Piece | Location | Note |
|---|---|---|
| The one pool | `apps/api/src/db/client.ts:32` | postgres.js `^3.4.8`, `max: 10`, `connect_timeout: 10`. **No acquire/queue-wait timeout**; no env var for size |
| Reserved connections | `client.ts:46-57` | Invariant: reserved connections stay well below `max`. Today one per running sync (advisory lock, #460) |
| In-process workers | `apps/api/src/index.ts:25-26` | Jobs worker `concurrency: 2` (`queues/jobs.worker.ts:303`) and maintenance `concurrency: 1` (`maintenance.worker.ts:52`) **share the same 10 connections** |
| Cancellation | — | No `.cancel()` and no `pg_cancel_backend` anywhere in `apps/api/src` |

### Existing primitives

| Primitive | Location | Fit |
|---|---|---|
| `pLimit` | `apps/api/src/adapters/rest-api/p-limit.util.ts` | Unbounded queue, no wait timeout, no abort. Wrong shape for admission control |
| Disconnect hooks | `routes/portal-events.router.ts:312`, `routes/job-events.router.ts:146` | `req.on("close")`, used only by the SSE routes |
| Request context | `request-context.middleware.ts`, `utils/request-context.util.ts` (`memoizeForRequest`) | Per-request AsyncLocalStorage. The natural carrier for a request `AbortSignal` / deadline |
| `withTimeout` | `utils/timeout.util.ts` | Rejects when time runs out, but the operation keeps running underneath |
| Server timeouts | `index.ts:83` | `requestTimeout`/`keepAliveTimeout` left at Node defaults; no request-timeout middleware |

### Error surface and client

- **Codes.** `MAP_TILE_NOT_FOUND` / `MAP_TILE_TIMEOUT` (`api-codes.constants.ts:473/:478`). The nearby 503 is `PORTAL_SQL_UNAVAILABLE` (`:528`). No busy/overload code exists, and no route sets `Retry-After`.
- **Client.** `tile-protocol.util.ts:54` limits fetches to 6 per tab and frees a slot on abort (`:121`). Failures are thrown and not cached, and MapLibre asks again on the next pan/zoom (`:137`). `readTileStatus` (`tile-source.util.ts:52`): 504 → `timedOut`, other ≥400 → `failed`. Notices: `MapWidget.component.tsx:363` (timeout), `:372` (failed, "pan or zoom to retry").

### Infra

- **API.** One ECS service runs API and workers together (`backend.yml:671`). Dev: 1 task, 512 CPU. Prod: 2 tasks (`deploy-prod.yml:616`), so the DB sees up to 2 × 10 connections.
- **RDS.** `db.t4g.micro` in both envs (`database.yml:9-11`, `deploy-prod.yml:154`).
- **ALB.** Idle timeout 180s (`backend.yml:473`, sized for the synchronous XLSX parse).

### Measurements (app-dev, the real layer, read-only)

| z3/1/3 tile (5,613 lines), warm, uncontended | ms |
|---|---|
| Production SQL (`ST_SimplifyPreserveTopology`) | 2,731 |
| Same, `ST_Simplify` | **363** |
| Clip to tile box (`ST_ClipByBox2D`) → SPT / → `ST_Simplify` | 1,661 / 359 |
| Production SQL, cold cache | 14,878 |

`ST_Simplify` drops 1,242 of 3,259 features from the tile. All of them are ≤ 5.7 tile units long (< 0.4 px), so `ST_AsMVTGeom` would have collapsed them anyway.

## The design space

### Decision 1 — Line/point simplification in tile SQL

- **A. Choose the simplify by kind.** Polygons keep `ST_SimplifyPreserveTopology` (ring validity); lines and points use `ST_Simplify`. One parameter added to both builders.
- **B. Clip to the tile box first, keep SPT for everything.** This helps a single huge geometry that mostly lies off-tile.
- **C. Precompute per-band simplified line geometry,** like the polygon dissolve (#542).

| | A | B | C |
|---|---|---|---|
| Measured z3 | 363 ms | 1,661 ms | ~fetch cost |
| Visual change | none (< 0.4 px) | none | none |
| Size | small, local | small | new table + job + invalidation |

**Lean: A.** It is 7.5× faster, the output is the same to the eye, and it's a local change. B is a fifth as effective, and C is infrastructure without a measured need once A lands (see What this doesn't decide).

### Decision 2 — Bounding tile DB work on the server

- **A. A tile admission gate per process.** An async semaphore around the tile **txn only** (not the cheap reads, not the 304 path), sized well below pool `max`. It has a **bounded queue** and a **bounded wait**. Overflow or a timed-out wait fails fast with a typed `503 MAP_TILE_BUSY` + `Retry-After`.
- **B. A separate, smaller pool for tiles.** This isolates connections by construction, but adds connections to the DB (2 tasks × (10 + N) on a micro instance). It also doesn't bound CPU contention any better than A, and the session-view path would need its own drizzle instance.
- **C. A distributed limiter (Redis) across tasks.** It gives an exact global cap, but adds a network hop per tile and a new failure mode. The DB-side total is already bounded by tasks × A's cap.
- **D. Postgres-side** (a role with a `CONNECTION LIMIT` for tile sessions). That limits connections, not queueing: the API would still block waiting to connect.

| | A | B | C | D |
|---|---|---|---|---|
| Protects other routes | yes | yes | yes | partly |
| Extra DB connections | 0 | +N per task | 0 | 0 |
| Fails fast instead of queueing | yes | no (unless also gated) | yes | no |
| New dependency | none | none | Redis on the hot path | DB role |

**Lean: A.** It's the only option that both protects the rest of the pool and turns overload into a fast, visible, typed failure. The per-process bound is the right unit, because each process owns its own pool.

### Decision 3 — Cancelling tile work the client abandoned

- **A. A per-request `AbortSignal`** (fired on `req` `close` before `res` finishes, carried in the request context). A tile waiting at the gate is dropped. A running tile query is cancelled with **postgres.js's cancel request** (`PendingQuery.cancel()`), which opens a short protocol-level connection rather than taking a pool slot.
- **B. `pg_cancel_backend(pid)`** from a second pooled query. This needs a free pool connection, which is exactly what is missing when cancellation matters most.
- **C. No cancel; lower `statement_timeout` only.** This shortens the waste but still burns CPU and slots on abandoned work.

**Lean: A.** B deadlocks under the very condition it exists for, and C treats the symptom. Reaching postgres.js's `PendingQuery` from inside a drizzle transaction is the main spike risk (Open question 1).

### Decision 4 — Requests the client gave up on must not start writes later

- **A. An admission deadline on DB acquisition for every request.** A request that hasn't *started* its first DB operation within a deadline (well under the ALB's 180s), or whose client has gone, fails with a typed `503`. A request that **has** started is left to finish: interrupting a non-transactional multi-write handler halfway would leave partial state, which is worse than a late write.
- **B. Cancel every in-flight request on disconnect, writes included.** That's safe only inside a transaction, and many handlers don't wrap their writes in one (portal delete = reset messages + delete).
- **C. Set Node's `server.requestTimeout` under 180s.** It closes the socket but leaves the handler running, which is the same bug.

**Lean: A.** It closes the case that actually happened (a delete waited ~4 minutes at the pool and ran after the client was gone) without risking half-finished writes. With Decision 2 in place the pool should rarely saturate; this is the backstop for any route. Idempotency against client retries is a separate concern (What this doesn't decide).

### Decision 5 — How the client reacts to `503 MAP_TILE_BUSY`

- **A.** Map it to the existing `failed` notice ("pan or zoom to retry").
- **B.** A dedicated "map is busy" notice, and the protocol pauses fetches for the `Retry-After` window so a busy server isn't hammered.

**Lean: B.** The busy state is the server asking for backoff. Pausing the tab's tile queue for `Retry-After` is a small change in `tile-protocol.util.ts`, and it's what stops the client half of the feedback loop.

## Tradeoff comparison

|  | D1 per-kind simplify | D2 tile gate | D3 abort → cancel | D4 admission deadline | D5 busy backoff |
|---|---|---|---|---|---|
| Package | api | api | api | api | web |
| Fixes the trigger | ✓ | — | — | — | — |
| Bounds the blast radius | — | ✓ | ✓ | ✓ | ✓ |
| New pattern | no | yes | yes | yes | no |
| Spread to spec | Yes | Yes | Yes | Yes | Yes |

## Recommendation

1. `buildRawTileSql` and `buildLineHybridTileSql` take the layer kind and simplify with `ST_Simplify` for `lines`/`points` and `ST_SimplifyPreserveTopology` for polygons.
2. A per-process tile admission gate wraps each tile **transaction** (probe, raw, aggregate, hybrid and dissolve serves). It has a fixed concurrency below pool `max`, a bounded queue, and a bounded wait, failing fast with `503 MAP_TILE_BUSY` + `Retry-After`. New `ApiCode.MAP_TILE_BUSY`, registered in the OpenAPI annotations of both tile routes.
3. A per-request `AbortSignal` (fired on client disconnect) is carried in the existing request context. A tile waiting at the gate is dropped. A running tile query is cancelled through the driver's cancel request, never through a pooled `pg_cancel_backend`.
4. Every request's first DB operation is checked against an admission deadline (below the ALB idle timeout) and the abort signal. One that can't start in time, or whose client is gone, fails with a typed `503` **before** any write. Started work is never interrupted.
5. The web tile protocol treats `503 MAP_TILE_BUSY` as a distinct busy state: its own notice, and the tab's tile queue pauses for the `Retry-After` window.
6. Gate saturation, queue rejections and cancellations are logged with structured fields, so the next incident is diagnosable from CloudWatch.

## Open questions

1. **Can a running query inside a drizzle `db.transaction` be cancelled?** Drizzle's postgres-js session runs queries through the transaction's `sql`. Cancelling needs the `PendingQuery` (or a way to cancel the transaction's backend through postgres.js's cancel protocol). **Lean: spike it first in the plan.** If drizzle doesn't expose it, run the tile's single heavy statement through the transaction's raw postgres.js client (`tx` session client `.unsafe()`), keeping the session/DDL path on drizzle. Fall back to C (lower `statement_timeout`) only if both fail, and record it as a conscious downgrade.
2. **Gate size and pool budget.** 10 connections are shared with up to 3 worker connections plus a reserved sync lock. **Lean: tile concurrency 4, queue 8, wait 5s.** That always leaves ≥ 2 connections for request traffic even with every worker busy. Use named constants beside `MAP_TILE_FEATURE_CAP`; making pool size an env var is out of scope.
3. **Per-org fairness inside the gate.** One org's heavy map can take every tile slot in a process, starving other orgs' maps (not their other API use). **Lean: a per-org share of the global slots** (at most `ceil(cap / 2)` per org). It costs one counter map and closes the noisy-neighbor gap. Multi-tenant isolation is the default lens here.
4. **Where the admission deadline hooks in (Decision 4).** postgres.js has no acquire timeout, and drizzle acquires internally. **Lean: wrap the postgres.js instance handed to drizzle** (`client.ts`) so each top-level query or `begin` checks the request context's signal and deadline before queueing, and a still-queued query is cancelled when they fire. Spike it in the same slice as question 1, since both depend on postgres.js's cancel. Worker code runs outside any request context and is unaffected.
5. **Deadline value.** **Lean: 30s** for the request-level admission deadline. It's far under the ALB's 180s, and any request that can't get a connection in 30s is already an incident. The XLSX parse that the 180s idle timeout was sized for holds its connection *after* admission, so it's unaffected.

## Enterprise-scale considerations

- **Concurrency & correctness.** Each process gates its own pool; with 2 prod tasks the DB sees at most 2 × cap tile queries. The admission check never interrupts started work, so there are no half-applied multi-write handlers. **Lean:** a per-process gate is correct, because the pool is the per-process resource.
- **Accuracy & auditability.** Gate rejections and cancellations are operational events, not records of truth. **Lean:** structured logs only. Alarming on them belongs to #516.
- **Failure modes.** Overload **fails closed for tiles** (a fast `503`, retried later) and **fails open for everything else** (the rest of the API keeps its connections). If the gate breaks, the code fails closed for tiles, never unbounded. **Lean:** fail closed at the gate. A blank map tile is cheap; a frozen app is not.
- **Scale & unbounded growth.** Today the pool queue is unbounded, which is the root of the blast radius. **Lean:** the gate queue is bounded, and the request admission deadline bounds pool waiting for every route. The client pauses on `Retry-After` instead of hammering.
- **Multi-tenancy.** One org's map took the whole instance away from every org. **Lean:** the gate fixes cross-route starvation, and the per-org share (Open question 3) fixes cross-org tile starvation.
- **Contract stability.** A new `MAP_TILE_BUSY` code plus `Retry-After` is additive, and existing clients degrade to the `failed` notice. **Lean:** register the code in the OpenAPI responses of both tile routes.
- **Data lifecycle.** N/A because nothing persists. The gate and abort state are per request and in memory.

## What this doesn't decide

- **A vertex budget for the whole-layer fast path.** `fitsWholeLayer` counts features, not vertices, so a few huge geometries still take the raw path at every zoom. With D1, this layer measures ~0.4s, so it isn't needed now. Revisit if a future layer is slow even with `ST_Simplify` (that would be a precomputed per-band line simplify, like #542).
- **Mutation idempotency against client retries** (the user clicked delete three times). D4 stops late execution after a give-up, not a deliberate retry. That deserves its own ticket.
- **Resizing RDS or the pool, or splitting workers into their own ECS service.** These are capacity levers, not the fix. Splitting workers out would remove 3 shared connections, but it's a deploy-shape change.
- **A DB-aware ECS health check.** Restarting the task wouldn't have helped, and alerting belongs to #516.

## Next step

`/spec 698` writes `docs/MAP_TILE_POOL_EXHAUSTION.spec.md`, then `/plan 698` writes the slices, roughly:
1. Per-kind simplify (unit tests on the builders, an integration test that a lines tile uses `ST_Simplify`).
2. The postgres.js cancel spike, then the request `AbortSignal` in the request context.
3. The tile admission gate + `MAP_TILE_BUSY`, with per-org share and cancel-on-disconnect.
4. The request-level admission deadline wrapper.
5. Web busy-state notice + `Retry-After` pause.
6. Logging fields.

Slice 1 alone resolves the contour map and can ship first in the same PR.
