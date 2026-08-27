# Pinned handle-backed map — GeoJSON materialization (#371)

**Issue:** [EnterpriseBT/portal-ai#371](https://github.com/EnterpriseBT/portal-ai/issues/371) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc). Child of epic [#470](https://github.com/EnterpriseBT/portal-ai/issues/470); branches off / PRs into `epic/map-tiles-at-scale`. Independent of #450 (different code path).

**Why.** A pinned **handle-backed** map (a result > `INLINE_ROWS_THRESHOLD` = 100 rows) renders empty ("No mappable features") until the user clicks refresh. Pin materialization hydrates rows from the handle snapshot, which carries raw PostGIS **WKB hex** in the geometry column; MapLibre can't read WKB, so `featuresForLayer` yields nothing. The inline mint path and the refresh path both convert geometry to GeoJSON via `geoInlineRows`; materialization doesn't. A small (inline ≤100-row) map pins fine — only the handle-backed path is broken. `apps/api` only, no contract change.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Handle materialization (3 assemble sites) | `apps/api/src/services/portal-result-pin.service.ts:176,199,205` | all `assemble(source, rows, total, pipeline)` with **WKB** geometry rows |
| `assemble` | `portal-result-pin.service.ts:72` | sync; builds the snapshot content from rows |
| The conversion (already used by mint + refresh) | `apps/api/src/tools/geo-delivery.util.ts` → `geoInlineRows` (`:52`), `geometryColumnsFromSpec` (`:33`) | re-runs the pipeline SQL, overriding geometry keys with `ST_AsGeoJSON(...)::jsonb` |
| Working precedent | `apps/api/src/services/portal-viz-refresh.service.ts:194,265` | refresh reprojects via `geoInlineRows(pipeline.sql, geometryColumnsFromSpec(spec), rows, scope)` — why refresh fixes it |
| Empty-map symptom | `apps/web/.../MapWidget.component.tsx` `hasFeatures` | WKB → no features |

## Decision — reproject at materialization, in `assemble`, mirroring the refresh path

All three handle-materialization returns funnel through `assemble`. Make `assemble` **async** and, when the content is geo (`geometryColumnsFromSpec(source.spec)` non-empty) **and** a `pipeline.sql` exists **and** there are rows, reproject via `geoInlineRows(pipeline.sql, geomCols, rows, scope)` before building the snapshot. For a non-geo pin (`geometryColumnsFromSpec` → `[]`) or a static pin with no pipeline, it's a no-op — so the inline path (already GeoJSON at mint) and data-table pins are untouched. Add a `geoInlineRows?` seam to `MaterializeDeps` for unit testing (mirrors `geoInlineRows`'s own `sqlQuery` seam).

Rejected: converting in the general `materialize` (would double-run the SQL for already-GeoJSON inline pins); a bespoke WKB→GeoJSON parse in Node (duplicates the `geoInlineRows` transform the other two paths already own — the drift this shared util exists to prevent).

## Plan — 1 slice

- **Files.** Edit `apps/api/src/services/portal-result-pin.service.ts`: `MaterializeDeps` gains `geoInlineRows?`; `assemble` becomes `async`, takes `(…, scope, deps)`, reprojects geo rows; the 3 call sites `await assemble(…, scope, deps)`.
- **Tests** (`npm run test:unit`): extend `apps/api/src/__tests__/services/portal-result-pin.service.test.ts`:
  - a handle-backed **geo** pin (spec with a `geometryColumn`, `pipeline.sql` present, `getSnapshot` → rows with WKB) calls the injected `geoInlineRows` with `(pipeline.sql, [geomCol], rows, scope)` and the materialized `content.rows` are its GeoJSON output.
  - a **non-geo** (data-table) pin does **not** call `geoInlineRows` (rows pass through).
  - a geo pin with **no pipeline** (static) passes rows through unchanged (no throw).

## Smoke (manual, against your dev stack)

1. Ask the assistant to map a result with **> 100 rows** (e.g. "heatmap of parcels by market value" over a large entity) → delivered as a tile/handle-backed map. **Pin** it.
2. Open the pinned result's detail page. **Before:** "No mappable features in this result"; one refresh click fixes it. **After:** the map renders its features immediately, no refresh needed.
3. In `db:studio`, the pinned `portal_results` row's stored `content.rows[].<geom>` is GeoJSON (`{"type":"Point",…}`), not WKB hex (`0101000020…`).
4. A **small** (≤100-row) inline map still pins and renders fine (regression) — its `geom` stays GeoJSON.

## Out of scope

- The tile-rendering path (#450) and the low-zoom polygon treatment (#472).
- Any change to `geoInlineRows` itself or the mint/refresh paths.
