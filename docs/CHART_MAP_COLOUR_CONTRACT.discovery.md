# Chart and map colour contract — Discovery

**Issue:** [EnterpriseBT/portal-ai#1022](https://github.com/EnterpriseBT/portal-ai/issues/1022) · Bug · **full**. Child of epic #791 (found by #800); branch `fix/1022-chart-map-colour-contract` → `epic/a11y-conformance`.

**Why this exists.** Agent-generated charts (`visualize_d3`) and maps (`visualize_map`) can tell categories apart by colour alone (WCAG 1.4.1, A), and nothing holds their lines, bars, markers and map features at 3:1 against what they're drawn on (1.4.11, AA). #796 made the data available as text (summary, "Show data", "Features in view"), so nothing is lost, but the graphic itself isn't held to either criterion. The ACR lists both as Partially Supports, citing this issue.

The survey corrects the issue's premise in one way. The chart iframe **already receives a palette**, `api.theme.categorical`, and the codegen prompt tells the program to use it. But that palette is the theme's six status colours, two of which are the same blue, and red and green sit side by side. Nothing stops a program from ignoring it, and nothing asks for a second cue. Maps use a server-chosen Tableau 10 plus HSL palette that ignores the theme entirely. This is the contract that gives agent graphics a checked palette and a non-colour cue, enforced where the code can enforce it.

## The current shape

### Charts (`visualize_d3`)

| Piece | Location | Note |
|---|---|---|
| Tool input + description | `apps/api/src/tools/visualize-d3.tool.ts:25-43, 110-111` | `sql`, `instruction`, `title?`, required `summary` ("don't describe colours"). No colour rule |
| Codegen | `visualize-d3.tool.ts:153-161`; `apps/api/src/prompts/visualize-d3.prompt.ts:15-80` | A separate model call writes the program. Its prompt documents `api.theme { mode, background, text, fontFamily, monospaceFontFamily, categorical[] }`, says "use api.theme.categorical for series colors" (:25-26) and asks for legend room (:48-55). **A fourth tool surface** |
| Validation | `apps/api/src/tools/visualize-d3.validate.ts` | `validateProgram` only checks the program parses; 3 attempts, then a `data-table` fallback (`visualize-d3.tool.ts:203-213`) |
| Mirror + agent prompt | `packages/core/src/registries/builtin-toolpacks.ts:238-266`; `apps/api/src/prompts/system.prompt.ts:286-322` | No colour or labelling rule in either |
| Theme into the iframe | `apps/web/src/modules/D3Widget/utils/sandbox-theme.util.ts:23-42`; `D3Widget.component.tsx:237-238`; `D3SandboxFrame.component.tsx:183-189` | `categorical = [primary, secondary, success, warning, error, info].main`. Secondary and info are both `#185fa5` (light) / `#4a8fd4` (dark). `background` is `background.default`, but the chart is drawn on the figure's outlined `Paper` (`components/VisualFigure.component.tsx:28-85`). Sent live on a theme switch |
| Sandbox | `D3Widget/utils/sandbox-srcdoc.util.ts:73-107`, `sandbox-bootstrap.js:195-257` | Static srcdoc, no-network CSP, `render({d3, container, data, params, theme, width, height})`; re-renders on a `theme` message |
| Stored block | `packages/core/src/contracts/d3-widget.contract.ts:45-87` | Stores the `program`; refresh (`apps/api/src/services/portal-viz-refresh.service.ts`) re-runs only the SQL. An old program that reads `api.theme` picks up a new palette; one with hex literals keeps them |

### Maps (`visualize_map`)

| Piece | Location | Note |
|---|---|---|
| Server palette | `apps/api/src/tools/visualize-map.tool.ts:65-102` | `categoryColor(i)`: Tableau 10, then golden-angle HSL (s 0.62, l 0.55). Unchecked |
| Back-fill | `visualize-map.tool.ts:238-296` | With no `stops`, a categorical `colorBy` gets `[value, categoryColor(i)]` per `GROUP BY` value (ignores `cb.palette`); interpolate spreads `SEQUENTIAL_PALETTE` (viridis, `packages/core/src/constants/map-palette.constants.ts`) |
| Spec | `packages/core/src/contracts/map-spec.contract.ts:21-24, 70-87, 196-250` | `colorBy {column, palette?, stops?, scale?}`; basemap `carto-light \| carto-dark \| osm \| {url}`. Stops are stored inside the block |
| Paint | `apps/web/src/modules/MapWidget/utils/map-config.util.ts:166-208, 236-375, 402-404` | `resolveColorBy` → `match`/`step`/`interpolate`; its own Tableau 10 copy; fills translucent (0.4 raw, 0.35 bins); the selection ring is `#000` whatever the basemap |
| Basemap | `map-config.util.ts:654-657, 684-704, 735-752` | CARTO follows the theme (Positron / Dark Matter); `none` is a flat `#ffffff` / `#0f0f1f`; OSM and `{url}` are as given |
| Legend | `map-config.util.ts:604`; `MapWidget.component.tsx:810-873` | Swatches + caption, or a gradient with min/max. No heading naming the column; swatches unbordered |
| Feature list | `MapWidget/MapFeatureList.component.tsx` | Labels only; no category value |

### Palettes and the contrast test

- The themes (`packages/core/src/assets/themes/brand-theme.json`, `brand-theme-dark.json`) have **no data-visualisation palette**.
- `packages/core/src/__tests__/ui/theme-contrast.test.ts` holds text, the status mains (≥4.5:1), the focus ring (≥3:1) and the sheet tints for every theme in `THEME_MAP`, with MUI's `getContrastRatio` and a local `composite`. So today's six chart colours pass 3:1 against both backgrounds. What fails is distinctness (a duplicate, a red/green pair) and the absence of any second cue.
- Pinning tests: `sandbox-theme.util.test.ts` (exactly the six mains), `visualize-d3.prompt.test.ts`, `visualize-map.tool.test.ts`, `map-config.util.test.ts`, `MapWidget.test.tsx`, `builtin-toolpacks.test.ts`, `system.prompt.test.ts`.

## The design space

### Decision 1 — where the palette lives

- **A. A `dataViz` palette in both theme JSONs**: categorical (8 colours) and sequential, with values per theme, held by `theme-contrast.test.ts`.
- **B. Keep the status mains, de-duplicated.** Swap `info` for another status colour.
- **C. A constant in core** (e.g. Okabe-Ito), adjusted per mode in code.

| | A | B | C |
|---|---|---|---|
| Follows "styling lives in the theme" | Yes | Yes | No, a second colour source |
| Enough colours | 8, chosen for the job | 5 distinct | 8 |
| Status meaning leaks into data (red = bad) | No | Yes | No |
| Held by the existing contrast test | Yes, one more block | Already | Needs its own test |

**Lean: A.** A chart's series aren't statuses. A theme-owned palette is the one place both the chart iframe and the map can read, per theme, and the contrast test already iterates `THEME_MAP`.

### Decision 2 — how a chart is held to the palette and a second cue

The program is model-written code, so the options are about where enforcement sits.

- **A. Prompt only.** The codegen prompt says: colours only from `api.theme.categorical`, and with two or more series, a second cue (direct labels at the series ends, or a varied dash or marker from new `api.theme.dashes` / `api.theme.symbols`), plus a text legend.
- **B. A + a static check.** `validateProgram` also rejects a colour literal (hex, `rgb(`/`hsl(`, CSS named colours in `fill`/`stroke`/`style` calls, `d3.scheme*`/`interpolate*`). A rejection goes back to the codegen as the attempt's error, inside the existing 3-attempt loop.
- **C. B + a render audit.** The sandbox walks the rendered SVG after `render`, collects mark fills and strokes, and reports any colour outside the palette (or under 3:1 against the frame) to the host, which logs it.

| | A | B | C |
|---|---|---|---|
| Stops an off-palette chart | No | Yes, at generation | Detects; at render |
| False positives | None | A literal in a comment or string (fixable: match call sites, not text) | Text, gridlines, axes (needs an allowlist) |
| Covers the second cue | Prompt | Prompt | Heuristic only |
| Cost | Prompt tokens | A regex pass, maybe a retry | Bootstrap code + a message type |

**Lean: B.** Colour is the half code can check, so it's checked; the static pass is cheap and uses the retry loop that already exists. The second cue stays a prompt rule, since there's no reliable static test for "labelled directly", and #796's text alternatives back it up. C is worth it later only if B's logs show programs slipping through.

### Decision 3 — what a chart is drawn on

The sandbox sends `background.default`, but the figure is an outlined `Paper`.

**Lean: send `background.paper`** (and give the iframe document that background), so the contrast the test checks is the contrast the user sees. No real alternative.

### Decision 4 — who colours a categorical map

- **A. The server, from a fixed accessible palette** (as now, with better colours). It can't know the viewer's theme, so one palette must clear 3:1 on Positron, Dark Matter and both flat backgrounds at once.
- **B. The web, from the theme's `dataViz` palette.** The server stores the category values in order; the web assigns colours when it draws, per theme. Stored blocks whose stops carry hex colours are re-coloured by their order the same way.
- **C. B, but keep agent-chosen colours** when the agent supplied `stops` itself.

| | A | B | C |
|---|---|---|---|
| Per-theme contrast | One palette for all basemaps (hard at 3:1 for 8 colours) | Yes | Only for back-filled stops |
| Old maps fixed | No | Yes, by order | Partly |
| Agent semantic colours ("red = overdue") | Lost | Lost | Kept, unchecked |
| Contract change | None | `colorBy` stops may omit the colour | Same as B |

**Lean: B.** The theme is a viewer-side fact, so colour is a render-time decision. Agent-chosen hex for a categorical layer is dropped: an unchecked colour is what this ticket removes, and the category's meaning is in its label and the legend. Interpolate scales keep viridis, which is already perceptually ordered; the gradient legend gets its min and max text.

### Decision 5 — non-colour cues and contrast on a map

A translucent fill (0.35–0.4) can't reach 3:1 against a basemap, and 1.4.1 needs something besides hue.

- **Outline at 3:1:** each feature gets a stroke in its category colour, adjusted per theme to clear 3:1 against the basemap's background. Fills stay translucent. The selection ring follows the theme (dark ring on light basemaps, light on dark).
- **Second cue:**
  - **Legend:** a heading names the `colorBy` column, every swatch has a 3:1 border and a text label.
  - **Feature list:** "Features in view" shows each feature's category value next to its label.
  - **Points:** markers vary by shape per category (MapLibre symbol icons) for up to the palette's size.

**Lean: all three of these**: outline, legend text, feature-list category. Point shapes too, since they're cheap in a symbol layer. Fill patterns for polygons are rejected: they need sprite assets, and they fight the translucent fills.

## Tradeoff comparison

| | D1: theme `dataViz` | D2: static check | D3: paper background | D4: web colours maps | D5: outline + legend + list |
|---|---|---|---|---|---|
| Packages | core | api | web | api, core, web | web |
| Contract change | Theme type | None (stricter validation) | Sandbox theme shape | `colorBy.stops` colour optional | None |
| Touches stored blocks | Old programs that read `api.theme` | No | Yes, all charts | Yes, all categorical maps | Yes |
| Spread to spec | Yes | Yes | Yes | Yes | Yes |

## Recommendation

1. Add `palette.dataViz { categorical: string[8], sequential: string[] }` to both theme JSONs and core's theme type. `theme-contrast.test.ts` holds each categorical colour at ≥3:1 against `background.default` and `background.paper`, and the eight as distinct.
2. `buildSandboxTheme` sends `dataViz.categorical` as `categorical`, `background.paper` as `background`, and new `dashes` and `symbols` arrays. The sandbox document takes that background.
3. The codegen prompt requires palette colours only, and, with two or more series, direct labels or a dash or marker per series, plus a text legend. The three agent-facing surfaces (`visualize-d3.tool.ts`, `builtin-toolpacks.ts`, `system.prompt.ts`) say the same in one line each.
4. `validateProgram` rejects colour literals and d3 colour schemes in mark styling, and the rejection is fed back as that attempt's error.
5. A categorical `colorBy` stores its category values in order, without colours. The web colours them from the theme's palette, ignoring any stored hex, and old maps are re-coloured by order. `categoryColor` and the web's Tableau 10 copy go.
6. Map features get a 3:1 outline per theme. The selection ring follows the theme. The legend gets a heading naming the column, bordered swatches and text labels. "Features in view" shows the category value. Point layers vary marker shape by category.
7. The ACR's 1.4.1 and 1.4.11 rows move to Supports for charts and maps drawn after this change. The remark names what isn't covered: OSM and custom basemaps, and pre-fix charts whose programs hard-coded colours.

## Open questions

1. **More categories than the palette has (8).** A map today gives every category a colour, without a cap. **Lean:** the first 8 get palette colours and shapes. Past 8, the rest share a neutral "other" style, and the legend says "+N more categories, listed under Features in view". Hue can't carry a 9th category accessibly anyway.
2. **Pre-fix charts with hard-coded colours.** Their stored program keeps its hex. **Lean:** don't rewrite stored programs. The chart's figure keeps its summary and "Show data", and the ACR remark scopes Supports to charts made after the fix. Regenerating a pinned chart is already possible by asking again.
3. **The second cue for a single-series chart.** A one-line or one-bar-colour chart has nothing to tell apart. **Lean:** the rule applies only from two series up. A single series needs only the 3:1 colour.
4. **OSM raster and custom basemaps.** Their colours are unknown, so no palette can be checked against them. **Lean:** use the light-mode adjustment for OSM (a light raster). For a custom basemap, outline against both and pick the higher contrast. The ACR names both as unverified.

## Enterprise-scale considerations

- **Concurrency & correctness:** N/A because nothing here shares state: colour is computed per render from the viewer's theme.
- **Accuracy & auditability:** Lean: log each colour-literal rejection (tool, attempt, matched literal) at info. That's the evidence for whether D2-C is ever needed. No durable record is warranted.
- **Failure modes:** Lean: fail toward the fallback that already exists. A program that keeps failing the colour check after 3 attempts becomes the data table, as a parse failure does today. The colour check never blocks a refresh of a stored chart.
- **Scale & unbounded growth:** Lean: the 8-colour cap (open question 1) also bounds the map's paint expression, which today grows with every category.
- **Multi-tenancy:** N/A because the palette is per theme, not per org. A per-org brand palette would plug into the same `dataViz` key later.
- **Contract stability:** Lean: `colorBy.stops` with an optional colour is additive. Old blocks still parse, and the web ignores their colours. `api.theme` gains fields and keeps existing ones, so old programs still run.
- **Data lifecycle:** N/A because no data is retained or windowed. Stored blocks are re-coloured at render, never rewritten.

## What this doesn't decide

- A render-time colour audit inside the sandbox (D2-C). It's deferred until the rejection logs show a need.
- Per-org brand palettes. The theme key leaves room for them, but nobody has asked.
- Text contrast inside a chart (axis labels, annotations) beyond using `api.theme.text`. 1.4.3 covers that through the palette the program is told to use.
- Fill patterns for polygons. They need sprite assets, for little gain over outline plus legend plus feature list.

## Next step

`docs/CHART_MAP_COLOUR_CONTRACT.spec.md` sets out the contract: the theme `dataViz` shape, the sandbox `api.theme` additions, the static-check rules, and `colorBy` without colours. `docs/CHART_MAP_COLOUR_CONTRACT.plan.md` slices the work roughly as follows:
1. Core palette and contrast test.
2. Chart sandbox theme and paper background.
3. Codegen prompt, colour check and the three agent-facing surfaces.
4. Map colouring moves to the web, with stored-stop handling.
5. Map outline, legend, feature list and point shapes.
6. ACR and audit rows.
