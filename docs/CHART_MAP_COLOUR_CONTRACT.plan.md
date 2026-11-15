# Chart and map colour contract — Plan

**TDD-sequenced implementation of the theme's `dataViz` palette, the chart sandbox's new theme fields, the colour check on generated chart programs, web-side colouring of categorical maps, and the ACR rows that close #1022.**

Spec: `docs/CHART_MAP_COLOUR_CONTRACT.spec.md`. Discovery: `docs/CHART_MAP_COLOUR_CONTRACT.discovery.md`. Issue: #1022 (epic #791, found by #800). Builds on #796 (`VisualFigure`, "Show data", `MapFeatureList`), all on `epic/a11y-conformance`.

Six slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `fix/1022-chart-map-colour-contract`** (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests per package with the npm scripts, never jest directly:

```bash
npm run build -w @portalai/core                       # before api/web slices that read a core change
npm run test:unit -w @portalai/core -- --testPathPattern "<file>"
npm run test:unit -w @portalai/api  -- --testPathPattern "<file>"
npm run test:unit -w @portalai/web  -- --testPathPattern "<file>"
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint` + `npm run type-check` for the touched packages at the boundary; (5) next slice.

Sequencing rationale:
- **Slice 1** is the leaf everything reads: the palette, its type and the basemap constants. Nothing consumes it yet.
- **Slice 2** gives the chart sandbox the palette. Programs that already read `api.theme.categorical` change colour here, before anything rejects literals.
- **Slice 3** adds the colour check, and **slice 4** the prompt and tool text that tell the agent about it. They're split so the validator (pure, ~14 cases) reviews apart from the prose.
- **Slice 5** moves map colouring to the web, reading `colorBy.categories` when present and the old `stops` otherwise. It lands **before** the back-fill change, so at its boundary the server still writes colour stops and the web recolours them; nothing is ever unrendered.
- **Slice 6** switches the back-fill to `categories`, deletes `categoryColor`, and updates the map's agent-facing text.
- **Docs** (ACR, audit CH-01, CLAUDE.md) land after the smoke walk, since CH-01 records measured values (see Cross-slice notes).

---

## Slice 1 — The `dataViz` palette (core)

The palette both themes carry, the type that requires it, and the backgrounds it's measured against.

**Files**
- Edit: `packages/core/src/types/theme.ts` — `DataVizPalette`; `Palette.dataViz`, `PaletteOptions.dataViz?`.
- Edit: `packages/core/src/assets/themes/brand-theme.json`, `brand-theme-dark.json` — `palette.dataViz`.
- Edit: `packages/core/src/constants/map-palette.constants.ts` — `BASEMAP_BACKGROUND`, with the source URLs (`map-config.util.ts:655-657`) in its comment.
- Edit: `packages/core/src/__tests__/ui/theme-contrast.test.ts` — the "dataViz" block.

**Steps**
1. **Read the basemap backgrounds.** Fetch the Positron and Dark Matter style JSONs and read the `background` layer's `background-color`. Record both values; if a style uses an interpolated colour by zoom, take the one at the zoom range a map opens at and note it.
2. **Tests (spec § TDD core, theme-contrast; ~12 cases).** Per theme: every `categorical` colour and `other` ≥3:1 against `background.default`, `background.paper` and `BASEMAP_BACKGROUND[mode]`; eight unique; every pair ≥ ΔE 20 (test-local `toLab`). Run; fail (no `dataViz`).
3. **Implement** the type and both JSON blocks with the spec's starting values. Where a value fails, adjust it in place (lightness first, keeping the hue) until green. Record any changed hex in the spec.
4. `npm run build -w @portalai/core`, then lint + type-check across the monorepo: `Palette.dataViz` is required, so any hand-built theme fixture in web or site must be checked (memory: a core change ripples to typed fixtures).

**Done when:** the contrast block passes in both themes; the root `type-check` is green; nothing reads `dataViz` yet.

**Risk:** eight hues that are all ≥3:1 on white *and* on Positron's near-white land, while staying ΔE 20 apart, may force darker hues than the starting set. The ΔE threshold is the knob to revisit (with the user) if it can't be met, not the 3:1.

---

## Slice 2 — The chart sandbox theme (web)

**Files**
- Edit: `apps/web/src/modules/D3Widget/utils/sandbox-theme.util.ts` — `background` from `background.paper`, `categorical` from `dataViz.categorical`, `dashes`/`symbols` from `SANDBOX_DASHES`/`SANDBOX_SYMBOLS`.
- Edit: `apps/web/src/modules/D3Widget/utils/sandbox-bootstrap.js` — set the body background on `init` and on `theme`.
- Tests: `D3Widget/utils/__tests__/sandbox-theme.util.test.ts` (4 cases, replacing the "six mains" pins), `sandbox-bootstrap.test.ts` (2 cases).

**Steps**
1. **Tests.** `categorical === dataViz.categorical`; `background === background.paper`; `dashes[0] === "none"`; each `symbols` name is a function on `d3`. Bootstrap: an `init` message and a `theme` message each leave `document.body.style.background` set to the theme's background. Run; fail.
2. **Implement.** Green.
3. Lint + type-check web.

**Done when:** the six cases pass; the existing D3Widget suites stay green.

**Risk:** the frame's background changes from `background.default` to `paper`. Check `D3Widget` stories/tests that snapshot the theme object.

---

## Slice 3 — The colour check (api)

**Files**
- Edit: `apps/api/src/tools/visualize-d3.validate.ts` — `ColourLiteral`, `findColourLiterals`, `NON_COLOUR_INTERPOLATORS`; `validateProgram` runs it after the parse.
- Edit: `apps/api/src/tools/visualize-d3.tool.ts` — the info log line on a colour rejection.
- Tests: `apps/api/src/__tests__/tools/visualize-d3.validate.test.ts` (~14), `visualize-d3.tool.test.ts` (3).

**Steps**
1. **Tests (spec § TDD api).** Rejects each hex form, `rgb(`/`hsl(`, `d3.schemeCategory10`, `d3.interpolateViridis`, `.attr("fill", "red")`, `.style("stroke", "steelblue")`. Allows `api.theme.categorical[i]`, `"none"`/`"currentColor"`, `d3.interpolateNumber`, a hex in a comment, `"#1 region"`, `"#total"`. The error names the literal and its line; a parse error still wins. Tool: coloured-then-clean mints on attempt 2; always-coloured falls back to `data-table`; the log line fires. Run; fail.
2. **Implement** `findColourLiterals` (strip comments, then the five matchers in order of appearance), then the log line. Green.
3. Check the existing `visualize-d3.tool.test.ts` fixtures: any stub program carrying a colour literal is now rejected, so replace its colours with `api.theme.categorical`.
4. Lint + type-check api.

**Done when:** ~17 cases pass, and every pre-existing api D3 test is green.

**Risk:** false positives. The `"#total"` and `"#1 region"` cases are the guard; a hex match requires 3/4/6/8 hex digits followed by a non-word character.

---

## Slice 4 — The chart's agent-facing text (api, core)

**Files**
- Edit: `apps/api/src/prompts/visualize-d3.prompt.ts` — the new `api.theme` fields and the "Colour and labelling" block.
- Edit: `apps/api/src/tools/visualize-d3.tool.ts` description, and its mirror in `packages/core/src/registries/builtin-toolpacks.ts`.
- Edit: `apps/api/src/prompts/system.prompt.ts` — Charting guidance (colours come from the theme; say how many series).
- Tests: `visualize-d3.prompt.test.ts` (3), `system.prompt.test.ts` (1 — the Charting half), `builtin-toolpacks.test.ts` (1 — visualize_d3).

**Steps**
1. **Tests.** The codegen prompt documents `dashes`, `symbols` and `background`, forbids colour literals, and requires the second cue from two series up; the system prompt's Charting guidance says colours come from the theme; the visualize_d3 mirror carries the colour sentence. Run; fail.
2. **Implement** the text. Green. `builtin-toolpack-schema-parity.test.ts` must stay green (no schema key changes).
3. `npm run build -w @portalai/core`; lint + type-check core and api.

**Done when:** 5 cases pass; the parity test is green.

---

## Slice 5 — Maps coloured by the web (core contract, web)

**Files**
- Edit: `packages/core/src/contracts/map-spec.contract.ts` — `colorBy.categories`; `palette`/`stops` descriptions.
- Edit: `apps/web/src/modules/MapWidget/utils/map-config.util.ts` — `MapColours`; `resolveColorBy`, `layerToMapLibre`, `buildLegend` take it; values from `categories` → old `stops` → rows; the "other" bucket and `more`; `MapLegend.column`; outline/line/point paint; `DEFAULT_PALETTE` deleted, `UNMATCHED_COLOR` → `other`.
- Edit: `apps/web/src/modules/MapWidget/MapWidget.component.tsx` — `MapColours` from `useTheme().palette.dataViz`; legend heading, bordered swatches, the "+N more" row.
- Edit: `apps/web/src/modules/MapWidget/index.ts` if it re-exports the changed signatures; MapWidget stories if they build a legend.
- Tests: `packages/core/src/__tests__/contracts/map-spec.contract.test.ts` (2), `MapWidget/__tests__/map-config.util.test.ts` (~9), `MapWidget.test.tsx` (4).

**Steps**
1. **Core tests and change.** `categories` accepts strings and numbers; an old block with hex `stops` parses. Implement; `npm run build -w @portalai/core`.
2. **Web tests (spec § TDD web).** Colours by `categories` order; old hex `stops` recoloured; past the eighth → `other` with `more` counted; interpolate keeps its stop colours; numeric categories still infer step; outline and line paint use the expression at full opacity, width ≥1.5; points get a stroke; legend carries `column`. Component: "Colour: <column>" heading and "+N more" row; swatch border; axe clean with a legend; a theme switch recolours. Run; fail.
3. **Implement.** Update existing `map-config.util.test.ts` cases that pin `DEFAULT_PALETTE` or stop colours to pass `MapColours` and assert theme colours. Green.
4. Lint + type-check core and web.

**Done when:** ~15 cases pass; the existing MapWidget suites are green; the server is untouched, so a freshly generated map (still back-filled with colour stops) renders in theme colours.

**Risk:** the legend styling must come from the theme, not an ad hoc `sx` in web (CLAUDE.md → Styling lives in the theme). If the bordered swatch can't be expressed through existing components, add the rule to core's theme rather than `sx`.

---

## Slice 6 — The map back-fill writes categories (api, core)

**Files**
- Edit: `apps/api/src/tools/visualize-map.tool.ts` — the non-interpolate back-fill writes `cb.categories`; skip when `stops` or `categories` exist; delete `categoryColor`, `BASE_PALETTE`, `hslToHex`; description: colours come from the theme.
- Edit: its mirror in `packages/core/src/registries/builtin-toolpacks.ts`; `apps/api/src/prompts/system.prompt.ts` — Mapping guidance (at most eight common values when categories matter).
- Tests: `visualize-map.tool.test.ts` (3, removing the `categoryColor` test), `system.prompt.test.ts` (Mapping half), `builtin-toolpacks.test.ts` (visualize_map).

**Steps**
1. **Tests.** Categorical back-fill writes `categories` in frequency order with no `stops`; interpolate unchanged; existing `stops` or `categories` skip it; the mirror and system prompt carry the map colour text. Run; fail.
2. **Implement.** Green. Parity test stays green.
3. `npm run build -w @portalai/core`; lint + type-check core and api.

**Done when:** the cases pass; nothing in api references `categoryColor`.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | `dataViz` palette + basemap constants | theme-contrast "dataViz"; root type-check |
| 2 | Sandbox theme + paper background | sandbox-theme / bootstrap |
| 3 | Colour check + log line | validate / tool tests |
| 4 | Chart prompt + tool text | prompt / system / mirror tests; parity |
| 5 | `categories` contract; web map colouring + legend | map-spec / map-config / MapWidget |
| 6 | Back-fill writes `categories` + map text | visualize-map / system / mirror; parity |

Totals ≈ 65 cases, matching the spec.

## Cross-slice notes

- **Rebuild core** before running api or web tests after slices 1, 4, 5 and 6 (memory: stale core dist breaks the build), and touch an api source file before any live probe so nodemon reloads it.
- **Partial module mocks.** Web tests that fake `@mui` theme pieces or build a theme by hand need `dataViz` once slice 2/5 read it; grep the fakes before pushing.
- **Doc sync** (spec § 8) is one commit after the smoke walk: the ACR's 1.4.1 / 1.4.11 / 1.4.3 rows and evaluated-build note, `A11Y_AUDIT.md` CH-01 with the measured contrast, and the `CLAUDE.md` bullet. The tool-surface docs are already in slices 4 and 6. The `/smoke` doc follows the plan's last slice; the walk generates a chart and a categorical map in a portal session in both themes.
- **Live LLM in the smoke.** The second-cue rule is a prompt rule, so only a live generation shows whether the model follows it. The walk records what it saw rather than asserting it.

## Next step

Once discovery, spec and plan are confirmed, implementation starts on this branch with slice 1, tests first, one commit per slice.
