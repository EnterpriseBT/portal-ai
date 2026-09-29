# Map-tile + dissolve view-scoping — Spec

Pins the contract for per-user view-scoping of the portal map (tiles + dissolve precompute), per `docs/MAP_TILE_DISSOLVE_VIEW_SCOPE.discovery.md` and [#643](https://github.com/EnterpriseBT/portal-ai/issues/643). Content-addressed per-scope dissolve (`scopeHash`), per-user tile serve, `SystemUtilities.id.system` cache-write principal, eager-creator-scope + lazy-fill, orphan reap.

## Key decisions (flag for review)

1. **`scopeHash` = a content hash of the caller's resolved `SessionViewBuild`.** `sha256(build.views.join("\n")).slice(0,32)` — the temp-view DDL encodes both the row filter (WHERE) and the column projection, so two callers with identical entitlements hash equal and any filter/grant change re-hashes. Staleness-proof by construction.
2. **Eager precompute is the *triggering user's* resolved scope, not a special "unfiltered org-wide" scope** (refinement of the discovery's wording). Because `buildSessionViews` (entity-based) and `resolveViewsForSession` (curated-view-based) emit *different* DDL, there is no "unfiltered" hash a real caller would match. So the pin create/refresh precompute resolves the **creator's** scope (`resolveViewsForSession(creatorUserId)`), and every other scope fills lazily. An org-complete admin viewing the map resolves to their own (full) scope, shared by all equally-entitled admins.
3. **`buildSessionViews` is retired.** Its only two callers (`portal-map-tile.service.ts:799`, `dissolve-precompute.processor.ts:173`) both move to `resolveViewsForSession`; the method + its tests are removed (clean cut — no dead no-user builder kept).
4. **Cache writes are attributed to `SystemUtilities.id.system`** (`created_by`), replacing the `'dissolve_precompute'` / `"SYSTEM_REENQUEUE"` strings. The *scope* a job computes is resolved from a real user's grants (creator for eager, viewer for lazy); the *write* is a system materialization.
5. **Lazy-fill jobs dedupe on `(owner, scopeHash)`** via the existing per-owner advisory lock extended with the scope, so a burst of first-views collapses to one job; the raw fallback serves everyone until it lands.
6. **Orphan scopes are reaped by a `last_served_at` TTL** on the `maintenance` queue (the retention-purge pattern).

## Scope

### In scope
- Per-user (per-scope) map tile serve: raw / aggregate / hybrid via `resolveViewsForSession`.
- Content-addressed `scopeHash` on `map_dissolve_geometries` + tile ETag.
- Eager (creator-scope) + lazy-fill (viewer-scope) dissolve precompute; `SystemUtilities.id.system` principal.
- Orphan-scope retention reap.
- Retire `buildSessionViews`.

