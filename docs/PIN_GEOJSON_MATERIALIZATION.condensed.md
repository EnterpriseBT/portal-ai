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

## Decision — re-encode the snapshot's geometry values in place (not re-run the SQL)

**Why not `geoInlineRows`:** it *re-runs* the pipeline SQL, and `resolveSqlDelivery` returns a **handle** for > `INLINE_ROWS_THRESHOLD` (100) rows — which every handle-backed map is (up to the 5,000 `PIN_SNAPSHOT_ROW_CAP`). So the re-run's GeoJSON-conversion branch never fires for the exact case #371 is about, and re-running is uncapped. The ticket's evidence is the tell: *"only the value encoding differs"* — the rows are right, only the geometry column's encoding is WKB.

**Fix:** a new `geoReencodeRows(rows, geometryColumns, deps?)` in `geo-delivery.util.ts` converts each row's geometry value **EWKB hex → GeoJSON** via one batch `SELECT ST_AsGeoJSON(ST_GeomFromEWKB(decode(hex,'hex')))` (bound as `unnest($hex[], $idx[])`, so no id-list AST overflow and no re-run). It preserves the exact ≤cap snapshot — count, order, every other column. Values that aren't WKB-hex strings (already GeoJSON objects, or null) pass through untouched, so it's idempotent and safe on the inline/static paths.

Make `assemble` **async**; when `geometryColumnsFromSpec(source.spec)` is non-empty and there are rows, run `geoReencodeRows` before building the snapshot. `MaterializeDeps` gains a `geoReencodeRows?` seam (unit tests inject a fake; the default binds `db.execute`).

Rejected: `geoInlineRows` (re-runs → handle for the large case, uncapped); a Node-side WKB parser (new dependency; the DB already has `ST_AsGeoJSON`).

## Plan — 1 slice

- **Files.** New: `geoReencodeRows` in `apps/api/src/tools/geo-delivery.util.ts` (EWKB-hex → GeoJSON batch re-encode, `db.execute` seam). Edit `apps/api/src/services/portal-result-pin.service.ts`: `MaterializeDeps` gains `geoReencodeRows?`; `assemble` becomes `async`, takes `(…, deps)`, re-encodes geo rows; the 3 call sites `await assemble(…, deps)`.
- **Tests** (`npm run test:unit`):
  - New `geo-delivery.util` unit test: `geoReencodeRows` converts WKB-hex geometry values to the executor's GeoJSON output; leaves non-hex/null values and non-geometry columns untouched; a no-op for `[]` columns or `[]` rows.
  - Extend `portal-result-pin.service.test.ts`: a handle-backed **geo** pin (spec with a `geometryColumn`, `getSnapshot` → rows with WKB) has its `content.rows[].<geom>` re-encoded via the injected `geoReencodeRows`; a **non-geo** (data-table) pin does **not** call it (rows pass through); a geo pin still materializes when there are no rows (no-op).

## Smoke (manual, against your dev stack)

1. Ask the assistant to map a result with **> 100 rows** (e.g. "heatmap of parcels by market value" over a large entity) → delivered as a tile/handle-backed map. **Pin** it.
2. Open the pinned result's detail page. **Before:** "No mappable features in this result"; one refresh click fixes it. **After:** the map renders its features immediately, no refresh needed.
3. In `db:studio`, the pinned `portal_results` row's stored `content.rows[].<geom>` is GeoJSON (`{"type":"Point",…}`), not WKB hex (`0101000020…`).
4. A **small** (≤100-row) inline map still pins and renders fine (regression) — its `geom` stays GeoJSON.

## Out of scope

- The tile-rendering path (#450) and the low-zoom polygon treatment (#472).
- Any change to `geoInlineRows` itself or the mint/refresh paths.
