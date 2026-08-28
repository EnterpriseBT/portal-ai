# Aggregate map tile performance — Discovery

**Issue:** [EnterpriseBT/portal-ai#450](https://github.com/EnterpriseBT/portal-ai/issues/450) · child of epic [#470](https://github.com/EnterpriseBT/portal-ai/issues/470) (`epic/map-tiles-at-scale`).

**Why this exists.** A `geo` map over a large polygon layer (283K rows) is authored to open at zoom 8, but every aggregate tile below z12 exceeds the 10s `statement_timeout` and fails — the map opens on a zoom at which it can never render. The ticket measured three causes in descending cost: (1) the `entity_records` join is ~93% of query cost, (2) the aggregate `LIMIT` bounds output not work, (3) polygons are centroid-binned so a choropleth is invisible until z14. This is the performance half of the map-tiles epic; #449 (already merged into the epic) made these failures visible, so this work is now diagnosable. **This is the fix that makes large polygon maps render at overview zooms.**

## The current shape

### Cause 1 — the `entity_records` join in every session view

`PortalSqlService.buildSessionViews` (`apps/api/src/services/portal-sql.service.ts:143`) builds one temp view per entity (`portal-sql.service.ts:212-218`):

```sql
CREATE OR REPLACE TEMP VIEW "<key>" AS
  SELECT … FROM "er__<id>" w
  JOIN entity_records er ON er.id = w."entity_record_id"
  WHERE w."organization_id" = '<orgId>' AND er.deleted IS NULL
```

The join exists **solely** to evaluate `er.deleted IS NULL`. The wide table `er__<id>` (`WideTableReconcilerService.ensureTable`, `wide-table-reconciler.service.ts:174-210`) has metadata columns `entity_record_id` (PK, FK→`entity_records` `ON DELETE CASCADE`), `organization_id`, `synced_at`, `is_valid`, `source_id` — but **no `deleted` column** (confirmed `wide-table.repository.ts:556-557`: "soft-deletes on `entity_records` are represented by absence on the wide side"). The same join is in the repository read path `wide-table.repository.ts:160-163` (`fetchProjectedRows`). Measured (ticket): z11 tile **23,124ms with the join → 1,584ms without (14.6×)**.

### Cause 2 — the aggregate `LIMIT` bounds output, not work

`PortalMapTileService.buildAggregateTileSql` (`portal-map-tile.service.ts:362`) snaps `ST_Centroid(ST_Transform(geom,3857))` to a grid (`:382`), filters `WHERE geom && ST_Expand(envelope, cellSize)` (`:385`), `GROUP BY 1` (`:386`), then `LIMIT cap` (`:387`). The `LIMIT` caps *bins emitted* after the group-by while the scan still touches every row in the envelope — so z8 spends 56s to emit 68 bins, and the cost scales with dataset size exactly at the zooms where the envelope covers the whole layer. `shouldAggregate(z, agg)` (`:228`) = `agg.enabled && z < zoomThreshold` (default `AGG_ZOOM_THRESHOLD=14`, `packages/core/src/constants/large-data-ops.constants.ts:118`).

### Cause 3 — polygons are centroid-binned (choropleth invisible < z14)

`resolveAggTreatment(kind, treatment?)` (`packages/core/src/contracts/map-spec.contract.ts:157-163`) routes `lines → "none"` (raw) and everything else → `"bins"`; the enum is `z.enum(["bins","none"])` (`:120`). On the client, `layerToMapLibre` (`apps/web/src/modules/MapWidget/utils/map-config.util.ts:471-480`) sets raw layers `minzoom = threshold` and the aggregate fill `maxzoom = threshold`, so below z14 a zip choropleth renders as 24px centroid squares, not polygons. This is a **map-spec contract decision**, independent of the budget.

### Soft-delete precedent + reconciler write paths

`entity_records.deleted` is a `baseColumns` bigint (`base.columns.ts:46-47`). `source_id` is the existing precedent for mirroring an `entity_records` column onto the wide table (`wide-table-statement.cache.ts:85-88`). The #327 soft-delete cascade is a chunked **DELETE** of wide rows (`wide-table.repository.ts:566-583`) because a soft-delete is an UPDATE (so `ON DELETE CASCADE` never fires). Writers: `upsertMany` (`:217`), `updatePartial` (`:504`); metadata column list `WIDE_TABLE_METADATA_COLUMNS` (`wide-table-statement.cache.ts:90-96`).

## The design space

### Decision 1 — how to drop the join (cause 1)

**A. Add a `deleted` column to the wide table**, mirrored from `entity_records`, maintained by the reconciler + write paths; the soft-delete cascade becomes an `UPDATE … SET deleted = …` of the wide row instead of a DELETE; session view + `fetchProjectedRows` filter `w.deleted IS NULL` locally, no join.
**B. Trust absence, drop the join only** — the cascade already physically deletes wide rows on soft-delete, so (in principle) the wide table holds only live rows; drop both the join and the filter.

| | A (deleted column) | B (trust absence) |
|---|---|---|
| Schema change | Yes (one metadata column + backfill) | None |
| Correctness backstop | Local column, atomic with the row write | Relies on the separate cascade DELETE never lagging/failing — the join is today's backstop against exactly that |
| Soft-delete op | UPDATE (recoverable, mirrors `entity_records`) | DELETE (unchanged) |
| Matches ticket direction | Yes | No |

**Lean: A.** The ticket calls for it, and it's the robust choice: the join exists *because* absence-on-soft-delete is a two-step invariant a separate cascade must uphold; folding `deleted` onto the wide row makes the state local and atomic with the write, and benefits **every** portal-SQL query, not just tiles. B is a latent-correctness gamble to save a migration.

### Decision 2 — scope of cause 2 (bound the work) in #450

**A. Ship cause 1, then measure; add a minimal work-bound only if a zoom still exceeds budget.**
**B. Always precompute** a per-zoom bin table refreshed on sync.
**C. Defer cause 2 entirely** to a scale-hardening follow-up.

The ticket's own numbers imply cause 1 alone likely clears the budget on today's data (z8 55,864ms / 14.6 ≈ 3.8s; z9 ≈ 4.7s; z10 ≈ 2.0s; z11 ≈ 1.6s). Cause 2 is a *scale-durability* problem (the full-envelope scan grows with the layer), not a today problem once the join is gone.

**Lean: A.** Land cause 1, re-run the per-zoom measurement on the 283K layer (the smoke does this), and only add a bound if a zoom is still red. Precomputed bins (B) is real infrastructure (refresh-on-sync, storage, staleness) unjustified until the in-query fix is shown insufficient — the "don't build speculative infra without a caller" rule. Record the measurement either way.

### Decision 3 — cause 3 (polygon low-zoom treatment)

**A. Split into its own epic child** — a new `AggTreatment` (e.g. `"dissolve"`/`"choropleth"`) is a map-spec **contract** change (enum `:120`, `resolveAggTreatment` `:162`, consumers in `portal-map-tile.service.ts:203` + `map-config.util.ts:471-480`) with its own correctness surface and tests.
**B. Include it in #450.**

**Lean: A — split it.** The ticket explicitly flags this. #450's contract is "meet the 10s budget"; cause 3 is "render the *correct* low-zoom shape," a distinct, contract-touching problem. Splitting keeps #450 a focused performance fix and gives the choropleth treatment its own discovery (dissolve-by-`colorBy` vs simplify-and-draw). Note dissolve-by-`colorBy` would *also* bound the work (Decision 2), so the split child may subsume cause 2 — another reason to keep cause 2 conditional in #450.

## Tradeoff comparison

| | D1 lean (deleted column) | D2 lean (measure-then-bound) | D3 lean (split cause 3) |
|---|---|---|---|
| Spread to spec | Yes | Yes | Files the new child |
| Schema/contract change | Wide-table schema | None (unless bound needed) | Map-spec contract (in the child) |
| Blast radius | portal-sql + wide-table repo + reconciler | portal-map-tile only | new child only |

## Recommendation

1. **#450 core = cause 1.** Add a `deleted` metadata column to the wide table (reconciler `ensureTable`, `WIDE_TABLE_METADATA_COLUMNS`, `upsertMany`/`updatePartial`), backfill existing wide rows from `entity_records.deleted`, change the #327 soft-delete cascade to an UPDATE of the column, and drop the `entity_records` join from both `buildSessionViews` and `fetchProjectedRows` (filter `w.deleted IS NULL` locally).
2. **Cause 2 is conditional (Decision 2).** After cause 1 lands, measure per-zoom on the 283K layer; add a minimal work-bound only if a zoom still exceeds budget. Record the measurement in the smoke doc regardless.
3. **Split cause 3 into a new epic child** — "correct low-zoom treatment for polygon choropleths (map-spec `AggTreatment`)" — added to epic #470 as a sub-issue.

## Open questions

1. **Backfill for the new `deleted` column.** Existing wide rows have no `deleted`; on soft-deleted records, absence means the wide row was already cascade-deleted, so a backfill `SET deleted = er.deleted FROM entity_records` is mostly a no-op but is the correct one-time reconcile (and closes the window where a cascade lagged). **Lean: include the backfill migration** — cheap, and it makes the column trustworthy from day one. Follows the `0080` per-org backfill precedent (`CLAUDE.md` → data migrations).
2. **Does dropping the join change `is_valid`/hidden-column semantics?** The view also projects `is_valid` and hides `VIEW_HIDDEN_COLUMNS` (`portal-sql.service.ts:67`) — the join removal must not change the projected column set, only the row filter. **Lean: no behavior change** — assert identical rows (minus deleted) in the integration test.
3. **Is a partial index `(organization_id) WHERE deleted IS NULL` on the wide table warranted?** The local filter replaces the join, but the envelope scan is GiST-driven; the `deleted` filter is a residual. **Lean: add `deleted` to the existing GiST/scope index predicate only if the smoke measurement shows the residual filter matters** — tie it to the same measure-then-optimize discipline as Decision 2 (`CLAUDE.md` → #433/#440).

## Enterprise-scale considerations

- **Scale & unbounded growth.** The core issue: the aggregate scan grows with the layer. Cause 1 removes the 14.6× join multiplier; Decision 2 keeps a work-bound in reserve for when the layer outgrows even the join-free scan. `Lean: measure-then-bound`, don't pre-build.
- **Concurrency & correctness.** MapLibre fires up to 6 concurrent tiles, each a parallel scan; cause 1 cuts each tile's cost and the row-widening (266B→32B) that spilled the group-by to disk. The `deleted` mirror must be written atomically with the row (same tx as the reconciler write / soft-delete) so a tile never sees a half-updated flag. `Lean: fold the flag into the existing write paths`, not a separate pass.
- **Accuracy & auditability.** Soft-delete becomes an UPDATE on the wide row (recoverable, mirrors `entity_records`) rather than a DELETE (absence) — a strictly more auditable state. `Lean: column over absence`.
- **Data lifecycle.** A wide `deleted` column means soft-deleted wide rows now persist and accumulate — they must be covered by the same retention purge as `entity_records` tombstones (#442). `Lean: extend the wide-table purge to the new column` (verify the purge path in spec).
- **Multi-tenancy / contract stability.** `N/A` for D1 (per-row flag, org filter unchanged). Contract stability is engaged by cause 3, which is why it splits (Decision 3).
- **Failure modes.** Fail-safe: if the backfill is incomplete, the join removal could expose a soft-deleted row. `Lean: backfill in the same migration that adds the column, and keep the integration test asserting deleted rows are excluded` — so the guarantee is tested, not assumed.

## What this doesn't decide

- **The choropleth low-zoom treatment (cause 3)** — split to its own child (Decision 3); this ticket keeps polygons on the existing bins path, just fast.
- **Whether to precompute aggregate bins (cause 2 option B)** — deferred behind the measurement; only built if the in-query fix proves insufficient.
- **The tile observability surface** — shipped in #449 (already merged into the epic).

## Next step

`docs/MAP_TILE_PERFORMANCE.spec.md` then `.plan.md` on this branch. The plan slices roughly: (1) wide-table `deleted` column + reconciler/write-path maintenance + migration/backfill; (2) drop the join in `buildSessionViews` + `fetchProjectedRows`, filter locally; (3) measure + conditional work-bound; (4) file + link the cause-3 child. Each slice an independently testable commit; child PR targets `epic/map-tiles-at-scale`.
