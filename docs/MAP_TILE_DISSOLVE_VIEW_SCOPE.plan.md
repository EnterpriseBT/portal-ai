# Map-tile + dissolve view-scoping — Plan

**Per-user view-scoping of the portal map (tiles + dissolve), TDD-sequenced: schema first, then the pure hash + per-user raw tiles, then the scope-aware dissolve serve, then the per-scope precompute + system principal, then the orphan reap.**

Spec: `docs/MAP_TILE_DISSOLVE_VIEW_SCOPE.spec.md`. Discovery: `docs/MAP_TILE_DISSOLVE_VIEW_SCOPE.discovery.md`. Issue: #643 (epic #578). Builds on #599 (`resolveViewsForSession`) and #647 (request-memoized resolution).

5 slices, each behind a green suite and each leaving the repo compilable. They land as **commits on `feat/643-map-tile-dissolve-view-scope`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from `apps/api` (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
```

Each slice: (1) failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

**Sequencing rationale.** (1) The schema + migration land first with a transitional `scope_hash` default so every existing writer/serve stays green and behavior is unchanged. (2) The pure `resolveScopeHash` + the per-user **raw/aggregate** tile path (swap `runSessionViewTile` to `resolveViewsForSession`) — no dissolve change yet. (3) The dissolve **serve** starts honouring `scope_hash` — this *degrades dissolve to raw everywhere* (the processor still writes the transitional default, which matches no real hash) which is **safe (no leak) and pre-merge-only**; serve-before-write is the safe order because write-before-serve would serve mixed scopes. (4) The **processor** writes per-scope under the system principal + lazy-fill restores the dissolve, now per-scope; `buildSessionViews`' last two callers are gone so it's retired here. (5) The orphan reap is independent cleanup, last.

---

## Slice 1 — `scope_hash` schema + migration

Additive schema so nothing else changes behavior yet.

**Files**
- Edit: `apps/api/src/db/schema/map-dissolve-geometries.table.ts` — add `scopeHash: text("scope_hash").notNull().default("")` (transitional default keeps unchanged writers green) + `lastServedAt: bigint("last_served_at", { mode: "number" })`; extend the two lookup indexes with `scopeHash`; add a `(lastServedAt)` reap index.
- Edit: `apps/api/src/db/schema/zod.ts` + `type-checks.ts` — drizzle-zod select/insert + bidirectional `IsAssignable` parity.
- New: `apps/api/drizzle/0117_map-dissolve-scope-hash.sql` (+ `meta/_journal.json`, `0117_snapshot.json`) — `TRUNCATE map_dissolve_geometries` (`-- destructive-ok: derived dissolve cache, rebuilt by precompute`), add both columns, swap the indexes.

**Steps**
1. **Tests.** Type-checks parity (compile-time) + confirm the existing dissolve serve/precompute integration still passes with the new columns (behavior unchanged). Run; the parity fails until zod/type-checks updated.
2. **Implement** the column + index + migration + parity. Green.
3. Lint + type-check; commit the migration `.sql` + journal + snapshot together (`project_drizzle_journal_must_be_committed`).

**Done when:** the migration applies on a fresh DB, type-checks parity holds, and existing dissolve behavior is unchanged (all rows carry the `""` default).

**Risk:** forgetting the journal/snapshot → green-local/red-CI. Truncate is safe (derived cache).

---

## Slice 2 — `resolveScopeHash` + per-user raw/aggregate tiles + ETag

The pure hash and the tile raw path go per-user. Dissolve serve untouched.

**Files**
- Edit: `apps/api/src/services/portal-sql.service.ts` — add exported `resolveScopeHash(build)` (`sha256` of `build.views`, sliced).
- Edit: `apps/api/src/services/portal-map-tile.service.ts` — `RenderTileParams +userId`; `renderTile` resolves the build + `scopeHash`, adds `scopeHash` to the ETag hash, passes `userId`/`scopeHash`/`build` into `runTileQuery`; `defaultRunTileQuery` args `+userId,+scopeHash,+build`; `runSessionViewTile(+userId)` swaps `buildSessionViews` → `resolveViewsForSession(stationId, org, userId)`.
- Edit: `apps/api/src/routes/portal-map.router.ts` — `handle` passes `userId: req.application!.metadata.userId`.

**Steps**
1. **Tests (spec: `portal-sql-scope-hash.test` ~4; `portal-map-tile.service.test` ETag ~2 + `runSessionViewTile` per-user ~1).** `resolveScopeHash` determinism/difference/empty; two scopes → different ETag, same scope → 304; `runSessionViewTile` calls `resolveViewsForSession` (spy), not `buildSessionViews`. Run; fail.
2. **Implement** the hash + the userId/scopeHash thread + the builder swap. Green.
3. Lint + type-check.

**Done when:** raw/aggregate tiles resolve per-user; the ETag varies by scope; `buildSessionViews` now has exactly one caller left (the processor).

**Risk:** `renderTile` must obtain `stationId` to resolve the build (it flows to `runSessionViewTile` today); confirm the source when wiring.

---

## Slice 3 — Scope-aware dissolve serve (safe degradation)

The dissolve serve honours `scope_hash`. Until slice 4 the processor still writes the default, so dissolve **degrades to raw everywhere** — safe (no cross-scope geometry), pre-merge-only.

**Files**
- Edit: `apps/api/src/services/portal-map-tile.service.ts` — `hasDissolvePrecompute(owner, col, band, scopeHash)` + `runDissolveTile(owner, col, band, scopeHash, envelope, cap)` AND `scope_hash = ${scopeHash}` into the `WHERE` (new `dissolveScopeCond(owner, scopeHash)`); `defaultRunTileQuery` passes the caller's `scopeHash`; touch `last_served_at` on a served dissolve.

**Steps**
1. **Tests (spec: `portal-map-tile.service.test` dissolve-serve ~part).** Seed `map_dissolve_geometries` with `scope_hash = H`; serve with matching `H` → dissolve; with a different hash → raw fallback (dissolve not ready). Run; fail.
2. **Implement** the `scopeHash` predicate + `last_served_at` touch. Green (existing dissolve integration tests updated to seed the matching hash).
3. Lint + type-check.

**Done when:** the dissolve serve only ever returns rows matching the caller's `scopeHash`; a mismatch falls back to the (slice-2, row-correct) raw path.

**Risk:** the pre-merge degradation to raw — acceptable because the PR isn't merged mid-sequence and slice 4 restores dissolve; documented in cross-slice notes.

---

## Slice 4 — Per-scope precompute + system principal + lazy fill; retire `buildSessionViews`

The processor writes per-scope rows under the system actor, misses self-heal via lazy fill, and the now-unused org-wide builder is removed.

**Files**
- Edit: `apps/api/src/queues/processors/dissolve-precompute.processor.ts` — `runDissolve(owner, org, userId)`; resolve the scope via `resolveViewsForSession(stationId, org, userId)` + `resolveScopeHash` (replace `buildSessionViews`); write `scope_hash` + `created_by = SystemUtilities.id.system`; delete-then-insert scoped to `(owner, band, scopeHash)`; job data `+userId,+scopeHash`; advisory lock key `(owner, scopeHash)`.
- Edit: `apps/api/src/services/dissolve-precompute.service.ts` — `enqueueForPin`/`enqueueForMessageBlock` pass the resolving `userId`; new `enqueueLazyFill({ owner, org, userId })` deduped on `(owner, scopeHash)`; `reenqueueAllDissolvable` uses each owner's creator `userId` (drop `"SYSTEM_REENQUEUE"`).
- Edit: `apps/api/src/services/portal-map-tile.service.ts` — on a dissolve-treatment miss, `enqueueLazyFill` (fire-and-forget) after serving raw.
- Edit: `apps/api/src/services/portal-sql.service.ts` — **remove** `buildSessionViews` + its unit tests; update the `PortalSqlParams` doc comment.

**Steps**
1. **Tests (spec: `portal-map-tile.service.test` lazy-fill ~; `dissolve-precompute.processor.integration` ~3; `portal-map-tile.integration` ~4).** Processor writes rows tagged with the resolving user's `scopeHash` + `created_by = system`; two scopes coexist; a recompute of one leaves the other intact. Serve miss on a dissolve layer → raw + one lazy-fill enqueue (spy); non-dissolve → none. Integration: filtered-view member sees own geometry, then a dissolve after a fill; no-view member → empty; admin → full scope. Run; fail.
2. **Implement** the per-scope processor + enqueue + lazy fill; delete `buildSessionViews`. Green.
3. Lint + type-check.

**Done when:** the dissolve is per-scope and self-filling; all writes are `SystemUtilities.id.system`; no `'dissolve_precompute'`/`"SYSTEM_REENQUEUE"` strings; `buildSessionViews` is gone.

**Risk:** lazy-fill thundering herd — dedup on `(owner, scopeHash)` (advisory lock + job-key check). The biggest slice; keep the processor and serve changes each behind their own tests.

---

## Slice 5 — Orphan-scope retention reap

Independent cleanup on the maintenance queue.

**Files**
- New: `apps/api/src/queues/processors/dissolve-scope-retention-purge.processor.ts` (mirrors `entity-record-retention-purge.processor.ts`).
- Edit: `apps/api/src/environment.ts` — `DISSOLVE_SCOPE_TTL_MS` (default 30d); the maintenance queue registry so `GET /api/admin/maintenance` surfaces it.

**Steps**
1. **Tests (spec: `dissolve-scope-retention-purge.integration` ~3).** Reap deletes rows past the TTL; keeps the most-recently-served scope per `(owner, column, band)`; returns a run summary. Run; fail.
2. **Implement** the batch-drain purge + registration. Green.
3. Lint + type-check.

**Done when:** stale scopes are reaped, a live pin keeps its active scopes, and the run summary shows in `/api/admin/maintenance`.

**Risk:** don't reap a still-active scope — the "keep most-recently-served per (owner,col,band)" guard covers it.

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | `scope_hash`/`last_served_at` columns + indexes + migration (truncate) | migration applies; type-checks parity; behavior unchanged |
| 2 | `resolveScopeHash` + per-user raw/aggregate tiles + scope ETag | raw path per-user; ETag varies by scope |
| 3 | dissolve serve honours `scope_hash` (safe degrade to raw) | serve returns only matching-scope rows |
| 4 | per-scope precompute + system principal + lazy fill; retire `buildSessionViews` | dissolve per-scope + self-filling; no magic-string principals |
| 5 | orphan-scope retention reap | stale scopes reaped, active kept |

## Cross-slice notes

- **Transitional default:** slice 1's `scope_hash DEFAULT ''` keeps slices 1–3 green; every real writer sets it explicitly from slice 4. The default is a harmless safety net (a `""` row never matches a real caller hash); no separate drop-default migration.
- **Pre-merge degradation (slice 3→4):** between slices 3 and 4 the dissolve serves raw everywhere (safe, slower). This never reaches users — the PR merges only after slice 4 restores per-scope dissolve. Worth stating in the PR body.
- **`stationId` in `renderTile`** (slice 2): it already flows to `runSessionViewTile`; confirm the source when hoisting the build resolution for the ETag.
- **No user-facing doc surface** — the map tile/dissolve behavior isn't in help/glossary/READMEs; the new reap job self-registers on `/api/admin/maintenance`. No `CLAUDE.md` change (the retention-purge + system-principal patterns are pre-existing).
- **Migration hygiene:** commit `.sql` + `_journal.json` + `0117_snapshot.json` together; `lint:migrations` needs the `-- destructive-ok:` marker on the truncate.

## Next step

Implementation begins on `feat/643-map-tile-dissolve-view-scope`, slice 1 first (tests-first, one commit per slice), only after discovery + spec + plan are confirmed. Full review chain (code-review + security + smoke + adversarial) after the slices land.
