# TILE_RATE_LIMIT — Adversarial Review

Adversarial probes for [#705](https://github.com/EnterpriseBT/portal-ai/issues/705). The change under test:
- map tiles get their own per-user rate-limit bucket (`authed-tiles:<sub>`), mounted ahead of the API limiter;
- the tile mount ends in a `404`;
- tile refusals use `429 MAP_TILE_RATE_LIMITED`;
- `HttpService.error` sets `Retry-After` from `details.retryAfterSeconds`;
- the map pauses on a 429 that carries `Retry-After`.

**Branch under test:** `fix/705-tile-rate-limit` (PR [#748](https://github.com/EnterpriseBT/portal-ai/pull/748)).

The probes ask four questions:
- Can a request reach the API bucket through the tile mount, or the other way round?
- Does the limiter run before authentication?
- Is the `Retry-After` hint ever wrong or missing?
- Does the map ever show a limit as "failed" or keep hammering?

## Preflight

### Environment
- [ ] `git checkout fix/705-tile-rate-limit && npm install && npm run dev` (web :3000, API :3001).
- [ ] Set low limits so the probes can reach them. In `apps/api/.env`, set `AUTH_TILE_RATE_LIMIT_PER_MIN=20` and `AUTH_API_RATE_LIMIT_PER_MIN=40`, then restart the API. `environment.ts` reads them at import, so a `touch` isn't enough.
- [ ] The Playwright MCP is available, and the `e2e:auth:all` fixtures are present (owner and member).
- [ ] Bearer tokens for the e2e **owner** and **member** are extracted from the fixtures. The mechanics are in the #643 memory note.

### Fixtures
- [ ] The seeded `e2e-fixture` org has a station with at least one **map pin** (a geo portal result). Note its `portalResultId`. Use the #643 portal seed if none exists.
- [ ] Also have a pin id from a **second org** on hand.

### Reset between runs
- [ ] Clear the rate windows from inside the compose network: `redis-cli --scan --pattern 'usage:rate:authed*' | xargs -r redis-cli del`. Alternatively, wait out the minute.
- [ ] When done, restore `apps/api/.env` and restart the API.

## §1 — Boundary & limit inputs
- [ ] As the owner, in one fresh minute, send 20 tile GETs for the pin (`/api/portal-map/tiles/pin/<pin>/0/0/0.mvt`), then a 21st.
  - **Expected safe result:** requests 1–20 are not 429. Request 21 is `429 MAP_TILE_RATE_LIMITED` with a `Retry-After` header equal to `details.retryAfterSeconds`, within [1, 60], and equal to 60 minus the current UTC second, ±1. — backend
- [ ] Send the over-limit request in the last second of a UTC minute (`date +%S` = 59), then again just after the minute turns over.
  - **Expected safe result:** the first gets `Retry-After: 1`, never `0` and never negative. The second is served, because the window reset. — backend

## §2 — Malformed & injection input
- [ ] Send hostile paths under the tile mount, with the API bucket already exhausted for the caller:
  - `curl --path-as-is /api/portal-map/../stations`
  - `/api/portal-map/%2e%2e/stations`
  - `/api/portal-map/tiles/pin/<pin>/99/0/0`
  - `/api/PORTAL-MAP/tiles/pin/<pin>/0/0/0.mvt` (Express mounts match case-insensitively)
  - **Expected safe result:** none of them reaches the stations router or returns its data. Each is a 400 (`MAP_TILE_INVALID_REQUEST`), a `404 MAP_TILE_NOT_FOUND`, or a served tile. None is `API_RATE_LIMITED`. Each increments only `authed-tiles:<sub>`; check the Redis keys. — backend
- [ ] Craft a `429` in the browser by intercepting a tile response with Playwright route interception: a 429 **without** `Retry-After`, then a 429 with `Retry-After: abc`.
  - **Expected safe result:** the first shows the "failed" notice and doesn't pause the queue. The second pauses for the 2s default (an unparseable header falls back to it), shows the rate-limited notice, and never pauses longer than 60s.

## §3 — Concurrency & races
- [ ] Fire 60 tile GETs at once with a fresh window (`xargs -P 60`, limit 20).
  - **Expected safe result:** exactly 20 are not 429 and 40 are `429 MAP_TILE_RATE_LIMITED` (the Redis `INCR` is atomic). The API bucket key for the caller stays absent. — backend

## §4 — Auth & permission boundaries
- [ ] Send a tile GET with **no** `Authorization` header, then one with a malformed bearer token.
  - **Expected safe result:** `401 AUTH_UNAUTHORIZED` from `jwtCheck`, and **no** `usage:rate:authed-tiles:*` key is created. The limiter runs only after authentication, so an anonymous caller can't fill a user's bucket. — backend
- [ ] As the owner, `POST`, `PATCH` and `DELETE` `/api/portal-map/tiles/pin/<pin>/0/0/0`.
  - **Expected safe result:** `404 MAP_TILE_NOT_FOUND` from the terminator (`requireOrgWritable` passes for a healthy org). No handler runs, and only the tile bucket increments. — backend

## §5 — Multi-tenant isolation
- [ ] Exhaust the **owner's** tile bucket, then send tile GETs for the same pin as the **member** (same org).
  - **Expected safe result:** the member is served (or gets the pin's normal 404 if they can't read it), never 429. Buckets are per user, so one user can't starve a teammate. — backend
- [ ] As the owner, with the tile bucket exhausted, request the **second org's** pin and then a random id.
  - **Expected safe result:** both get an identical `429 MAP_TILE_RATE_LIMITED` body (the limiter answers before any lookup, so it's no existence oracle). Under the limit, both get an identical `404 MAP_TILE_NOT_FOUND`. — backend

## §6 — State & lifecycle abuse
- [ ] Stop Redis while the API runs, then send tile and API requests.
  - **Expected safe result:** both are served (fail open, a warning logged naming the bucket). Nothing hangs past the Redis op timeout. Restart Redis afterwards. — manual (it stops a shared container)
- [ ] After a tile 429, wait `Retry-After` seconds and request again.
  - **Expected safe result:** served. No stale key keeps the caller limited past the window. — backend

## §7 — Misuse sequences
- [ ] As the owner, open the station with the map pin and pan and zoom rapidly until tiles are refused (limit 20).
  - **Expected safe result:** the map shows "Loading map tiles too quickly — tiles will load when you pan or zoom." and **not** "A map tile failed to load". The network panel shows no tile requests during the `Retry-After` pause.
- [ ] While the map is rate-limited, open the Stations list and a station's detail in the same tab.
  - **Expected safe result:** both load (no `API_RATE_LIMITED`). Panning a map never throttles the rest of the app.
- [ ] Once the pause has passed, pan the map once.
  - **Expected safe result:** tiles load, and the rate-limited notice clears once tiles succeed.
- [ ] Check the API log for the tile 429s from the probe above.
  - **Expected safe result:** they log at **warn** ("Request shed by backpressure"). An `API_RATE_LIMITED` 429 (forced by exhausting the API bucket with curl) still logs at **error**. — backend

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | low / med / high | fixed-in-PR / waived: <reason> |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/user sub/pin id/Redis key):
