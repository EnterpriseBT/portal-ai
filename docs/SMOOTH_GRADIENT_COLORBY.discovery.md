# Smooth-gradient (interpolate) colorBy mode — Discovery

**Issue:** [EnterpriseBT/portal-ai#336](https://github.com/EnterpriseBT/portal-ai/issues/336) (epic [#84](https://github.com/EnterpriseBT/portal-ai/issues/84))

**Why this exists.** `colorBy` today has two render modes — `match` (categorical/discrete) and `step` (numeric → discrete **bands**, added #330/#335, made correct for numeric-string stops in #346). There is no **smooth continuous gradient**: a color that blends across the value range via MapLibre `["interpolate", ["linear"], …]`. Users want a true graduated gradient for continuous measures (market value, acreage, density, temperature) alongside discrete bands. This is the third colorBy scale — the one that renders a *continuous blend* and a gradient-bar legend, chosen explicitly by the agent, back-compatible with every existing spec.

## The current shape

### Contract (`packages/core`)

| Piece | Location | Note |
|---|---|---|
| `MapLayerStyleSchema.colorBy` | `packages/core/src/contracts/map-spec.contract.ts:74-83` | `{ column, palette?, stops? }` — **no `scale` field.** `stops` is `[value, color][]` where value is `string \| number`. |
| Aggregation treatment (adjacent field) | `map-spec.contract.ts:105-116` | `treatment: "bins" \| "none"` (#337) — the pattern to mirror for an optional agent-driven enum. |

### Web render (`apps/web`)

| Piece | Location | Note |
|---|---|---|
| `resolveColorBy` | `apps/web/src/modules/MapWidget/utils/map-config.util.ts:194-273` | Returns `{ expression, legend }`. Picks `step` when **every** stop coerces to a finite number (`graduated`, `:237`), else categorical `match` (`:264`). Both wrap the input and fall back to `UNMATCHED_COLOR` (`:154`) for no-data. |
| `step` build + null-guard | `map-config.util.ts:238-262` | `["case", ["has", col], ["step", ["to-number", ["get", col], 0], base, brk, c, …], UNMATCHED_COLOR]`. The `to-number` coercion is load-bearing — `step`/`interpolate` **throw** on a null input, blacking the whole layer. |
| Palettes | `map-config.util.ts:139-153` | `DEFAULT_PALETTE` = Tableau-10 (**categorical**, not perceptually ordered); `DEFAULT_COLOR`. No sequential ramp exists. |
| `LegendEntry` + render | `map-config.util.ts:184-187`; `MapWidget.component.tsx:436-458` | `{ label, color }[]` → a row of 12px swatches. **Cannot express a continuous bar.** |
| `buildLegend` / `layerToMapLibre` | `map-config.util.ts:432-438`, `:295-310` | `layerToMapLibre` calls `resolveColorBy` and returns its `legend`; `buildLegend` concatenates per layer. Any legend-shape change ripples here. |
| existing `interpolate` precedent | `map-config.util.ts:416` | The heatmap layer already emits an `["interpolate", …]` — the expression form is proven in-file. |

### Agent surfaces (`apps/api` + core mirror)

| Piece | Location | Note |
|---|---|---|
| Server stop back-fill | `apps/api/src/tools/visualize-map.tool.ts:215-243` | For a `colorBy` without stops, runs `SELECT <col> … GROUP BY <col> ORDER BY count(*) DESC` and zips **distinct values** with `categoryColor(i)`. This is the categorical/step path — **wrong for a gradient** (one anchor per distinct value, categorical colors). |
| Tool description | `visualize-map.tool.ts:30`, mirror `packages/core/src/registries/builtin-toolpacks.ts:277` | Hand-authored mirror must stay in sync (pinning test). Neither mentions gradient/scale. |
| System prompt map guidance | `apps/api/src/prompts/system.prompt.ts:250-262` | Tells the agent to reach for `visualize_map` + that `colorBy` draws a legend; no gradient guidance. |

## The design space

### Decision 1 — how `interpolate` is selected

Per the ticket: add `colorBy.scale?: "categorical" | "step" | "interpolate"` (optional). **Absent ⇒ inferred** exactly as today (string stops → categorical, numeric → step) — back-compatible with every existing spec. `"interpolate"` opts into the smooth mode; `"categorical"`/`"step"` let the agent *force* a mode against the inference. **Lean: additive optional enum, mirroring `aggregation.treatment` (#337)** — the inference stays the default so no existing spec changes behavior.

### Decision 2 — how interpolate anchors + colors are generated (the real decision)

A smooth gradient needs a *small ordered ramp*, not one anchor per distinct value. The server back-fill (`:215-243`) currently emits categorical distinct-value stops.

- **A. Two anchors (min, max)** mapped to a sequential palette's endpoints → a single blend.
- **B. K even-linear anchors** between `min` and `max`, mapped to a K-color sequential palette → a smooth multi-hue ramp (`interpolate linear` blends between them).
- **C. Quantile breaks** (handles skew) mapped to the sequential palette.

| | A (min/max) | B (even-linear × K) | C (quantile) |
|---|---|---|---|
| Multi-hue perceptual ramp | No (2 colors) | Yes | Yes |
| Robust to skew | No | No | Yes |
| Back-fill query | `MIN/MAX` | `MIN/MAX` | `percentile_cont` |
| Complexity | Lowest | Low | Adds a break-count axis |

**Lean: B.** Compute `MIN(col)`/`MAX(col)` server-side and distribute the sequential palette linearly across `[min, max]` (anchor `i` at `min + (max-min)·i/(K-1)`). Smooth, dataset-agnostic, one cheap indexed aggregate. Quantile (C) is the better skew story but adds a design axis (which/how-many quantiles) — deferred to an open question.

### Decision 3 — the sequential palette

Tableau-10 (`DEFAULT_PALETTE`) is categorical — using it for a gradient produces a non-monotonic, misleading ramp. **Lean: add a `SEQUENTIAL_PALETTE` constant** (a colorblind-safe ordered ramp, viridis-like) as the interpolate default; `colorBy.palette` still overrides when the agent supplies one. Keeps categorical specs on Tableau-10 untouched.

### Decision 4 — the legend shape

`LegendEntry { label, color }[]` can only draw swatches. A gradient needs a bar with min/max endpoints.

- **A. Discriminated legend** — `resolveColorBy`/`buildLegend` return `{ kind: "swatches", entries } | { kind: "gradient", stops, min, max }`; the widget renders a CSS `linear-gradient` bar for the gradient kind.
- **B. Keep `LegendEntry[]`, add a sibling `gradient?` descriptor** returned alongside.

| | A (discriminated) | B (sibling field) |
|---|---|---|
| Type clarity | One shape, exhaustive switch | Two optional fields, ambiguous when both set |
| Render-site change | One switch in `MapWidget` legend block | Same, plus null-checks |
| Ripple | `buildLegend` + `layerToMapLibre` return types | Same |

**Lean: A.** A discriminated legend is the honest model (a layer's legend is *either* swatches or a bar) and gives the render site an exhaustive switch. `buildLegend` becomes "the legends for all layers" — a map may mix a categorical layer and a gradient layer, so the return is a list of discriminated legends.

### Decision 5 — aggregate (tiled) layers

The ticket dictates: aggregate bins interpolate on the cell's `mode()` value. The tile path has no inline rows, so stops are back-filled server-side (same seam as `:215-243`). **Lean: reuse the same `MIN/MAX` back-fill for interpolate on both raw and aggregate layers** — the aggregate bin already carries a numeric value; interpolate colors it with the identical expression. No tile-SQL change beyond ensuring the colored value column is numeric.

## Tradeoff comparison

| | D1: optional enum | D2: even-linear ramp | D3: sequential palette | D4: discriminated legend | D5: reuse back-fill |
|---|---|---|---|---|---|
| Contract change | Yes (additive) | No | No (new const) | No | No |
| Back-compat | Full | — | Full | Full (new kind) | Full |
| Spread to spec | Yes | Yes | Yes | Yes | Yes |

## Recommendation

1. Add `colorBy.scale?: "categorical" | "step" | "interpolate"` to `MapLayerStyleSchema` (optional; absent ⇒ current inference). (D1)
2. In `resolveColorBy`, when `scale === "interpolate"` and ≥2 numeric stops resolve, emit `["case", ["has", col], ["interpolate", ["linear"], ["to-number", ["get", col], 0], v0, c0, …], UNMATCHED_COLOR]` over sorted numeric stops; **<2 stops → fall back to step/solid** (never a broken expression). (D2, ticket)
3. Add a `SEQUENTIAL_PALETTE` and, in the server back-fill, generate interpolate anchors from `MIN/MAX` distributed across the sequential palette (raw + aggregate). (D2, D3, D5)
4. Change the legend to a discriminated `{ kind: "swatches" | "gradient" }` shape; render a CSS gradient bar with min/max labels for `gradient`. (D4)
5. Update the three agent surfaces — `visualize_map` description + the `builtin-toolpacks.ts` mirror + `system.prompt.ts` — so the agent picks `interpolate` for "…with a smooth gradient" (doc-sync per CLAUDE.md). (ticket)

## Open questions

1. **Even-linear vs quantile breaks.** Skewed data (a few very-high market values) washes an even-linear ramp toward one end. **Lean: even-linear for this ticket**; a `scale: "interpolate-quantile"` (or a `breaks` hint) is a clean follow-up if smoke shows washout — not worth the extra design axis now.
2. **Sequential palette identity.** Single-hue (light→dark blue) vs multi-hue (viridis-like). **Lean: a colorblind-safe multi-hue ramp** — reads as a gradient at a glance and stays legible for the common "value" case.
3. **Gradient legend labels.** Just min/max endpoints, or intermediate ticks too? **Lean: min + max labels under the bar** (matching the two data anchors that matter); intermediate ticks add clutter for little gain.
4. **Number formatting on the bar.** Large market values ("1309050") are noisy. **Lean: reuse the existing legend label stringification for now**; compact formatting (`1.3M`) is a cosmetic follow-up, not a blocker.

## Enterprise-scale considerations

- **Concurrency & correctness.** N/A because the change is a pure rendering mode plus one extra `MIN/MAX` in the existing back-fill; no shared state, no check-then-act.
- **Accuracy & auditability.** N/A because nothing is metered or persisted — colorBy is presentation.
- **Failure modes.** The null-guard (`case(has, …)` + `to-number` coercion) is the fail-safe carried from `step`: null/absent → no-data color, **never black**; <2 numeric stops → graceful fall back to step/solid. Explicitly re-asserted for interpolate (a raw `interpolate` throws on null just like `step`).
- **Scale & unbounded growth.** The back-fill adds one `MIN/MAX(col)` aggregate (indexed, O(1)-ish) per interpolate layer — strictly cheaper than the current `GROUP BY` distinct-value scan. No new fan-out.
- **Multi-tenancy.** N/A because there is no per-tenant state or budget touched; the back-fill runs in the same station/org context as today.
- **Contract stability.** `scale` is additive-optional and inference-defaulted, so every existing MapSpec is untouched; a future `interpolate-quantile` slots in as another enum value without re-plumbing call sites.
- **Data lifecycle.** N/A because no windows/periods/retention are involved.

## What this doesn't decide

- **Quantile / skew-aware breaks** — deferred (open question 1); even-linear ships first.
- **Compact number formatting on the legend bar** — cosmetic follow-up (open question 4).
- **A per-widget UI control to switch scale** — that was the deleted #338 (in-map settings); the agent chooses `scale` via the spec, not the user via a control.
- **Changing categorical/step behavior** — untouched; interpolate is purely additive.

## Next step

Write `docs/SMOOTH_GRADIENT_COLORBY.spec.md` (contract: the `scale` enum on `MapLayerStyleSchema`; the discriminated legend type; `resolveColorBy`'s interpolate branch signature + fallback; the `SEQUENTIAL_PALETTE`; the back-fill `MIN/MAX` query; the three agent-surface edits) and `.plan.md` (TDD slices). The plan will likely slice as: **(1)** contract `scale` field + inference-preserving parse; **(2)** `resolveColorBy` interpolate branch + `SEQUENTIAL_PALETTE` (unit-tested against the expression shape + fallback); **(3)** discriminated legend + gradient-bar render; **(4)** server back-fill `MIN/MAX` for raw + aggregate; **(5)** agent surfaces + doc-sync. Each green-testable, landing as commits on `feat/smooth-gradient-colorby`, PR into `epic/gis-toolpack`.
