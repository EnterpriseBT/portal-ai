# Smooth-gradient (interpolate) colorBy mode — Spec

Pins the contract for a third `colorBy` scale — `interpolate` (continuous blend + gradient-bar legend) — alongside `match`/`step`. Discovery: `docs/SMOOTH_GRADIENT_COLORBY.discovery.md`. Issue: [#336](https://github.com/EnterpriseBT/portal-ai/issues/336) (epic #84). Builds on the `step` + null-guard from #330/#335/#346.

## Key decisions (flag for review)

1. `colorBy.scale?: "categorical" | "step" | "interpolate"` — **additive optional**; absent ⇒ current inference (numeric → step, string → match). A present value **forces** that mode. (Discovery D1)
2. Interpolate anchors are **even-linear** between server-computed `MIN`/`MAX`, colored from a new `SEQUENTIAL_PALETTE`. Quantile breaks are out of scope. (D2, open-Q1)
3. `SEQUENTIAL_PALETTE` is a **colorblind-safe multi-hue ramp**, defined **once in `@portalai/core`** and imported by both web render and api back-fill (no third palette copy). (D3, open-Q2)
4. Legend becomes a **discriminated** shape (`swatches | gradient`); the gradient legend renders a CSS bar with **min + max labels only**. (D4, open-Q3)
5. Applies to raw **and** aggregate (tiled) layers via the same back-fill seam; aggregate bins interpolate on the cell's `mode()` value. (D5)

## Scope

### In scope

- `scale` enum field on `MapLayerStyleSchema.colorBy` (core).
- `resolveColorBy` interpolate branch + scale-forced resolution + `<2`-stop fallback (web).
- Discriminated legend type + gradient-bar render (web).
- `SEQUENTIAL_PALETTE` in core.
- Server back-fill `MIN/MAX` interpolate anchors for raw + aggregate layers (api).
- Agent surfaces: `visualize_map` description + `builtin-toolpacks.ts` mirror + `system.prompt.ts`.

### Out of scope

- Quantile / skew-aware breaks (open-Q1 follow-up).
- Compact numeric formatting on the legend bar (open-Q4 cosmetic follow-up).
- A per-widget UI control to switch scale (was the deleted #338).
- Any change to `match`/`step` behavior — purely additive.

## Surface

### 1. `packages/core/src/contracts/map-spec.contract.ts` — `colorBy.scale`

Extend the `colorBy` object (currently `map-spec.contract.ts:74-83`):

```ts
colorBy: z
  .object({
    column: z.string().min(1),
    palette: z.array(z.string()).optional(),
    stops: z
      .array(z.tuple([z.union([z.string(), z.number()]), z.string()]))
      .optional(),
    /** Colour scale. Absent ⇒ inferred (string stops → categorical, numeric →
     *  step). "interpolate" is a continuous blend across the value range. */
    scale: z.enum(["categorical", "step", "interpolate"]).optional(),
  })
  .optional(),
```

Additive-optional: every existing MapSpec parses unchanged. No other schema in the file changes.

### 2. `packages/core/src/constants/map-palette.constants.ts` (NEW) — `SEQUENTIAL_PALETTE`

```ts
/** Ordered, colourblind-safe multi-hue ramp for continuous (interpolate)
 *  colorBy. Distinct from the categorical Tableau-10 palette used by match/step
 *  — a gradient needs a perceptually monotonic sequence, not distinct hues. */
export const SEQUENTIAL_PALETTE = [
  "#440154", "#414487", "#2a788e", "#22a884", "#7ad151", "#fde725",
] as const; // viridis 6-stop
```

Re-exported from `packages/core/src/constants/index.ts`. Imported by web (`map-config.util.ts`) and api (`visualize-map.tool.ts`) — the single source, no duplication.

### 3. `apps/web/src/modules/MapWidget/utils/map-config.util.ts` — legend type + `resolveColorBy` + `buildLegend`

**Discriminated legend** (replaces the flat `LegendEntry[]` return shape; `LegendEntry` stays as the swatch item):

```ts
export interface LegendEntry { label: string; color: string; }           // unchanged
export interface GradientStop { value: number; color: string; }
export type MapLegend =
  | { kind: "swatches"; entries: LegendEntry[] }
  | { kind: "gradient"; min: number; max: number; stops: GradientStop[] };
```

**`resolveColorBy`** (`:194`) new return type + resolution order:

```ts
export function resolveColorBy(
  colorBy: NonNullable<MapLayer["style"]>["colorBy"] & object,
  rows: Row[]
): { expression: unknown; legend: MapLegend | null }
```

Resolution (after building `pairs` as today, `:203-218`):

- `pairs.length === 0` → `{ expression: DEFAULT_COLOR, legend: null }`.
- Effective scale = `colorBy.scale ?? inferred` where inferred = `interpolate?` never inferred (only explicit); numeric-all → `step`, else `categorical`. (Inference unchanged: absent scale never yields interpolate.)
- **`interpolate`** and ≥2 numeric stops resolve → sort+dedupe ascending numeric `sorted`; if `<2` distinct → fall through to step (numeric) / solid. Expression:
  ```ts
  ["case", ["has", col],
    ["interpolate", ["linear"], ["to-number", ["get", col], 0],
      v0, c0, v1, c1, …],
    UNMATCHED_COLOR]
  ```
  Legend: `{ kind: "gradient", min: sorted[0][0], max: sorted.at(-1)[0], stops: sorted.map(([value,color]) => ({value,color})) }`. When deriving stops from rows (no explicit stops), colors come from `colorBy.palette ?? SEQUENTIAL_PALETTE` distributed across the derived min→max.
- **`step`** (forced or inferred-numeric) → existing `step` build (`:238-262`); legend `{ kind: "swatches", entries }`.
- **`categorical`** (forced or inferred) → existing `match` build (`:264-268`); legend `{ kind: "swatches", entries }`.

**`layerToMapLibre`** (`:295-310`) return type: `{ layers: MapLibreLayer[]; legend: MapLegend | null }` (was `LegendEntry[]`). **`buildLegend`** (`:432`) returns `MapLegend[]` — one entry per colorBy layer (skips layers with `null` legend). Barrel `index.ts:34-39` re-exports `MapLegend`, `GradientStop`.

### 4. `apps/web/src/modules/MapWidget/MapWidget.component.tsx` — gradient render

The memo (`:134-152`) types `legend` as `MapLegend[]`; the legend block (`:436-458`) switches on `kind`:

- `swatches` → the existing 12px swatch row (unchanged markup), `data-testid="map-widget-legend"`.
- `gradient` → a bar `data-testid="map-widget-legend-gradient"`: a `Box` with `background: linear-gradient(to right, <stop.color stop.pct%>…)` (pct = `(value-min)/(max-min)*100`), and two `Typography variant="caption"` endpoints showing `String(min)` / `String(max)`.

### 5. `apps/api/src/tools/visualize-map.tool.ts` — interpolate back-fill

In the stop back-fill loop (`:219-243`), branch on effective scale per layer:

- `cb.scale === "interpolate"` (and no explicit stops) → run `SELECT MIN(<col>) AS lo, MAX(<col>) AS hi FROM (<sql>) _q WHERE <col> IS NOT NULL`; if both finite and `hi > lo`, emit `SEQUENTIAL_PALETTE.length` anchors: anchor `i` = `[lo + (hi-lo)*i/(K-1), (cb.palette ?? SEQUENTIAL_PALETTE)[i]]`. If the column is non-numeric / null / `hi === lo`, leave stops empty (web falls back to solid).
- otherwise → existing distinct-value categorical/step back-fill (unchanged).

Tool `description` (`:30`) gains a clause: `colorBy.scale` ('categorical' | 'step' | 'interpolate'); 'interpolate' is a smooth continuous gradient for numeric columns.

### 6. `packages/core/src/registries/builtin-toolpacks.ts` — mirror

The hand-authored `visualize_map` description mirror (`:277`) gets the same `colorBy.scale` clause (kept byte-identical to the tool where the pinning test compares).

### 7. `apps/api/src/prompts/system.prompt.ts` — agent guidance

The map guidance block (`:250-262`) gains one sentence: when the user asks for a **smooth gradient / continuous shading** of a numeric measure, set `colorBy.scale: "interpolate"`; the default (banded) stays `step`.

## Migration / Seed

**No DB schema change** — `scale` is a spec field carried in block content (JSON), not a column. No migration, no seed.

## TDD test plan

### core — `packages/core/src/__tests__/contracts/map-spec.contract.test.ts`

- `scale` omitted → parses (existing specs valid). `scale: "interpolate"` / `"step"` / `"categorical"` → parse. Invalid `scale: "foo"` → parse error. (~3 cases)

### core — `packages/core/src/__tests__/constants/map-palette.constants.test.ts` (NEW)

- `SEQUENTIAL_PALETTE` is ≥2 entries, every entry a `#rrggbb`. (~1 case)

### web — `apps/web/src/modules/MapWidget/__tests__/map-config.util.test.ts`

- `scale:"interpolate"` + ≥2 numeric stops → `["interpolate",["linear"],["to-number",…],…]` wrapped in `case(has,…,UNMATCHED)`, breakpoints ascending; legend `{kind:"gradient",min,max,stops}`.
- `scale:"interpolate"` + 1 numeric stop → falls back to step/solid (no interpolate expr).
- `scale:"interpolate"` + no explicit stops, derived from rows → uses `SEQUENTIAL_PALETTE` across min→max.
- `scale:"step"` forces step even for string-coercible numeric stops; `scale:"categorical"` forces `match` even for numeric stops.
- Absent `scale` → unchanged inference (numeric→step, string→match) + legend `{kind:"swatches"}` (regression).
- `buildLegend` returns `MapLegend[]` (one per colorBy layer); a mixed spec yields both a swatches and a gradient legend. (~8 cases)

### web — `apps/web/src/modules/MapWidget/__tests__/MapWidget.test.tsx`

- Gradient legend → renders `map-widget-legend-gradient` bar with min & max labels; swatch legend still renders `map-widget-legend` (regression). (~2 cases)

### api — `apps/api/src/__tests__/tools/visualize-map.tool.test.ts`

- `colorBy.scale:"interpolate"` with a mocked `sqlQuery` returning `{lo,hi}` for the `MIN/MAX` query → `cb.stops` are `SEQUENTIAL_PALETTE.length` ascending `[value,color]` anchors from the sequential palette; the categorical `GROUP BY` query is **not** run. (~2 cases)

### api — pinning: `packages/core/src/__tests__/registries/builtin-toolpacks.test.ts` + `apps/api/src/__tests__/prompts/system.prompt.test.ts`

- Mirror stays in sync (description contains the `scale` clause); system-prompt snapshot updated for the gradient sentence. (existing tests, updated)

**Totals ≈ 17 cases** (all via `npm run test:unit` per package; no integration/DB test — the back-fill test mocks `sqlQuery`). No migration test (no schema change).

## Acceptance criteria

- "Color parcels by market value **with a smooth gradient**" → a continuous blend; "…by market value" (default) → discrete bands, unchanged.
- Works on any numeric column / dataset / geometry type; null/absent → no-data color, **never black**.
- The legend shows a **continuous ramp** (bar + min/max) for interpolate; swatches for match/step.
- `<2` numeric stops for interpolate degrades gracefully (step/solid), never a broken expression.
- Existing categorical + banded specs render identically (no regression).
- Applies to aggregate (tiled) layers, coloring the bin's `mode()` value.

## Risks & rollback

- **A raw `interpolate` throws on null input → whole layer paints black.** Detected by the null-guard test; mitigated by the `case(has,…)` + `to-number` coercion carried from `step`. Fail-safe: no-data color, never black.
- **Legend return-type change ripples** to `layerToMapLibre`, `buildLegend`, the `MapWidget` memo + render, and the barrel. Compile-time caught (TS); the discriminated switch is exhaustive.
- **Sequential palette drift** between web and api — eliminated by the single core export (no copy).
- **Rollback:** the feature is gated by `scale === "interpolate"`; reverting the branch leaves match/step untouched. No data written, nothing to un-migrate.

## Files touched

- New: `packages/core/src/constants/map-palette.constants.ts`; `packages/core/src/__tests__/constants/map-palette.constants.test.ts`.
- Edit: `packages/core/src/contracts/map-spec.contract.ts`; `packages/core/src/constants/index.ts`; `packages/core/src/__tests__/contracts/map-spec.contract.test.ts`; `packages/core/src/registries/builtin-toolpacks.ts`; `packages/core/src/__tests__/registries/builtin-toolpacks.test.ts`.
- Edit: `apps/web/src/modules/MapWidget/utils/map-config.util.ts`; `apps/web/src/modules/MapWidget/MapWidget.component.tsx`; `apps/web/src/modules/MapWidget/index.ts`; `apps/web/src/modules/MapWidget/__tests__/map-config.util.test.ts`; `apps/web/src/modules/MapWidget/__tests__/MapWidget.test.tsx`.
- Edit: `apps/api/src/tools/visualize-map.tool.ts`; `apps/api/src/__tests__/tools/visualize-map.tool.test.ts`; `apps/api/src/prompts/system.prompt.ts`; `apps/api/src/__tests__/prompts/system.prompt.test.ts`.

## Next step

Write `docs/SMOOTH_GRADIENT_COLORBY.plan.md` — ~5 TDD slices: **(1)** core `scale` field + `SEQUENTIAL_PALETTE` (+ contract/palette tests); **(2)** `resolveColorBy` interpolate branch + scale-forced resolution (map-config tests); **(3)** discriminated legend type + gradient render (map-config + MapWidget tests); **(4)** api back-fill `MIN/MAX` (visualize-map test); **(5)** agent surfaces + doc-sync (pinning tests). Each green-testable, landing as commits on `feat/smooth-gradient-colorby`, PR into `epic/gis-toolpack`.
