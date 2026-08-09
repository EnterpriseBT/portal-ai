# Low-zoom aggregation treatment for line (and point) layers — Spec

Pins the contract for per-`kind` low-zoom map aggregation: line layers render as **importance-ranked raw lines** instead of square bins, points/polygons keep bins, and the choice is **agent-driven** via a new `treatment` field with per-kind heuristic defaults. Discovery: `docs/LOW_ZOOM_LINE_AGGREGATION.discovery.md`. Issue: [#337](https://github.com/EnterpriseBT/portal-ai/issues/337) (epic [#84](https://github.com/EnterpriseBT/portal-ai/issues/84); UI settings deferred to [#338](https://github.com/EnterpriseBT/portal-ai/issues/338)).

## Key decisions (flag for review)

1. **Per-kind default:** `lines → "none"` (raw, importance-ranked, at all zooms), `points`/`polygons` → `"bins"` (unchanged). Absent `treatment` ⇒ this per-kind auto.
2. **Importance = `ST_Length(ST_Transform(geom,3857)) DESC`** — a dataset-agnostic proxy; the per-tile cap keeps the longest (major) segments first, so low zoom shows a legible skeleton and never an arbitrary scatter. Applied at **all zooms** for line layers (OQ4 lean).
3. **Mechanism:** routing reuses the existing `shouldAggregate` switch (`aggregationFromSpec` returns `enabled:false` for `none`); ranking is one `ORDER BY` added to `buildRawTileSql`. **No new grid SQL.**
4. **Choice is agent-driven** with a deterministic per-kind heuristic default (three-layer resolution: agent-authored `treatment` > per-kind heuristic default > constant). Guidance added to `system.prompt` + `visualize_map`.
5. **Deferred:** length-weighted density surface (future `treatment:"density"`), an explicit `rankBy` column, and in-widget UI settings (#338).

## Scope

### In scope
- `treatment` contract field + shared `resolveAggTreatment` resolver (core).
- Server routing (`aggregationFromSpec`) + ranking (`buildRawTileSql`) + wiring (`defaultRunTileQuery`).
- Web: `layerToMapLibre` kind-gate on the aggregate block; kind-aware truncation-notice copy.
- Agent guidance: `system.prompt` Mapping block + `visualize_map` description (+ its `builtin-toolpacks.ts` mirror if present).

### Out of scope
- Length-weighted density / heatmap paint (deferred; `treatment:"density"` reserved).
- `rankBy` importance column (ST_Length is the agnostic default).
- In-widget UI controls (#338).
- Any change to polygon/point aggregation SQL or the bin paint.

## Surface

### `packages/core/src/contracts/map-spec.contract.ts`

Add `treatment` to `MapLayerAggregationSchema` (currently `:105-109`):

```ts
export const MapLayerAggregationSchema = z.object({
  enabled: z.boolean().optional(),
  gridSizePx: z.number().int().positive().max(128).optional(),
  zoomThreshold: z.number().int().min(0).max(22).optional(),
  /** Low-zoom shape. Absent ⇒ per-kind auto (lines → "none", else "bins").
   *  "bins": square grid bins. "none": raw features at all zooms (lines are
   *  importance-ranked by length so the per-tile cap keeps major features). */
  treatment: z.enum(["bins", "none"]).optional(),
});
```

Export the kind type + resolver (co-located with the schema; imported by both api and web):

```ts
export type MapLayerKind = z.infer<typeof MapLayerSchema>["kind"];
export type AggTreatment = "bins" | "none";

/** Resolve a layer's low-zoom treatment. Explicit `treatment` wins; otherwise
 *  per-kind: lines → "none" (raw, ranked), points/polygons/heatmap/cluster →
 *  "bins". The single source of truth shared by the tile query + the web paint. */
export function resolveAggTreatment(
  kind: MapLayerKind,
  treatment?: AggTreatment
): AggTreatment {
  if (treatment) return treatment;
  return kind === "lines" ? "none" : "bins";
}
```

### `apps/api/src/services/portal-map-tile.service.ts`

**`TileAggregation`** (`:143-149`) gains two fields:

```ts
export interface TileAggregation {
  enabled: boolean;
  zoomThreshold: number;
  gridSizePx: number;
  colorByColumn: string | null;
  kind: MapLayerKind | null;   // representative layer kind
  rankByLength: boolean;       // raw path orders by ST_Length DESC (lines)
}
```

**`aggregationFromSpec(spec)`** (`:157-185`) — pick a representative layer (the one supplying the aggregation block, else the first), resolve its treatment, and fold it into `enabled` + `rankByLength`:

- `const rep = layers.find(l => l?.aggregation) ?? layers[0];`
- `const kind = (rep?.kind ?? null) as MapLayerKind | null;`
- `const treatment = rep?.aggregation?.treatment as AggTreatment | undefined;`
- `const resolved = kind ? resolveAggTreatment(kind, treatment) : "bins";`
- `enabled: resolved === "none" ? false : (agg.enabled ?? true)` — `treatment:"none"` (and the line default) routes to the raw path via the existing `shouldAggregate`; an explicit `enabled:false` still disables a `"bins"` layer.
- `rankByLength: kind === "lines"` — only lines get length-ranked (ST_Length on polygons is 0; harmless but pointless).
- `kind`, plus the existing `zoomThreshold`/`gridSizePx`/`colorByColumn` unchanged.

`shouldAggregate` (`:188-190`) is **unchanged** — `enabled:false` already makes it return false.

**`buildRawTileSql`** (`:277-304`) gains a final `rankByLength: boolean` param and inserts the order before `LIMIT`, inside the `lim` CTE:

```
… WHERE src.geom && ST_Transform(${envelope}, 4326) `
  + (rankByLength ? `ORDER BY ST_Length(ST_Transform(src.geom, 3857)) DESC ` : ``)
  + `LIMIT ${cap}`
```

**`defaultRunTileQuery`** (`:382-391`) passes `aggregation.rankByLength` as the new argument to `buildRawTileSql`. The aggregate branch is untouched.

### `apps/web/src/modules/MapWidget/utils/map-config.util.ts`

`layerToMapLibre` (`:256-386`) — import `resolveAggTreatment` from `@portalai/core/contracts` and gate the aggregate block (`:352-383`) on the resolved treatment:

```ts
const agg = layer.aggregation;
const treatment = resolveAggTreatment(layer.kind, agg?.treatment);
if (opts.tiled && agg?.enabled !== false && treatment === "bins") {
  // …existing minzoom-gate + aggregate fill, unchanged…
}
```

For a `"none"` layer (lines by default) the block is skipped: no aggregate fill is pushed and the raw kind-layer keeps `minzoom` unset, so real lines render at every zoom.

### `apps/web/src/modules/MapWidget/MapWidget.component.tsx`

The truncation notice (currently the "partial at this zoom" copy) becomes **kind-aware**: when the tiled spec's representative layer `kind === "lines"`, the truncated copy reads *"Showing the most prominent features — zoom in for the rest."*; otherwise the existing copy. Derived from `spec.layers` already in scope — **no new response header**.

### Agent surfaces

- **`apps/api/src/tools/visualize-map.tool.ts`** — extend the `spec` `.describe(...)` (`:29-31`) to name `aggregation.treatment` (`"bins"`/`"none"`; lines default to raw). The categorical `colorBy.stops` back-fill (`:215-243`) is **unchanged** (it colors raw lines fine). Update the **`builtin-toolpacks.ts` mirror** of this description if one exists (doc-sync).
- **`apps/api/src/prompts/system.prompt.ts`** — extend the Mapping block (`:250-266`) with one line: line layers stay a raw, importance-ranked network at low zoom by default (great for road networks); set `aggregation.treatment:"bins"` to force grid bins or `"none"` to force raw on any layer; omission uses the per-kind default. Prompt-pinning test updates accordingly.

## Migration
No DB schema change — no migration.

## Seed
None.

## TDD test plan

Run per package (never raw jest): `cd <pkg> && npm run test:unit` / `npm run test:integration`.

### core — `packages/core/src/__tests__/contracts/map-spec.contract.test.ts`
- `treatment:"bins"` / `"none"` accepted; invalid value rejected; absent ok (existing specs unchanged). (~3)
- `resolveAggTreatment`: `lines`→`none`; `points`/`polygons`/`heatmap`/`cluster`→`bins`; explicit `treatment` overrides each kind. (~5)

### api (unit) — `apps/api/src/__tests__/services/portal-map-tile.service.test.ts`
- `aggregationFromSpec`: a line layer → `enabled:false`, `rankByLength:true`, `kind:"lines"`; polygon → `enabled:true`, `rankByLength:false`; `treatment:"bins"` on a line → `enabled:true`; `treatment:"none"` on a polygon → `enabled:false`; explicit `enabled:false` on a bins layer still disables. (~5)
- `buildRawTileSql`: `rankByLength:true` emits `ORDER BY ST_Length(ST_Transform(src.geom, 3857)) DESC` before `LIMIT`; `false` omits it (byte-for-byte as today). (~2)
- `shouldAggregate` unchanged with the new interface (regression). (~1)

### api (integration) — `apps/api/src/__tests__/__integration__/db/map-aggregation.integration.test.ts`
- A tiled **line** layer at a low zoom (z < threshold) returns raw line features (not bin polygons) and, when over the cap, the kept set is the longest-first; the truncation flag is set. (~2)
- A tiled **polygon** layer at low zoom still returns aggregate bins (regression). (~1)
- Benchmark check (OQ4): the ranked `ORDER BY` on the largest line layer stays under `TILE_STATEMENT_TIMEOUT_MS` — assert the low-zoom line tile query completes (extend `scripts/postgis-benchmark.ts` for the timing artifact). (~1)

### api (prompt pin) — `apps/api/src/prompts/__tests__/system.prompt.test.ts`
- Mapping block contains the new treatment guidance. (~1)

### web — `apps/web/src/modules/MapWidget/__tests__/map-config.util.test.ts`
- Tiled **line** layer → no `-agg` fill layer, raw `-line` layer has no `minzoom` (renders at all zoom). (~1)
- Tiled **polygon**/**point** layer → `-agg` fill + `minzoom` as today (regression). (~2)
- `treatment:"bins"` on a line → `-agg` fill added; `treatment:"none"` on a polygon → no `-agg` fill. (~2)

### web — `apps/web/src/modules/MapWidget/__tests__/MapWidget.test.tsx`
- Truncated + line layer → "most prominent features" copy; truncated + polygon → existing copy. (~2)

**Totals ≈ 28 cases** (core 8, api 12, web 8).

## Acceptance criteria

- [ ] A tiled line layer at low zoom renders a legible major-feature network (real lines, longest-first), not square bins and not an arbitrary scatter — at any dataset size, incl. a statewide network.
- [ ] Polygon + point aggregation is byte-for-byte unchanged.
- [ ] `treatment:"bins"` forces bins on a line; `treatment:"none"` forces ranked-raw on a polygon.
- [ ] Absent `treatment` uses the per-kind default (lines→raw, others→bins); the default is computed deterministically, not by the LLM.
- [ ] A prompt expressing intent ("map the road network" vs "where are roads dense") can steer the treatment via the agent-authored field.
- [ ] The truncation notice on a clipped line tile reads as "most prominent features shown", not "arbitrary/partial".
- [ ] Existing specs (no `treatment`) validate and render unchanged; `WidgetRefreshResponse` consumers untouched.

## Risks & rollback

- **Sort cost at lowest zoom.** The ranked `ORDER BY` is a top-N over the GiST-bounded envelope; a huge line layer at z≲6 is the ceiling. Detected by the benchmark (test plan) and bounded by `TILE_STATEMENT_TIMEOUT_MS` (a slow tile degrades to the existing typed 504, never a hang). Rollback: gate the `ORDER BY` to `z < zoomThreshold` (OQ4's alternative) — a one-line change.
- **Representative-layer ambiguity** for a hypothetical multi-kind single-pipeline spec. Doesn't occur (one pipeline = one geometry set); `rep = first aggregation layer ?? layers[0]` mirrors the existing colorBy/knob collapse.
- **Fail posture:** render-time, read-only, no billing/state — fail-open is correct (a resolver miss falls back to `"bins"`, the pre-#337 behavior). Rollback of the whole feature is reverting the branch; the `treatment` field is additive so no data migration is needed.

## Files touched

- **Edit** `packages/core/src/contracts/map-spec.contract.ts` — `treatment` field, `MapLayerKind`/`AggTreatment` types, `resolveAggTreatment`.
- **Edit** `apps/api/src/services/portal-map-tile.service.ts` — `TileAggregation` fields, `aggregationFromSpec`, `buildRawTileSql` param + `ORDER BY`, `defaultRunTileQuery` wiring.
- **Edit** `apps/api/src/tools/visualize-map.tool.ts` — spec `.describe` treatment note.
- **Edit** `apps/api/src/prompts/system.prompt.ts` — Mapping block treatment guidance.
- **Edit** `packages/core/src/registries/builtin-toolpacks.ts` — mirror the `visualize_map` description (if it mirrors).
- **Edit** `apps/web/src/modules/MapWidget/utils/map-config.util.ts` — kind-gate the aggregate block.
- **Edit** `apps/web/src/modules/MapWidget/MapWidget.component.tsx` — kind-aware truncation copy.
- **Edit** `apps/api/src/scripts/postgis-benchmark.ts` — low-zoom ranked line-tile timing.
- **Tests** — the six files in the test plan.

## Next step

`/plan 337` slices this on `chore/low-zoom-line-aggregation` — ≈4 TDD slices: (1) core contract field + `resolveAggTreatment` + tests; (2) server `aggregationFromSpec` kind-read + `buildRawTileSql` ranking + `defaultRunTileQuery` wiring + unit/integration tests + benchmark; (3) web `layerToMapLibre` kind-gate + kind-aware notice + tests; (4) agent guidance (`system.prompt` + `visualize_map` + mirror) + prompt-pin + doc-sync. Each a green, compilable commit.
