# Map-tile + dissolve view-scoping — Discovery

**Issue:** [EnterpriseBT/portal-ai#643](https://github.com/EnterpriseBT/portal-ai/issues/643)

**Why this exists.** #599 made a portal session expose exactly the data the caller can see elsewhere — the agent SQL session, `station_context`, roster, and the records endpoint all resolve **per-user** curated views (`resolveViewsForSession(stationId, org, userId)`). But it deliberately left **one** member-facing data surface org-wide: the portal **map**. Both the tile serve (`portal-map-tile.service`) and the **dissolve precompute** background job (`dissolve-precompute.processor`) run against the org-wide `buildSessionViews(stationId, org)` — no userId — so a member viewing a map sees geometry for **all** the org's rows, not just their granted views. This is the ticket that closes that gap: it makes the map tile + dissolve pipeline per-user view-scoped, and gives the deliberately-org-wide precompute a **defined system principal** instead of a magic string. (Not a #599 regression — the map was already org-wide pre-#599.)

## The current shape

### Tile serve — org-wide, no userId

| Piece | Location | Note |
|---|---|---|
| Route | `portal-map.router.ts:92,109,154,210` | two tile endpoints (message / pin), guarded by `getApplicationMetadata`; passes **`organizationId` only** — the viewer's `userId` is never threaded |
| Render | `portal-map-tile.service.ts:1008` (`renderTile`) | resolves the pipeline, computes an ETag over `pipeline.sql|z|x|y|snapshot|AGG_TILE_VERSION` (`:1025`) — **no userId in the hash** |
| Session-view seam | `portal-map-tile.service.ts:799` (`runSessionViewTile`) | calls **`PortalSqlService.buildSessionViews(stationId, organizationId)`** — the org-wide builder — then executes the temp-view DDL in a read-only txn and runs the tile SQL |
| Tile modes | `:347/:730` `resolveTileMode` | raw / aggregate / hybrid, each wrapping the pipeline SQL in `ST_AsMVT` |

### Dissolve precompute — no-user job, magic-string principal

| Piece | Location | Note |
|---|---|---|
| Processor | `dissolve-precompute.processor.ts:113` (`runDissolve`) | **also** calls org-wide `buildSessionViews(stationId, org)` (`:173`); writes two reps per band (`merged=false` individuals, `merged=true` coverage) to `map_dissolve_geometries` |
| Principal | `:221-223` | rows written with `created_by = 'dissolve_precompute'` — a **hardcoded string**, not `SystemUtilities.id.system`; re-enqueue uses `userId="SYSTEM_REENQUEUE"` (`dissolve-precompute.service.ts:145`) |
| Enqueue | `dissolve-precompute.service.ts:48,88` | on pin create/refresh + message-block; passes the triggering `userId` only as the job creator — the processor never reads it |
| Cache table | `map-dissolve-geometries.table.ts` | key: `organizationId`, owner (`portalResultId` XOR `messageId`+`blockIndex`), `columnName`, `value`, `zoomBand`, `merged` — **no user/view column, no unique key** |
| Serve | `portal-map-tile.service.ts:851,887` (`hasDissolvePrecompute`, `runDissolveTile`) | reads the cache **directly — no pipeline SQL, no session views**; count-driven (≤cap → individuals, over-cap → merged coverage) |

### The seam we already have (#599)

`buildSessionViews(stationId, org)` (`portal-sql.service.ts:189`) and `resolveViewsForSession(stationId, org, userId)` (`:727`) return the **same** `SessionViewBuild` shape (`:111`: `views: string[]` DDL + `viewMap`). So the raw/aggregate tile path can become per-user by swapping the `:799` call — the DDL-execution loop is unchanged. `resolveGrantedViewColumns(stationId, org, userId)` (`:420`) is the shared "what can this user see" source (grants + per-view readable columns + deny-wins). `PortalSqlParams` (`:126`) already documents this ticket: "the org-wide buildSessionViews path (map tiles / dissolve precompute, #643) does not go through runSqlQuery."

### System-principal precedent

`SystemUtilities.id.system` (`system.util.ts:37`, env `SYSTEM_ID`) is the canonical platform actor; RBAC recognizes `created_by_system` (`permission.model.ts:105`, seeded `seed.service.ts:782`). This is what deliverable #1 should adopt (replacing the `'dissolve_precompute'` / `SYSTEM_REENQUEUE` ad-hoc strings).

## The design space

### Decision 1 — Tile serve view-scoping (raw / aggregate / hybrid)

Thread the viewer's `userId` route → `renderTile` → `runSessionViewTile`, and swap `buildSessionViews(stationId, org)` → `resolveViewsForSession(stationId, org, userId)` (`:799`). The pipeline SQL then runs against the caller's per-user session views — identical mechanism, correct row+column scoping, fail-closed to empty when the caller has no granted view. This is the uncontroversial core; the only subtlety is the **cache key** (Decision 4).

**Lean: do it.** The shapes match; it's a thread-through + one-line builder swap.

### Decision 2 — Dissolve granularity: content-addressed per-scope precompute

The dissolve is a **pre-aggregated** cache: `ST_Union` collapses source rows into merged coverage geometry that **cannot be re-filtered to a user's row subset at serve time**, and it's computed over an arbitrary **pipeline SQL** (potentially multi-entity), not one curated view. Two naïve granularities each fail a requirement: a **serve gate** on org-wide coverage can only allow/deny *whole* `(owner, column, band)` coverage (so a filtered-view member gets slow raw tiles — we will not assume their filtered set is small); a **per-user / per-view-id** precompute is a permission-derived cache whose *stale* entry is a security-grade leak (serving geometry under a filter/grant that has since changed), with a rotting invalidation dependency graph.

**Chosen shape — key each dissolve by a content hash of the caller's *resolved scope*.** Add a `scopeHash` to `map_dissolve_geometries`; the key becomes `(owner, column, value, band, merged, scopeHash)`. The scope is the caller's `resolveViewsForSession(stationId, org, userId)` build — its row filters + column projection — hashed deterministically. This makes staleness structurally impossible and keeps cardinality bounded:

- **A filter edit** changes the resolved WHERE → changes `scopeHash` → the next request computes/reads a *new* key; the old entry is orphaned (reaped by retention). **No explicit invalidation of filter edits.**
- **A grant change** re-resolves the caller to a different `scopeHash` on their next request (resolved fresh from live grants each time), so a **stale permission can never be served** — the cache key *is* the current entitlement.
- **A data change** (pin refresh / new records) invalidates by `owner` across all scopes — the same trigger as today.
- **Cardinality is × distinct scope (filter-set)**, not × user — members sharing a role/team view share one entry, and the **unfiltered scope is exactly today's org-wide dissolve** as a special case.

**Performance without a slow first paint — lazy fill on miss.** On a tile request whose `scopeHash` has no cached dissolve, serve the caller's per-user **raw/aggregate** tile immediately (Decision 1 — row-correct, just heavier) and **enqueue a background per-scope precompute**; repeat views are then dissolved. The **unfiltered scope** is still precomputed **eagerly** at pin create/refresh (the common admin / org-complete case), so only genuinely-novel filtered scopes ever take a raw first paint.

**Lean: content-addressed per-scope precompute + lazy fill.** Fast for filtered-view members (no low-volume assumption), immune to permission staleness (key = live resolved scope), bounded cardinality (per filter-set), and it subsumes the org-wide dissolve as the unfiltered scope. Cost: a `scopeHash` column (additive migration), the lazy-fill-on-miss path, and an orphan-scope retention reap.

### Decision 3 — System principal for the precompute

The dissolve precompute stays **consciously org-wide** (the cache is org-wide by design, a system-level materialization like a seed/backfill). Give it a defined principal: `SystemUtilities.id.system`, replacing `'dissolve_precompute'` (`:223`) and `SYSTEM_REENQUEUE` (`service:145`). Its `buildSessionViews` call stays org-wide **by design**, now attributable to the system actor.

**Lean: adopt `SystemUtilities.id.system`.** A recorded system op, not an accidental over-privileged default.

### Decision 4 — Tile cache key / ETag per-scope

The ETag (`:1025`) has no scope discriminator today. Once tiles are per-user, two callers with different grants must not share a cached tile. Reuse the **`scopeHash`** from Decision 2 in the ETag (alongside the existing `pipeline.sql|z|x|y|snapshot|AGG_TILE_VERSION`): callers with identical entitlements share tile cache; a filter/grant change changes the hash → a fresh tile. This is strictly better than keying by raw `userId` (which would fragment cache per user even when entitlements match) and it keeps the tile-layer key aligned with the dissolve-layer key.

**Lean: add `scopeHash` to the ETag hash** — the same resolved-scope hash Decision 2 keys the dissolve on.

## Tradeoff comparison

| | D1 thread userId | D2 per-scope precompute | D3 system principal | D4 ETag scopeHash |
|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes |
| Cache cardinality impact | none | × distinct scopes (bounded, orphan-reaped) | none | shares tile cache per scope |
| New schema | none | `scopeHash` col + orphan retention | none | none |
| Stale-permission risk | n/a (serve reads live grants) | none (key = live resolved scope) | n/a | none |

## Recommendation

1. Thread the viewer `userId` from `portal-map.router` through `renderTile` → `runSessionViewTile`; the raw/aggregate/hybrid tile path resolves the caller's per-user session views via `resolveViewsForSession` (fail-closed to empty). Compute the caller's `scopeHash` from that resolved build.
2. Key the dissolve cache by `scopeHash` (add the column + a supporting index; migration). Each caller is served the dissolve for their own resolved scope; the **unfiltered** scope is the org-wide dissolve as a special case.
3. **Eagerly precompute the unfiltered scope** at pin create/refresh under `SystemUtilities.id.system` (replacing the `'dissolve_precompute'` / `SYSTEM_REENQUEUE` strings). **Lazily fill** any other scope on tile-serve miss: serve the per-user raw/aggregate tile immediately and enqueue a background per-scope precompute (write `created_by = SystemUtilities.id.system`; the *scope* is determined by resolving the triggering user's views).
4. Add `scopeHash` to the tile ETag so tiles are shared per-scope, never cross-served across entitlements.
5. Add an **orphan-scope retention reap** for `map_dissolve_geometries` entries whose `scopeHash` is no longer produced by any live grant/filter (an unreferenced-scope purge on the `maintenance` queue, following the retention-purge pattern).

## Open questions

1. **`scopeHash` granularity — whole session-view build vs the pipeline's touched views.** Hashing the caller's *entire* resolved `SessionViewBuild` is simple and correct, but a change to a view the pipeline doesn't use still changes the hash → an unnecessary recompute + orphan for that pipeline (a perf/cardinality cost, never a correctness one, since it only ever *adds* a recompute). Per-pipeline precision needs mapping arbitrary pipeline SQL to its entities. **Lean: hash the whole resolved build first; per-pipeline-entity precision is a measured follow-up.**
2. **The hash must encode row filter AND column projection.** The dissolve's `colorBy` column must be readable in the scope, and two scopes differing only by projection must hash differently. Hashing the resolved `SessionViewBuild` (its temp-view DDL, which encodes both the WHERE and the selected columns) captures both. **Lean: hash the resolved build's view DDL — it encodes filter + projection together.**
3. **Lazy-fill thundering herd.** Many concurrent first-views of a novel scope could enqueue many identical precompute jobs. **Lean: key the lazy-fill job by `(owner, scopeHash)` and reuse the existing per-owner advisory lock (`SyncLockService.withAdvisoryLock`) extended to include the scope, so duplicates collapse to one job; the raw fallback serves everyone until it lands.**
4. **Orphan-scope reap trigger.** There's no reverse index from a stored `scopeHash` back to the grants that produce it, so "is this scope still referenced?" isn't directly answerable. **Lean: a `last_served_at` (or last-written) TTL reap — purge scopes not served in N days — rather than a live-reference check; the unfiltered/system scope is exempt (always eagerly refreshed).**
5. **Aggregate (hybrid) path.** It pre-buckets server-side but shares `runSessionViewTile`, so it inherits the per-user session views (D1) and the `scopeHash` ETag (D4). **Lean: covered by D1 + D4 — confirm in the spec.**

## Enterprise-scale considerations

- **Concurrency & correctness:** eager precompute stays advisory-locked per owner (`SyncLockService.withAdvisoryLock`); the lazy-fill job is deduped by `(owner, scopeHash)` on the same lock so a burst of first-views collapses to one job (OQ3). Serve is read-only.
- **Multi-tenancy:** org-scoped today; this adds per-user scoping *within* an org, keyed by resolved scope. Fail-closed: no granted view → empty tile, no dissolve.
- **Failure modes:** fail-closed is the safe default — a resolution error or a scope miss yields the caller's own raw/aggregate tile (or empty), **never** org-wide geometry. Content-addressing removes the stale-permission failure mode entirely (the key is the live entitlement).
- **Scale & unbounded growth:** dissolve cardinality is now **× distinct scopes (filter-sets)**, not flat — bounded because members with identical entitlements share a scope, the unfiltered scope is shared by all org-complete callers, and orphaned scopes are reaped (OQ4). The eager/lazy split keeps the common case precomputed and only novel filtered scopes pay a raw first paint + one background fill.
- **Accuracy/auditability:** cache writes (eager and lazy) are attributable to `SystemUtilities.id.system` — an auditable system materialization, not a magic string.
- **Data lifecycle:** staleness is structural-safe (content-addressed key = live scope); orphaned scopes are purged by a TTL/last-served reap on the `maintenance` queue (the retention-purge pattern), with the unfiltered/system scope exempt.
- **Contract stability:** `map_dissolve_geometries` gains a `scopeHash` column + index (additive migration; existing rows backfill as the unfiltered scope).

## What this doesn't decide

- **Per-pipeline `scopeHash` precision** — the whole-build hash ships first; narrowing the hash to a pipeline's touched entities (fewer recomputes) is a measured follow-up (OQ1).
- **Cross-scope geometry sharing** — no attempt to reuse one scope's merged geometry to derive another's (the union is lossy); each scope computes independently.
- The agent SQL session / `station_context` / roster / records scoping (**#599**, done) and dynamic `current_user.*` view filters (#599 out-of-scope).

## Next step

`/spec 643` pins the contract: the `userId` thread-through signatures (`renderTile`, `runSessionViewTile`, the route), the `resolveViewsForSession` swap, the `scopeHash` derivation (a stable hash of the resolved `SessionViewBuild`), the `map_dissolve_geometries` `scopeHash` column + migration, the eager-vs-lazy precompute paths + the `(owner, scopeHash)` lazy-fill job, the `SystemUtilities.id.system` principal wiring, the orphan-reap job, and the ETag change. `/plan 643` then slices it — roughly: (1) `scopeHash` schema + system principal for the eager precompute; (2) thread `userId`/`scopeHash` + per-user raw/aggregate tiles + ETag; (3) `scopeHash`-keyed dissolve serve + lazy-fill-on-miss; (4) orphan-scope retention reap; each behind tests. Full review chain (code-review + security — this is a member data-exposure boundary — + smoke + adversarial).
