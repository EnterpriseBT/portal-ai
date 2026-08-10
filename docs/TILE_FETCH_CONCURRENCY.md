# Cap concurrent low-zoom tile fetches — Condensed design (#350)

**Issue:** [EnterpriseBT/portal-ai#350](https://github.com/EnterpriseBT/portal-ai/issues/350) · Task · epic [#84](https://github.com/EnterpriseBT/portal-ai/issues/84) · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** A max-zoom-out map view asks MapLibre for 6–9 tiles at once; each low-zoom aggregate tile is expensive (~850 ms on the 394k-parcel layer — #334 revisit). Nothing bounds how many `portalmap://` fetches run concurrently, so the burst saturates the browser's ~6-per-host connection limit and stalls the view. Server caching (`ETag` + `Cache-Control: private, max-age=60` + 304) and abort-on-nav (MapLibre's per-tile `AbortController` → `fetchTile`'s `signal`) already work — the only gap is the cold concurrent burst. Single package: `apps/web`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| protocol handler → `fetchTile` | `apps/web/src/modules/MapWidget/utils/tile-protocol.util.ts:100-106` | MapLibre calls the handler per tile with an `AbortController`; `fetchTile` forwards `signal`. **No concurrency limit** — every viewport tile fetches immediately. |
| `fetchTile` | `tile-protocol.util.ts:52-85` | resolves token → `deps.fetch(url, {signal, headers})` → returns bytes; 204/304/!ok → empty. Aborted fetch rejects (MapLibre handles it). |
| server cache (works) | `apps/api/.../portal-map.router.ts:66-81` | `ETag` + `Cache-Control: private, max-age=60` + `If-None-Match`→304. |

## Decision — a client-side concurrency semaphore in the tile protocol

Gate the network fetch in `fetchTile` behind a module-level semaphore (`MAX_CONCURRENT_TILE_FETCHES`, **6** — matching the browser's per-host ceiling so we fill it without saturating it). A tile acquires a slot before `deps.fetch` and releases it when the response settles (success **or** error, via `finally`). The acquire is **abort-aware**: if a tile's `signal` fires while it's still *queued* (superseded before it ever started), it's removed from the queue and rejects with `AbortError` — matching the existing fetch-abort semantics and never spending a connection on a tile MapLibre no longer wants.

Token resolution (`getToken`, Auth0-cached) stays *before* the slot so a slow first token doesn't hold a connection. Server caching + TTL tuning is **out of scope** here (#350 is the concurrency cap; the cache already works).

## Plan — 1 slice

**Files**
- Edit `apps/web/src/modules/MapWidget/utils/tile-protocol.util.ts` — add `MAX_CONCURRENT_TILE_FETCHES`, `acquireFetchSlot(signal)` / `releaseFetchSlot()`, and wrap the fetch in `fetchTile` (acquire → `try { fetch } finally { release }`).
- Edit `apps/web/src/modules/MapWidget/__tests__/tile-protocol.util.test.ts` — tests below.

**Tests** (`cd apps/web && npm run test:unit`)
- With deferred (never-resolving) fetches, firing 8 tiles calls `deps.fetch` **exactly 6** times; resolving one lets the 7th start, then the 8th (the cap holds, the queue drains in order).
- A tile whose `signal` aborts **while queued** never calls `deps.fetch` and rejects `AbortError`; a freed slot then lets the next queued tile run.
- A slot is released on both a successful fetch and a rejected/aborted fetch (a stuck tile can't starve the queue).
- Existing `fetchTile` cases (token, status headers, 204/304/504 → empty) still pass (they resolve immediately → no leak).

## Smoke (manual, against your dev stack)

1. On the `GIS smoke` station, map the parcels (or roads) and **zoom all the way out** (whole-valley view).
2. **Expected:** the view stays responsive; in the Network tab, `portalmap://`-backed `/api/portal-map/...` requests are **bounded to ≤ 6 in flight** (the rest queue and start as slots free), rather than all firing at once and stalling.
3. Pan/zoom rapidly: superseded tiles are cancelled (no growing pile of pending requests); the map keeps up.
4. Repeat views hit cache (304 / from browser cache) — unchanged.

## Out of scope

- **Per-tile query speedup** (#334, held) and **materialized bins** — this bounds *concurrency*, not per-tile cost.
- **Cache TTL tuning** — the server cache already works; lengthening `max-age` for aggregate tiles is a separate tweak (interacts with the #349 freshness contract).
