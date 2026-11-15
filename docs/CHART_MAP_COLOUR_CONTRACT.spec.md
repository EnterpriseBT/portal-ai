# Chart and map colour contract — Spec

Pins the contract that holds agent-generated charts and maps to WCAG 1.4.1 and 1.4.11: a theme-owned data-visualisation palette, what the chart sandbox receives, the colour check on generated chart programs, and who colours a categorical map. Builds on [`CHART_MAP_COLOUR_CONTRACT.discovery.md`](CHART_MAP_COLOUR_CONTRACT.discovery.md); issue [#1022](https://github.com/EnterpriseBT/portal-ai/issues/1022).

## Key decisions (flag for review)

1. **The palette is the theme's.** Both theme JSONs gain `palette.dataViz { categorical: 8 colours, other }`. `theme-contrast.test.ts` holds each against both theme backgrounds and the two CARTO basemaps at ≥3:1, and holds the eight as visibly distinct.
2. **Charts are checked for colour, prompted for the second cue.** `validateProgram` rejects colour literals and d3's colour schemes and interpolators. A rejection is that attempt's error inside the existing 3-attempt loop, and the data-table fallback is unchanged. The second cue (direct labels or a dash or marker per series, from two series up, plus a text legend) is a codegen-prompt rule, not checked.
3. **The chart is measured against what it's drawn on.** The sandbox gets `background.paper`, and its document paints that background.
4. **The web colours categorical maps.** The server back-fills an ordered `colorBy.categories` list with no colours. The web assigns `dataViz.categorical` by order for the viewer's theme. Any colours stored in a categorical or step `stops` (old blocks, or ones the agent wrote) are ignored, and their values recoloured by order. Interpolate keeps its ramp.
5. **Eight categories, then "other".** Categories past the eighth share `dataViz.other`. The legend says "+N more" and points to "Features in view", which already names each feature's category (`rendered-features.util.ts:127-134`).
6. **Map contrast comes from the outline.** Fills stay translucent. Polygons and lines get a full-opacity outline in their category colour, and points a full-opacity fill, each ≥3:1 against the basemap by decision 1. The selection ring already follows the theme (`MapWidget.component.tsx:234`); no change.
7. **Not in this change:**
   - **Point marker shapes per category:** discovery leaned yes, but MapLibre circle layers can't vary shape. It would take generated sprite images and turning point layers into symbol layers (radius, selection ring, hit-testing), for a cue the legend text and the feature list already give.
   - **A render-time colour audit in the sandbox:** deferred until the rejection logs show programs slipping through.
8. **Old blocks aren't rewritten.**
   - Maps recolour at render, from their stored values.
   - A stored chart program that reads `api.theme.categorical` gets the new palette.
   - A program that hard-codes hex colours keeps them, and the ACR remark says so.

## Scope

### In scope
- `packages/core`:
  - The `dataViz` palette in both themes, plus its type and contrast test.
  - `colorBy.categories` in the map spec.
- `apps/api`:
  - The colour check and its log line.
  - The codegen prompt, the `visualize_d3` and `visualize_map` descriptions and the system prompt.
  - The map back-fill writes `categories`; `categoryColor` is removed.
- `apps/web`:
  - The sandbox theme and its paper background.
  - Map colouring from the theme, the outline paint, the "other" bucket.
  - A legend heading and bordered swatches.
- `docs`: the ACR's 1.4.1, 1.4.3 and 1.4.11 rows and the evaluated-build note, plus the audit's new walk row.

### Out of scope
- Point marker shapes, polygon fill patterns, the sandbox render audit, and per-org palettes.
- Rewriting stored chart programs.
- Contrast against OSM and custom basemaps. Their colours are unknown, and the ACR names them.
- The interpolate ramp: `SEQUENTIAL_PALETTE` (viridis) is already perceptually ordered.

## Surface

### 1. Theme palette — `packages/core`

`packages/core/src/types/theme.ts`, beside `SheetPalette` / `CodePalette`:
```ts
/** Colours for data a chart or map draws (#1022). Not status colours. */
export interface DataVizPalette {
  /** Eight category colours, in assignment order. Each ≥3:1 against both
   *  theme backgrounds and the theme's CARTO basemap. A plain array: the
   *  theme JSONs infer `string[]`, so the test holds the count to eight. */
  categorical: string[];
  /** Categories past the eighth, and the "+N more" legend swatch. */
  other: string;
}
declare module "@mui/material/styles" {
  interface Palette { dataViz: DataVizPalette }        // + sheet, code
  interface PaletteOptions { dataViz?: DataVizPalette }
}
```
`brand-theme.json` and `brand-theme-dark.json` gain `palette.dataViz`. Starting values; the test decides:
- light: `#1f6fb2 #c4580a #2e7d32 #b8326a #6f4bb0 #8a6d00 #00798c #a03a2c`, other `#6b7280`
- dark: `#6cb4ee #f5a35c #6fcf7a #f07fb0 #b99af0 #e6c84f #4fd1d9 #f28b78`, other `#9ca3af`

`packages/core/src/constants/map-palette.constants.ts` gains the backgrounds the palette is measured against:
```ts
/** The land colour of each CARTO basemap the map uses per theme, read from
 *  the style JSON (Positron `background`, Dark Matter `background`). */
export const BASEMAP_BACKGROUND = { light: "#fafaf8", dark: "#0e0e0e" } as const;
```
(Read from each style JSON's `background` layer on 2026-11-15; the constant's comment carries the source URLs. The starting palette passed unchanged: ≥4.2:1 light, ≥7:1 dark, closest pair ΔE 25.8.)

### 2. Chart sandbox — `apps/web/src/modules/D3Widget`

`utils/sandbox-theme.util.ts`:
```ts
export interface D3SandboxTheme {
  mode: "light" | "dark";
  /** The figure's surface (`background.paper`), which the frame paints. */
  background: string;
  text: string;
  fontFamily: string;
  monospaceFontFamily: string;
  /** `palette.dataViz.categorical`: the only colours a series may use. */
  categorical: string[];
  /** stroke-dasharray values to tell lines apart; [0] is solid ("none"). */
  dashes: string[];   // ["none", "6 3", "2 3", "8 3 2 3", "1 3", "12 4"]
  /** d3 symbol names to tell markers apart (`api.d3[name]`). */
  symbols: string[];  // ["symbolCircle", "symbolSquare", "symbolTriangle",
                      //  "symbolDiamond", "symbolCross", "symbolStar", "symbolWye"]
}
```
- `buildSandboxTheme(theme)` fills `background` from `palette.background.paper` and `categorical` from `palette.dataViz.categorical`. `dashes` and `symbols` are constants in the same file (`SANDBOX_DASHES`, `SANDBOX_SYMBOLS`).
- `utils/sandbox-bootstrap.js` sets `document.body.style.background = theme.background` on `init` and on every `theme` message, before `render`.

### 3. Chart program check — `apps/api/src/tools/visualize-d3.validate.ts`

```ts
/** A colour a chart program wrote itself instead of reading `api.theme` (#1022). */
export interface ColourLiteral { literal: string; line: number }

/** Colour literals and d3 colour helpers in a program, comments ignored. */
export function findColourLiterals(src: string): ColourLiteral[];

export type ValidateResult =
  | { ok: true }
  | { ok: false; error: string; colour?: ColourLiteral }; // colour: set on a colour rejection

export function validateProgram(src: string): ValidateResult; // parse, then colours
```
`findColourLiterals` blanks `//` and `/* */` comments, reads every string literal (a template's `${…}` expressions are scanned as code, not string), then matches, in order of appearance:
- a hex colour (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`) that is a whole string, or follows `:`, `(` or `,` inside one (`"fill:#fff"`, a gradient). Elsewhere a `#` is text: "Order #1234" passes;
- `rgb(`, `rgba(`, `hsl(`, `hsla(` inside a string;
- `d3.scheme<Name>` or `api.d3.scheme<Name>` in code;
- a colour interpolator in code: `d3.interpolate<Name>` (or `api.d3.…`) that isn't in the non-colour allowlist below;
- a string whose whole content is a CSS named colour, wherever it's used (an attr value, a ternary branch, an array). `none`, `transparent`, `currentColor` and `inherit` aren't colour names here, so they pass.

The non-colour interpolator allowlist (`NON_COLOUR_INTERPOLATORS`) is `interpolateNumber`, `interpolateRound`, `interpolateString`, `interpolateDate`, `interpolateArray`, `interpolateNumberArray`, `interpolateObject`, `interpolateTransformCss`, `interpolateTransformSvg`, `interpolateZoom`, `interpolateDiscrete`, `interpolateBasis`, `interpolateBasisClosed` and `interpolate`.

`validateProgram` returns `{ ok: false, error }` for the first literal found, with this error:
`Colour "<literal>" on line <n>: take series colours from api.theme.categorical, and use api.theme.text or api.theme.background for anything else.`

The codegen loop (`visualize-d3.tool.ts`, where `lastError = validation.error`) already feeds `lastError` into the next attempt.

The loop logs a rejection: `logger.info({ tool: "visualize_d3", attempt, literal }, "visualize_d3 colour literal rejected")`, when the result carries `colour`.

### 4. Agent-facing text — four surfaces

- **`apps/api/src/prompts/visualize-d3.prompt.ts`, the codegen prompt:** documents the new `api.theme` fields and adds a "Colour and labelling" block:
  - series colours come only from `api.theme.categorical`, in order, and other colours from `api.theme.text` / `api.theme.background`;
  - never write a colour literal or use a d3 colour scheme (the check rejects it);
  - with two or more series, tell them apart by more than colour: label each series directly at its end or bar, or give each its own `api.theme.dashes` entry (lines) or `api.theme.symbols` entry (markers);
  - always draw a text legend or direct labels;
  - more than eight series reuse colours, so labels are required.
- **`apps/api/src/tools/visualize-d3.tool.ts` description, and its mirror in `packages/core/src/registries/builtin-toolpacks.ts`:** one sentence: "Charts use the theme's accessible palette and label their series; you don't choose colours."
- **`apps/api/src/tools/visualize-map.tool.ts` description, and its mirror:** `colorBy` colours come from the theme. `palette` and `stops` colours are ignored for categorical and step colouring, and the first eight categories get distinct colours.
- **`apps/api/src/prompts/system.prompt.ts` → Charting / Mapping:**
  - don't ask for specific colours: they come from the theme;
  - when asking for a chart by category, say how many series;
  - for a map, colour by a column with at most eight common values when the categories matter.

### 5. Map spec — `packages/core/src/contracts/map-spec.contract.ts`

`MapLayerStyleSchema.colorBy` gains one field:
```ts
/** The column's values in assignment order (#1022), back-filled by the
 *  server for categorical and step colouring. The renderer colours them
 *  from the theme; no colour is stored. */
categories: z.array(z.union([z.string(), z.number()])).optional(),
```
- `palette` and `stops` stay in the schema, so old blocks parse.
- Their descriptions say that colours in them are ignored except for `scale: "interpolate"`.

### 6. Map back-fill — `apps/api/src/tools/visualize-map.tool.ts`

- The non-interpolate branch (today `cb.stops = values.map((v, i) => [v, categoryColor(i)])`) becomes `cb.categories = values`. Its skip condition becomes "has `stops` or `categories`".
- `categoryColor`, `BASE_PALETTE` and `hslToHex` are deleted.
- The interpolate branch is unchanged.

### 7. Map rendering — `apps/web/src/modules/MapWidget/utils/map-config.util.ts`

```ts
export interface MapColours {
  categorical: readonly string[];  // palette.dataViz.categorical
  other: string;                   // palette.dataViz.other
}
export function resolveColorBy(colorBy, rows, colours: MapColours):
  { expression: unknown; legend: MapLegend | null };
export function layerToMapLibre(layer, index, rows, opts: { …existing; colours: MapColours });
export function buildLegend(spec: MapSpec, rows: Row[], colours: MapColours): MapLegend[];
export type MapLegend =
  | { kind: "swatches"; column: string; entries: LegendEntry[]; more: number }
  | { kind: "gradient"; column: string; min: number; max: number; stops: GradientStop[] };
```
- **Values, in order:**
  - `colorBy.categories`;
  - else the values of `colorBy.stops`, colours ignored, unless `scale === "interpolate"`;
  - else the first-seen values in `rows`.
- **Colours:** value `i < 8` gets `categorical[i]`; later values share `other`, and `more` counts them.
- **Step bands:** numeric values are deduped after coercion (`1`, `"1"`, `"1.0"` are one breakpoint). With more than eight, the eight band lower bounds are spread evenly through the sorted values, so every band keeps a colour and `more` is 0.
- **Unchanged:**
  - numeric inference (step) and its band ordering;
  - the `interpolate` path, and its stops' colours;
  - the no-categories `DEFAULT_COLOR` path, whose colour becomes `categorical[0]`.
- **Deleted:** `DEFAULT_PALETTE`. `UNMATCHED_COLOR` becomes `other`.
- **Paint:**
  - A polygon's outline layer and a line layer take the colour expression at full opacity, `line-width` ≥ 1.5 unless the style sets a width.
  - Point layers keep a full-opacity `circle-color` and gain `circle-stroke-color: colours.other`, `circle-stroke-width: 1`.
  - Fill opacity ceilings (`AGG_FILL_OPACITY`, `RAW_FILL_OPACITY`) are unchanged.
- `MapWidget` (the container) passes `useTheme().palette.dataViz` to `MapWidgetUI` as `colours`, which hands it to `layerToMapLibre` and `buildLegend`. `colours` is optional on the pure UI: without it, the UI takes the brand theme's `dataViz` for its `mode` (as the selection ring already follows `mode`), so tests and stories need no palette.
- **Layer colours (closing the code review's gap):** `layerToMapLibre` ignores `style.color` and `style.outlineColor`. A layer without `colorBy` takes `categorical[index % 8]`, and an outline takes its feature's colour. `visualize_map` refuses a spec whose layer style sets either field (`MAP_SPEC_INVALID`, naming each `layers.<i>.style.<field>`, before any SQL runs). Both fields stay in the schema so stored blocks parse.
- **Unfilled chart text (1.4.3):** the sandbox bootstrap adds `svg text:not([fill]) { fill: <theme.text> }` on init and on every theme message, accepting only a hex or `rgb()` value.
- A line layer no longer passes `style.opacity` through as `line-opacity`: a line is its own mark, so it stays at full opacity, where its colour is held at 3:1.
- The legend:
  - shows the column as its heading (`Typography variant="caption" component="p"`, "Colour: <column>");
  - gives each swatch a 1px `divider` border;
  - when `more > 0`, ends with a row: an `other` swatch and "+N more, listed under Features in view".

### 8. Docs

- **`docs/ACCESSIBILITY_CONFORMANCE_REPORT.md`:**
  - 1.4.1 and 1.4.11 move to Supports, scoped to "charts and maps drawn since #1022", naming:
    - OSM and custom basemaps as unverified;
    - pre-#1022 chart programs that hard-coded colours.
  - 1.4.3's #1022 reference is updated.
  - The evaluated-build note gains "1.4.1, 1.4.11: #1022".
- **`docs/A11Y_AUDIT.md`:** a walk row (CH-01) records the smoke walk's measured contrast and the legend and labels it saw.
- **`CLAUDE.md` → Accessibility Requirements → charts and maps:** one bullet. Chart and map colours come from `palette.dataViz` (held by `theme-contrast.test.ts`). A chart program may not write colours (the validator rejects them), and a categorical map is coloured by the web from the theme.

## Migration
## Seed

None. No table or seed changes. Stored blocks keep their JSON and are recoloured when they're drawn.

## TDD test plan

Run per package: `npm run test:unit -w @portalai/core`, `-w @portalai/api`, `-w @portalai/web`, each with `-- --testPathPattern <file>`. Run `npm run build -w @portalai/core` before api and web.

### core
- **`packages/core/src/__tests__/ui/theme-contrast.test.ts`, new block "dataViz", per theme:**
  - each `categorical` colour and `other` are ≥3:1 on `background.default`, `background.paper` and `BASEMAP_BACKGROUND[mode]`;
  - the eight are unique;
  - every pair is ≥ ΔE 20 (CIE76 Lab; a test-local `toLab`).

  About 6 cases × 2 themes.
- **`packages/core/src/__tests__/contracts/map-spec.contract.test.ts`:** `categories` accepts strings and numbers; an old block with hex `stops` still parses. 2 cases.
- **`builtin-toolpacks.test.ts`:** the visualize_d3 and visualize_map mirror descriptions carry the colour sentence. 2 cases.

### api
- **`apps/api/src/__tests__/tools/visualize-d3.validate.test.ts`:**
  - rejects: each hex form; `rgb(`/`hsl(`; `d3.schemeCategory10`; `d3.interpolateViridis`; `.attr("fill", "red")`; `.style("stroke", "steelblue")`;
  - allows: `api.theme.categorical[i]`; `"none"`/`"currentColor"`; `d3.interpolateNumber`; a hex in a comment; a `#` that isn't a colour (`"#1 region"`, `"#total"`);
  - the error names the literal and its line;
  - a parse error still wins.

  About 14 cases.
- **`visualize-d3.tool.test.ts`:**
  - a codegen that returns a coloured program, then a clean one, mints on the second attempt;
  - one that never stops falls back to `data-table`;
  - the log line fires.

  3 cases.
- **`visualize-d3.prompt.test.ts`:** the prompt documents `dashes`, `symbols` and `background`, forbids colour literals, and requires the second cue from two series up. 3 cases.
- **`visualize-map.tool.test.ts`:**
  - categorical back-fill writes `categories` in frequency order, with no `stops`;
  - interpolate is unchanged;
  - existing `stops` or `categories` skip the back-fill;
  - the old `categoryColor` test is removed.

  3 cases.
- **`system.prompt.test.ts`:** the Charting and Mapping guidance says colours come from the theme. 1 case.
- **`builtin-toolpack-schema-parity.test.ts`:** unchanged (no schema keys change); must stay green.

### web
- **`D3Widget/utils/__tests__/sandbox-theme.util.test.ts`:**
  - `categorical` is `dataViz.categorical`;
  - `background` is paper;
  - `dashes[0] === "none"`;
  - every `symbols` name exists on `d3`.

  4 cases, replacing the "six mains" pins.
- **`sandbox-bootstrap.test.ts`:** `init` and `theme` set the body background. 2 cases.
- **`MapWidget/__tests__/map-config.util.test.ts`:**
  - colours by `categories` order from `MapColours`;
  - old hex `stops` are recoloured;
  - categories past the eighth get `other`, and `more` counts them;
  - interpolate keeps its stop colours;
  - numeric categories still infer step;
  - the outline and line paint use the colour expression at full opacity;
  - points get a stroke;
  - the legend carries `column`.

  About 9 cases.
- **`MapWidget.test.tsx`:**
  - the legend shows "Colour: <column>" and a "+N more" row;
  - swatches have a border;
  - axe clean with a legend;
  - a theme switch recolours.

  4 cases.

**Totals ≈ 65 cases.**

## Acceptance criteria

- [ ] In both themes, every chart and map category colour is ≥3:1 against the figure's surface and the theme's CARTO basemap, and the eight are distinct. A test enforces it.
- [ ] A newly generated chart with two or more series uses only palette colours and shows its series by direct labels, dashes or markers, with a text legend. The chart frame's background is the figure's surface.
- [ ] A generated chart program containing a colour literal is never minted. The check rejects it, and three rejections fall back to a data table.
- [ ] A categorical map colours its first eight categories from the theme in both themes. Further categories share one "other" colour, counted in the legend.
- [ ] Map features are outlined, at full opacity, in their category colour.
- [ ] A map saved before the change and opened after it shows theme colours.
- [ ] The map legend names the column it colours by, and its swatches are bordered.
- [ ] The ACR's 1.4.1 and 1.4.11 rows are Supports, scoped and naming the exclusions, and CH-01 records the walk.

## Risks & rollback

- **The colour check blocks legitimate programs.**
  - Risk: a `#` in a data label, or a colour-like word in text.
  - Mitigation: the check matches colour syntax only in string literals, plus attr and style calls; the false-positive cases are in the tests.
  - Worst case: more attempts, and the existing data-table fallback (fail-safe: the user still gets the data).
  - Detected by: the info log line.
  - Rollback: `validateProgram` returns to parse-only (one function).
- **The codegen model ignores the second-cue rule.**
  - Impact: a chart differs by colour alone, but with checked contrast and the #796 text alternatives.
  - Detected by: the smoke walk and later spot checks.
- **Map recolouring surprises users of saved maps.** Category colours change once, intentionally; the legend shows the new mapping.
- **Basemap values drift.** If CARTO changes its land colours, the test's constants are stale. They're recorded with their source URL so a re-read is mechanical.
- No data migration, so rollback is a revert of the branch's commits.

## Files touched

- **core:**
  - edit: `src/types/theme.ts`, `src/assets/themes/brand-theme.json`, `brand-theme-dark.json`, `src/constants/map-palette.constants.ts`, `src/contracts/map-spec.contract.ts`, `src/registries/builtin-toolpacks.ts`;
  - tests: `src/__tests__/ui/theme-contrast.test.ts`, `src/__tests__/contracts/map-spec.contract.test.ts`, `src/__tests__/registries/builtin-toolpacks.test.ts`.
- **api:**
  - edit: `src/tools/visualize-d3.validate.ts`, `src/tools/visualize-d3.tool.ts`, `src/prompts/visualize-d3.prompt.ts`, `src/tools/visualize-map.tool.ts`, `src/prompts/system.prompt.ts`;
  - tests: the matching files under `src/__tests__/tools/` and `src/__tests__/prompts/`.
- **web:**
  - edit: `src/modules/D3Widget/utils/sandbox-theme.util.ts`, `utils/sandbox-bootstrap.js`, `src/modules/MapWidget/utils/map-config.util.ts`, `MapWidget.component.tsx`;
  - tests: `sandbox-theme.util.test.ts`, `sandbox-bootstrap.test.ts`, `map-config.util.test.ts`, `MapWidget.test.tsx`.
- **docs:** `docs/ACCESSIBILITY_CONFORMANCE_REPORT.md`, `docs/A11Y_AUDIT.md`, `CLAUDE.md`.

## Next step

`docs/CHART_MAP_COLOUR_CONTRACT.plan.md` sequences this in about five TDD slices on this branch:
1. The core palette, basemap constants and contrast test.
2. The chart sandbox theme and paper background.
3. The colour check, codegen prompt and the agent-facing surfaces.
4. Map colouring moved to the web: `categories`, recolouring, "other", the outline paint and the legend.
5. The docs, with the smoke walk's evidence.
