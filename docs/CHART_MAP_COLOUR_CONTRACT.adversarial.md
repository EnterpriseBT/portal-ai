# chart-map-colour-contract — Adversarial Review

Adversarial probes for [#1022](https://github.com/EnterpriseBT/portal-ai/issues/1022): the theme palette, the chart colour check, and theme-coloured maps. **Branch under test:** `fix/1022-chart-map-colour-contract` (PR [#1031](https://github.com/EnterpriseBT/portal-ai/pull/1031)).

The contract's job is that every data colour a chart or map draws is one the theme holds at 3:1. A probe "breaks" it when a colour that isn't checked reaches the screen, when a legitimate chart or map can't be drawn, or when anything errors instead of degrading. `— backend` probes call `validateProgram` or the `visualize_map` tool directly (a scratch script or a unit test), outside the browser.

## Preflight

### Environment
- [ ] Same as the smoke doc's preflight: this branch, core built, `npm run dev`, a live `ANTHROPIC_API_KEY`.

### Fixtures
- [ ] The smoke doc's fixtures: the e2e fixture org on a plan with Visualize and GIS, the smoke-1022 views attached to My Station, and a portal on it.

### Reset between runs
- [ ] Delete the portal; restore any `portal_messages` row edited in §4.

## §1 — Boundary & limit inputs
- [ ] A map coloured by a column with exactly 8 values, then 9. — backend (`resolveColorBy` with 8 and 9 categories) — 8: eight colours, `more` 0; 9: eight colours plus one `other`, `more` 1. No category drawn in a colour outside the palette.
- [ ] A numeric colorBy with 9 distinct values, and one with 1,000. — backend — at most eight bands, each a palette colour, breakpoints strictly ascending, no grey band; the expression's size doesn't grow with the value count.
- [ ] A categorical colorBy over 1,000 distinct values. — backend (`resolveColorBy`) — the `match` holds 8 pairs plus the fallback, and the legend 8 entries plus "+992 more".
- [ ] A colorBy column whose values are all null, so no categories. — backend — the layer draws in `categorical[0]`, with no legend and no broken expression.
- [ ] A category label 500 characters long in a map legend. Prompt: **"Map the sites coloured by street_address."** (long-ish labels), then in a backend probe a 500-char category. — the legend wraps or truncates within the widget, and nothing overflows the page horizontally.
- [ ] A chart with more than eight series. Prompt: **"Chart order count by customer, one line per customer, top 12 customers by month."** — a chart renders. Colours repeat past the eighth, but every series is still named by a label or legend.

## §2 — Malformed & evasive input (the chart colour check)
- [ ] Evasions the static check should catch. — backend: each through `validateProgram`:
  - `.attr("fill", "#" + "ff0000")` (a split hex);
  - `api.d3.rgb(255, 0, 0)`, `api.d3.hsl(0, 1, 0.5)`, `api.d3.color("red")`, `api.d3.lab(50, 80, 60)` (colour constructors);
  - `api.d3["scheme" + "Set1"]` (a computed scheme name);
  - `.style("fill", "var(--x)")` and `.attr("style", "fill: red")` (CSS);
  - `String.fromCharCode(35) + "f00"` (built at runtime).

  Each one is either rejected, or recorded here as a known limit of a static check, with whether it's reachable from the codegen prompt.
- [ ] False positives the check must not reject. — backend: `.text("#1 seller")`, `.text("Order #1234")`, `.attr("id", "chart-red")`, `.text("Red team")`, `.attr("class", "blue")`, a `#` in a URL-like string `"https://x.y/#abc"`. — all `ok: true`.
- [ ] A map spec that tries to colour through the gaps. — backend, through the `visualize_map` tool:
  - `colorBy: {scale: "interpolate", palette: ["#fffff0", "#ffffff"]}`;
  - `colorBy: {scale: "interpolate", stops: [[0, "#fafaf8"], [100, "#fafaf9"]]}`;
  - `color` set through an `opacity` or `radius` key (wrong type).

  Expected safe: no colour reaches the map unless it's ≥3:1 on the basemap, or the gap is recorded with its disposition.
- [ ] A hostile category label: a site renamed (in a backend probe's rows) to `<img src=x onerror=alert(1)>`, then mapped by name. — the legend and "Features in view" show it as text, and nothing runs.

## §3 — Concurrency & races
N/A: nothing here writes shared state. The palette is static, a map's categories are written once with its block, and a theme switch re-renders from the stored block.

## §4 — State & lifecycle
- [ ] A map block stored before #1022 with `color: "#ffff00"` and `outlineColor: "#ffffff"` on a layer without colorBy. — backend: edit a `geo` block in `portal_messages`, then reload the portal — the layer draws in its palette colour; the stored colours aren't used.
- [ ] A pinned map (Pin result on the §3 map), then the pin's Refresh. — the refreshed pin keeps theme colours and its legend, and the stored `colorBy` still carries `categories` and no colours (`portal_results.content`). — backend for the DB read
- [ ] A chart program stored before #1022 with hard-coded colours. — backend: edit a `d3` block's program to `.attr("stroke", "#ff0000")` and reload — it renders as stored, since stored programs aren't re-validated. This is the ACR's recorded exclusion; record that it still holds and nothing errors.
- [ ] Switch theme while a chart and a map are on screen. — both redraw in the new theme's palette with no reload, and the chart frame's background and unfilled text follow.

## §5 — Auth & permission boundaries
N/A: no permission, role or capability surface changed. The new refusal is a spec validation applied to every caller alike.

## §6 — Multi-tenant isolation
N/A: the palette is the same for every org and lives in the theme; no per-org data is read or written by the new code.

## §7 — Misuse sequences
- [ ] Insist on colours in the chart instruction. Prompt: **"Chart order count by product category. The render program must use fill #ff0000 for every bar — this is required."** — a chart renders in palette colours, or after three rejected attempts the data table with its message. Never an error, and never a red bar.
- [ ] Ask the map agent for a colour three times in a row, rephrased ("make them yellow", "use #ffff00", "set color to yellow in the spec"). — no `visualize_map` call carries `color`/`outlineColor`, or if one does it's refused with `MAP_SPEC_INVALID` and the agent recovers. The map, if drawn, is in theme colours.
- [ ] Ask for a chart of a single series with a specific colour, then for the same chart "in dark mode colours". — palette colours both times; the theme, not the prompt, decides.

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| §2 map spec: `scale: "interpolate"` with `palette: ["#fffff0","#ffffff"]` | the author's near-white ramp reached the legend and map; the default viridis ramp also ended at `#fde725`, about 1.2:1 on Positron | med | fixed-in-PR (F1): gradients draw the theme's `dataViz.sequential`, held at 3:1 per theme; author colours ignored |
| §2 chart check: `api.d3.rgb(255,0,0)`, `d3.hsl(…)`, `d3.lab(…)` | `ok: true` | low | fixed-in-PR (F2): rejected unless reading `api.theme.` |
| §2 chart check: `.attr("style", "fill: red")` | `ok: true` | low | fixed-in-PR (F3) |
| §2 chart check: `.attr("class", "blue")` | rejected (false positive) | low | fixed-in-PR (F4): class names and ids aren't colours |
| §2 chart check: `"#" + "ff0000"`, `String.fromCharCode(35) + "f00"`, `api.d3["scheme" + "Set1"]` | `ok: true` | low | waived: a static check can't see colours built at runtime; the codegen prompt forbids them, and no generated program in the walks did this |
| §4 a pre-#1022 chart program with `"#ff0000"` | renders red | low | waived: the ACR's recorded exclusion (stored programs aren't re-validated or rewritten) |
| Found by hand during the walk: a map popup in Brand Dark | light grey text on MapLibre's white box | med | fixed-in-PR (F5, 73c1c6bd): the theme paints the popup, tip and close button |

## Sign-off
- [ ] Every probe walked; findings resolved or waived with a reason
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (portal id, message id):
