# gis-geocoding — Smoke Suite

Manual smoke test for [#315](https://github.com/EnterpriseBT/portal-ai/issues/315) — metered `geocode` / `reverse_geocode` + the `expensive` `bulk_geocode_records` column job (bill-on-success, GeoJSON Points). **Branch under test:** `feat/gis-geocoding` (PR [#355](https://github.com/EnterpriseBT/portal-ai/pull/355), base `epic/gis-toolpack`). Contract: `docs/GIS_TOOLPACK.spec.md` (geocoding sections) + `docs/GIS_GEOCODING.plan.md`.

## Preflight

### Environment

- [x] `git checkout feat/gis-geocoding && git pull --ff-only`
- [x] `npm install`
- [x] Rebuild core so the git-ignored dist carries the new job schemas + `SEQUENTIAL_PALETTE`/geocoding capabilities: `npm run build --workspace @portalai/core`
- [x] **Apply the migration** — `cd apps/api && npm run db:migrate` (migration `0079_add-bulk-geocode-job-type` — `ALTER TYPE job_type ADD VALUE 'bulk_geocode'`)
- [x] **Provision the key** — put a Mapbox token in `apps/api/.env` as `GEOCODING_API_KEY=…` (get one at https://account.mapbox.com/access-tokens/). Without it, the geocode tools aren't constructed (maps still work) — geocoding steps below will be uncallable.
- [x] `npm run dev` boots cleanly (API :3001, web :3000)

### Fixtures

- [x] A station on a **Pro/Enterprise** tier so the **GIS pack** is enabled (Standard/Plus omit it). The station needs a **write-capable** connector (bulk geocode writes back).
- [x] An entity with a **text address column** (e.g. a `contacts` or `parcels` entity with `c_address`) **and** a **geometry-role target column** (`geoRole: "geometry"`, e.g. `c_geometry`) to receive the points. If none exists, add a geometry column definition and map it, or seed the canonical `geometry` definition (`db:seed`).
- [x] Note the entity's `connectorEntityId` and the two column keys — the bulk prompt names them.

### Reset between runs

- [x] Geocode results persist in the global Redis cache (30-day TTL) — that's intended; a repeated address *should* be `cached`. To force a fresh (billable) lookup, vary the address text or flush the `geocode:v1:*` / `reverse:v1:*` keys.
- [x] To re-run the bulk job cleanly, clear the target geometry column (or use a fresh entity); the job upserts points idempotently, so a re-run is safe.

## §1 — `geocode` resolves + plots on a map (spec AC: "geocode resolves sanity addresses; usable by visualize_map")

- [x] Prompt: *"geocode 1600 Pennsylvania Ave NW, Washington DC"*
- [x] Expected: the agent calls `geocode` and returns `{ lat ≈ 38.90, lng ≈ -77.04, formattedAddress, confidence, cached: false }` — **real coordinates from the provider**, not invented.
- [x] Prompt (follow-up): *"put that point on a map"*
- [x] Expected: `visualize_map` renders a single point at the geocoded location — the geocode output feeds the map directly.

## §2 — Cache hit is `cached: true` and costs 0 units (spec AC: "a repeat is served from cache at zero units, verifiable in the ledger")

- [x] Re-run the exact §1 prompt (same address).
- [x] Expected: the result now shows **`cached: true`**.
- [x] Open **Settings → Usage** (or inspect `tool_usage_ledger` in `db:studio`): the first §1 call itemizes **1 unit** for `geocode`; the cached repeat adds **0 units** (no new billable row / a 0-unit entry).

## §3 — Metered billing + typed failures, never invented coordinates (spec AC: "successful calls bill; provider-down / unresolvable return typed results")

- [x] After a fresh (uncached) successful geocode, confirm the usage ledger shows the `geocode` charge itemized (**1 unit**, tool `geocode`).
- [x] Prompt an unresolvable address: *"geocode qzxwv nonexistent place 99999"*
- [x] Expected: a **typed failure** (`GEOCODE_ADDRESS_UNRESOLVED`) the agent **relays to you** ("couldn't find that address") — it must **not** invent coordinates or plot a point. Mapbox partial-matches garbage to a low-relevance result rather than returning empty; the provider rejects any match below `MAPBOX_MIN_RELEVANCE` (0.6) as unresolved, so a weak partial is a **typed failure**, not a low-confidence coordinate — and it is neither billed nor cached.
- [x] *(Provider-down is hard to force manually; if you can point `GEOCODING_API_KEY` at an invalid token briefly, a call returns `GEOCODE_PROVIDER_UNAVAILABLE`, again relayed, never fabricated.)*

## §4 — Bulk column geocode: ack gate → lock → GeoJSON Points → charge once (spec AC: the bulk criterion)

- [x] Prompt: *"geocode the `c_address` column of the `<entity>` entity into the `c_geometry` column"*
- [x] Expected (first call): **rejected** with `BULK_DISPATCH_COST_NOT_ACKNOWLEDGED` and a cost estimate; the agent surfaces the cost and asks you to confirm.
- [x] Reply to confirm, then let the agent **retry with `acknowledgeCost: true`**.
- [x] Expected: the job **enqueues** — you see a **live progress widget** (bulk-job-progress), and the message says it's geocoding N addresses.
- [x] While it runs, try to **edit/delete** a record on that entity → **refused with `409` `BULK_JOB_TARGET_LOCKED`** (the entity is locked).
- [x] When it completes: inspect the entity's **`c_geometry` column** in `db:studio` (or map it) — rows carry **GeoJSON Point** geometry at the geocoded coordinates.
- [x] Usage ledger: the job charged **once**, itemized against `bulk_geocode_records` with a `job:<id>` reference; the unit count equals the **uncached** successes (cache hits are free).
- [x] **Idempotency:** if the job is retried (or you re-run it after clearing the column), it does **not** double-charge for the same `job:<id>`.

## §5 — A second bulk job on a locked entity is refused (spec AC: "a competing bulk job → ENTITY locked")

- [x] Start a bulk geocode on the entity (acked), and **before it finishes** ask for another bulk geocode on the **same entity**.
- [x] Expected: the second is **refused with `409` `BULK_JOB_TARGET_LOCKED`** — one bulk job per entity at a time.

## §6 — No quiet degradation: partial failure is reported, not hidden (spec AC rows 12–13)

- [x] Run a bulk geocode on a column where some rows are **blank or unresolvable** (add a few junk addresses if needed).
- [x] Expected: the job **completes as a partial success**, reporting **`{ geocoded, cached, failed }`** with the **failed rows identifiable** (the progress block / result names the failed count; failed rows are not silently skipped, and success is not over-reported). The resolvable rows still get points and still bill.

## §7 — Pins & guards (spec AC: "cost-hint pin + cost-gate wrap guard pass")

- [x] These are **CI-verified**, not manual: `npm run test:unit` (core `tool-capabilities` costHint/write-gate/cost-gate pins + api `tools.service` wrap guard) is green on the branch. Note it here for coverage; no manual action.

## Sign-off

- [x] Every section above verified
- [x] 2026-08-11 / Ben Turner — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro (prompt + entity/column): · Identifiers (org/station/entity/job ids):