### Out of scope
- Per-pipeline `scopeHash` precision (whole-build hash ships; OQ1).
- Dynamic `current_user.*` view filters (#599 out-of-scope); the #599 session/roster/records scoping (done).

## Surface

### `scopeHash` derivation — `apps/api/src/services/portal-sql.service.ts`
- Add `resolveScopeHash(build: SessionViewBuild): string` (exported) — `crypto.createHash("sha256").update([...build.views].join("\n")).digest("hex").slice(0, 32)`. Deterministic; empty build (no grants) hashes to a stable fail-closed value.
- `resolveViewsForSession(stationId, organizationId, userId, client?)` is unchanged (already returns `SessionViewBuild`, request-memoized #647). Callers that need both do `const build = await resolveViewsForSession(...); const scopeHash = resolveScopeHash(build);` (the second resolve is memoized-free).
- **Remove** `buildSessionViews` (`:189`) and its unit tests; update the `PortalSqlParams` doc comment (`:126`) that references the "org-wide buildSessionViews path".

### Tile serve — `apps/api/src/services/portal-map-tile.service.ts`
- `RenderTileParams`: add `userId: string`.
- `renderTile` (`:1008`): resolve the caller's build once (`resolveViewsForSession(stationId, org, userId)` — stationId from the resolved pipeline), derive `scopeHash`, and **add `scopeHash` to the ETag hash** (`:1028`, alongside `pipeline.sql|z|x|y|snapshot|AGG_TILE_VERSION`). Pass `userId` + `scopeHash` (+ the resolved `build`) into `runTileQuery`.
- `defaultRunTileQuery` args (`:637`): add `userId: string`, `scopeHash: string`, `build: SessionViewBuild`.
  - `hasDissolvePrecompute(owner, colorByColumn, band, scopeHash)` — add `scopeHash`, ANDed into the `EXISTS` (`:855`).
  - `dissolveReady` true ⇒ `runDissolveTile(owner, colorByColumn, band, scopeHash, envelope, cap)` (add `scopeHash`).
  - `dissolveReady` **false but the layer is dissolve-treatment** (`aggregation.treatment === "dissolve"`, `band !== null`, `owner != null`) ⇒ after serving the raw/aggregate fallback, **enqueue a lazy fill** for `(owner, colorByColumn, band, scopeHash, userId)` (fire-and-forget; dedup in the enqueue service).
- `runSessionViewTile` (`:792`): signature becomes `(tileSql, stationId, organizationId, userId, aggregate, cap)`; swap `buildSessionViews(stationId, org)` (`:799`) → `resolveViewsForSession(stationId, org, userId)`. DDL-before-txn (#314) unchanged.
- `hasDissolvePrecompute` / `runDissolveTile`: `+ scopeHash` param, ANDed into the `WHERE` (`dissolveOwnerCond` + `scope_hash = ${scopeHash}`).

### `dissolveOwnerCond` — `apps/api/src/services/portal-map-tile.service.ts`
- Callers add `AND mdg.scope_hash = ${scopeHash}` (keep `dissolveOwnerCond` owner-only; the scope predicate is added at each call site, or fold into a new `dissolveScopeCond(owner, scopeHash)`).

### Route — `apps/api/src/routes/portal-map.router.ts`
- `handle` (`:92`): pass `userId: req.application!.metadata.userId` into `renderTile` (`:109`). (`metadata.userId` is populated by `metadata.middleware.ts:92`.)

### Cache table — `apps/api/src/db/schema/map-dissolve-geometries.table.ts`
- Add `scopeHash: text("scope_hash").notNull()` and `lastServedAt: bigint("last_served_at", { mode: "number" })` (nullable; touched on serve for the reap).
- Extend the two lookup indexes to include `scopeHash` (lead the serve predicate): `(portalResultId, columnName, zoomBand, merged, scopeHash)` and the message equivalent. Add a reap index on `(lastServedAt)` partial `WHERE deleted IS NULL`.
- drizzle-zod + `type-checks.ts` parity updated (both directions), per the dual-schema rule.

### Dissolve precompute — `apps/api/src/queues/processors/dissolve-precompute.processor.ts`
- `runDissolve(owner, organizationId, userId)` — add `userId`; resolve the scope via `resolveViewsForSession(stationId, org, userId)` (+ `resolveScopeHash`) and apply **that** build's DDL (`:178`) instead of `buildSessionViews` (`:173`). Write `scope_hash = <hash>` and `created_by = SystemUtilities.id.system` in `rowMeta` (`:221-223`), replacing `'dissolve_precompute'`.
- The per-owner idempotent delete-then-insert (`:241,:292`) is scoped to `(owner, band, scopeHash)` — a recompute replaces only this scope's rows, not other scopes'.
- Job data (`:348`) gains `userId` + `scopeHash`; the advisory lock key (`ownerLockKey` `:65`) becomes `(owner, scopeHash)`.

### Enqueue — `apps/api/src/services/dissolve-precompute.service.ts`
- `enqueueForPin(portalResultId, org, userId)` / `enqueueForMessageBlock(...)` — the passed `userId` becomes the **scope-resolving** identity (not just the job creator); the processor reads it.
- New `enqueueLazyFill({ owner, organizationId, userId })` — computes the caller's `scopeHash`, and enqueues the dissolve job keyed by `(owner, scopeHash)` (dedup: a job already pending/active for that key is a no-op — reuse the advisory-lock + a job-key existence check).
- `reenqueueAllDissolvable` (`:144`): replace the `"SYSTEM_REENQUEUE"` default with the pin/block **creator's** userId per owner (each owner re-resolves under its creator's scope); attribute writes to `SystemUtilities.id.system`.

### Orphan-scope reap — `apps/api/src/queues/processors/dissolve-scope-retention-purge.processor.ts` (new)
- A repeatable `maintenance`-queue job (mirrors `entity-record-retention-purge.processor.ts`): batch-delete `map_dissolve_geometries` rows whose `last_served_at` is older than `DISSOLVE_SCOPE_TTL_MS` (env, default e.g. 30d), **never** deleting the most-recently-served scope per `(owner, columnName, zoomBand)` (so a live pin always keeps at least its active scopes). Run-summary as the BullMQ return value (surfaced by `GET /api/admin/maintenance`).

### Env — `apps/api/src/environment.ts`
- `DISSOLVE_SCOPE_TTL_MS` (default 30d). `SYSTEM_ID` already exists.

## Migration

`npm run db:generate -- --name map-dissolve-scope-hash` (`apps/api`):
- `ADD COLUMN scope_hash text NOT NULL DEFAULT ''` then backfill existing rows, then drop the default (or backfill in the same migration). **Backfill:** existing rows were computed org-wide (the retired `buildSessionViews` scope). They have no matching per-user hash, so mark them `scope_hash = '__legacy_orgwide__'` (a sentinel that no `resolveScopeHash` produces) — they will simply never be served post-migration and are reaped by the retention job / superseded by the first per-scope fill. (Alternative: `TRUNCATE map_dissolve_geometries` and let all scopes re-fill — cleaner, acceptable since the cache is derived + `project_no_production_data_yet`. **Lean: truncate** — no legacy sentinel to carry.)
- `ADD COLUMN last_served_at bigint`.
- Drop the two old indexes, create the `scopeHash`-extended lookups + the `last_served_at` reap index. Forward-only, expand-only (add columns/indexes) — `lint:migrations` clean (no destructive DDL beyond the index swap; a `TRUNCATE` of a derived cache carries a `-- destructive-ok: derived dissolve cache, rebuilt by precompute` marker).

## Seed
No seed change — `SystemUtilities.id.system` (env `SYSTEM_ID`) already exists.

## TDD test plan

### `apps/api` unit — `src/__tests__/services/portal-sql-scope-hash.test.ts`
- `resolveScopeHash`: deterministic for a given build; differs when a view's DDL (filter/projection) differs; stable across calls; empty build → stable fail-closed hash. (~4)

### `apps/api` unit — `src/__tests__/services/portal-map-tile.service.test.ts` (extend)
- `renderTile` includes `scopeHash` in the ETag (two scopes → different ETag; same scope → 304 path). (~2)
- `defaultRunTileQuery`: dissolve-ready for `(owner,col,band,scopeHash)` → `runDissolveTile` with the hash; dissolve-miss on a dissolve-treatment layer → raw fallback **and** a lazy-fill enqueue (spy); non-dissolve layer → no enqueue. (~3)
- `runSessionViewTile` resolves per-user (`resolveViewsForSession` spy, not `buildSessionViews`). (~1)

### `apps/api` integration — `src/__tests__/__integration__/services/portal-map-tile.integration.test.ts` (new/extend)
- A member with a **filtered** granted view sees tile geometry only for their rows (raw path), and no dissolve for a scope not yet filled; after a fill for their `scopeHash`, the dissolve serves their scope. An org-complete admin sees the full scope. A member with **no** granted view → empty tile. (~4)

### `apps/api` integration — `src/__tests__/__integration__/queues/dissolve-precompute.processor.integration.test.ts` (extend)
- `runDissolve` writes rows tagged with the resolving user's `scopeHash` and `created_by = SystemUtilities.id.system`; two distinct scopes coexist; a recompute of one scope leaves the other intact. (~3)

### `apps/api` integration — `src/__tests__/__integration__/queues/dissolve-scope-retention-purge.integration.test.ts` (new)
- Reap deletes rows past the TTL, keeps the most-recently-served scope per `(owner,col,band)`, returns a run summary. (~3)

**Totals ≈ 20 cases.** Run via `npm run test:unit` / `npm run test:integration` from `apps/api` (never raw jest). The migration is covered by the integration suites' fresh-DB setup; the drizzle journal + snapshot are committed with it.

## Acceptance criteria

- A member viewing a portal map sees geometry only for rows in their granted views (rows + columns), across raw / aggregate / hybrid.
- A member with no granted view over the map's data sees no tile and no dissolve for it.
- `dissolve-precompute` writes are attributed to `SystemUtilities.id.system`; no `'dissolve_precompute'` / `"SYSTEM_REENQUEUE"` strings remain.
- The dissolve cache is keyed by `scopeHash`; a filter/grant change never serves stale-scope geometry (a new hash is resolved from live grants).
- A filtered-view member's first map view is served raw + triggers a background per-scope fill; subsequent views are dissolved.
- Orphaned scopes are reaped by TTL; a live pin retains its active scopes.
- `buildSessionViews` has no remaining callers and is removed.

## Risks & rollback

- **Fail mode: fail-closed.** A resolution error or scope miss serves the caller's own raw tile / empty — never org-wide geometry. Content-addressing removes the stale-permission failure mode.
- **Cardinality growth** (× distinct scopes): bounded by shared entitlements + the TTL reap; the eager/lazy split precomputes only the creator scope. Watch `map_dissolve_geometries` row count on app-dev.
- **Cache truncate on migrate:** the dissolve cache rebuilds from the precompute; a brief post-deploy window serves raw tiles until scopes re-fill (acceptable — raw is correct, just heavier). No data loss (derived cache).
- **Rollback:** forward-only migration; a revert needs a new forward migration dropping `scope_hash`/`last_served_at`. The retired `buildSessionViews` would need reinstating — so a revert is a code rollback + a forward drop-column migration.

## Files touched

- New: `dissolve-scope-retention-purge.processor.ts`; `portal-sql-scope-hash.test.ts`; `dissolve-scope-retention-purge.integration.test.ts`; the migration (`.sql` + journal + snapshot).
- Edit: `portal-sql.service.ts` (`resolveScopeHash`, remove `buildSessionViews`); `portal-map-tile.service.ts` (userId/scopeHash thread + serve gate + lazy-fill); `portal-map.router.ts` (userId); `map-dissolve-geometries.table.ts` (+ drizzle-zod/type-checks); `dissolve-precompute.processor.ts`; `dissolve-precompute.service.ts`; `environment.ts`; the maintenance admin route/registry if the reap job registers there; affected tests.

## Next step

`/plan 643` slices this into testable commits — roughly: (1) `scope_hash`/`last_served_at` schema + migration (+ drizzle-zod/type-checks); (2) `resolveScopeHash` + retire `buildSessionViews`, swap `runSessionViewTile` to per-user; (3) thread `userId`/`scopeHash` through `renderTile`/route + ETag; (4) `scopeHash`-keyed dissolve serve + lazy-fill-on-miss + processor per-scope + `SystemUtilities.id.system`; (5) orphan-scope retention reap. Full review chain (code-review + **security** — member data-exposure boundary — + smoke + adversarial).
