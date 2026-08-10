# Inline map geometry corrupted by the LLM cell cap — Condensed design (#343)

**Issue:** [EnterpriseBT/portal-ai#343](https://github.com/EnterpriseBT/portal-ai/issues/343) · Bug · epic [#84](https://github.com/EnterpriseBT/portal-ai/issues/84) · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Mapping a small/inline result (≤ 100 rows) of any real polygon/line layer fails with `SyntaxError: Unexpected token '…' … is not valid JSON`. `geoInlineRows` reprojects geometry to GeoJSON by packing each row's **entire GeoJSON** into one `_row` cell and running it through `AnalyticsService.sqlQuery` — the **LLM-facing** query path, which caps every cell at 500 bytes (`capCell`) and replaces anything larger with the marker string `…<truncated, original Nb>`. Any real geometry exceeds 500 b, so `_row` comes back as that marker and `JSON.parse` throws. Points/tiny geometries stayed under the cap (why it "worked before"). Single package: `apps/api`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| `geoInlineRows` display query | `apps/api/src/tools/geo-delivery.util.ts:52-59` | `SELECT to_jsonb(_q) \|\| jsonb_build_object('geom', ST_AsGeoJSON(_q.geom)::jsonb) AS _row FROM (<sql>) _q`, run via `AnalyticsService.sqlQuery` — the whole row's GeoJSON is one `_row` cell. |
| `JSON.parse` of the cell | `geo-delivery.util.ts:60-66` | `typeof v === "string" ? JSON.parse(v) : (v ?? {})` — throws when `v` is the truncation marker. |
| `capCell` (the marker) | `apps/api/src/services/portal-sql-response.util.ts:79-87` | serializes a cell; if `> cellCap` (default **500 b**) → `` `…<truncated, original ${n}b>` ``. |
| `sqlQuery` cap params | `apps/api/src/services/analytics.service.ts:464-466` | already accepts `rowCap` / `cellCap` / `payloadCap` overrides → forwarded to `runSqlQuery` (`portal-sql.service.ts:340-342`). |

Reproduced directly: `SELECT c_geometry AS geom FROM parcels … LIMIT 100` → `resolveSqlDelivery` (inline) → `geoInlineRows` → `SyntaxError` at `:62`.

## Decision — run the internal reproject without the LLM-facing caps (+ harden the parse)

The response caps (`rowCap`/`cellCap`/`payloadCap`) exist to protect the **model's context window** for `sql_query`. `geoInlineRows` is an **internal render transform** whose output goes to the map widget, never the model — so those caps must not apply to it. Two moves:

1. **Bypass the caps.** Pass a `RAW_CAP = Number.MAX_SAFE_INTEGER` for `rowCap`/`cellCap`/`payloadCap` on the `geoInlineRows` `sqlQuery` call. The inline path is already bounded (≤ `INLINE_ROWS_THRESHOLD` = 100 rows), so this can't blow up unbounded — it just stops the reproject from being mangled.
2. **Harden the parse (defense in depth).** Wrap the `JSON.parse(v)` at `:62` in a try/catch that falls back to `{}` for a row it can't parse, so one bad cell can never crash the whole map again.

Not doing: raising the global `cellCap`, or a new dedicated raw executor — the existing per-call cap params are the minimal, correct lever, and (1)+(2) fully address the failure.

## Plan — 1 slice

**Files**
- Edit `apps/api/src/tools/geo-delivery.util.ts` — add `RAW_CAP`; pass `rowCap`/`cellCap`/`payloadCap: RAW_CAP` on the `sqlQuery` call; wrap the string-branch `JSON.parse` in try/catch → `{}`.
- New `apps/api/src/__tests__/tools/geo-delivery.util.test.ts`.

**Tests** (`cd apps/api && npm run test:unit`)
- Injects a mock `sqlQuery` (via `geoInlineRows`' `deps`) and asserts it is called with `cellCap`/`payloadCap`/`rowCap === Number.MAX_SAFE_INTEGER` (the fix — a regression guard if someone drops the overrides).
- `_row` as an object → returned as-is; `_row` as a valid JSON string → parsed.
- `_row` as a **non-JSON string** (a `…<truncated…>` marker) → returns `{}`, **does not throw** (the exact bug).
- No geometry columns / empty `rawRows` → `rawRows` returned unchanged.

*(The unit test asserts the fix + hardening against a mock; the real end-to-end — a big-geometry parcel reprojecting through the actual capped `sqlQuery` — is the manual smoke below.)*

## Smoke (manual, against your dev stack)

1. On the `GIS smoke` station, ask for a **small/inline** parcels map with real polygons: e.g. *"map the 100 largest parcels by acreage."*
2. **Expected:** the 100 parcels render inline as filled polygons — **no** "JSON parsing error", no empty map.
3. Sanity: a points layer (small lat/lng result) still renders (regression); a large parcels layer still tiles (unchanged — that path never calls `geoInlineRows`).
4. Sanity: widget-refresh on an inline geo widget still renders identically (the shared helper).

## Out of scope

- Raising or reworking the global `sql_query` cell/payload caps (they're correct for LLM-facing responses).
- The large-result **tile** path (unaffected — no inline reproject).
- Row-count reporting (#340) and any other map surface.
