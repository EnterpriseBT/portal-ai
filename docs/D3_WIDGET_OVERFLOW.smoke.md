# d3-widget-overflow — Smoke Suite

Manual smoke test for [#278](https://github.com/EnterpriseBT/portal-ai/issues/278) — the D3 widget now sizes itself from its **painted extent** instead of its DOM box: it fits its whole visualization vertically, scrolls horizontally when a chart is intrinsically wider than its column, and tracks the container width for the life of the mount.

**Branch under test:** `fix/d3-widget-overflow` (no PR yet — open it before merging).

Because the in-frame measurement can't be meaningfully unit-tested (jsdom has no layout, no `getBBox`), **this walkthrough is the primary verification of the core mechanism**. Expect to refine geometry here rather than treat the first oddity as a failed slice.

## Preflight

### Environment

- [ ] `git checkout fix/d3-widget-overflow && git pull --ff-only`
- [ ] `npm install` — no migration on this branch (client-side layout + one prompt string; **no DB change**)
- [ ] `npm run dev` boots cleanly — web http://localhost:3000, API http://localhost:3001
- [ ] Hard-reload the browser (⇧⌘R / Ctrl-Shift-R) — the sandbox `srcdoc` and its CSS are bundled, so a cached bundle will smoke the *old* frame

### Fixtures

- [ ] Signed in as your local dev user, with the station that carries the **asteroid dataset — 10,254 rows** (columns: `absolute_magnitude_h`, `date`, `diameter_{km,m,feet,miles}_{min,max}`, `id`, `is_potentially_hazardous`, `miss_distance_{km,miles,lunar,astronomical}`, `name`, `velocity_{kps,kph,mph}`)
- [ ] The `visualize` toolpack is enabled for that station
- [ ] A second, smaller entity (~1,460 rows) is available for the compact-chart cases

### Reset between runs

- [ ] No reset needed — every step is a fresh portal turn; nothing here writes app data. Start a **new portal session** per section so the feed stays short enough to judge scroll behavior.

### What to watch in EVERY step below

- [ ] **No vertical scrollbar on a widget, ever** — not on the widget frame, not inside the iframe. This is the invariant; a vertical scrollbar anywhere is a bug even if the chart looks complete.
- [ ] Nothing is cut off: axis labels, tick labels, legends, node labels, and the outermost marks are all fully visible (or reachable by horizontal scroll).

---

## §1 — The reported regressions (spec AC 1, 6)

The two charts from the issue's repro. These are the acceptance bar.

- [ ] Prompt: *"Sankey diagram flowing size bucket → hazard class → miss-distance bucket."*
- [ ] All node labels on **every** column are fully visible, including the right-most column's; nothing is clipped at the frame edge
- [ ] Prompt: *"Beeswarm of velocity_kps for hazardous vs non-hazardous, force-simulated so nothing overlaps."*
- [ ] **Both** swarms are complete — no cut-off sliver at the bottom of either (this was the silent vertical clip)
- [ ] Both category labels are fully readable
- [ ] Neither chart oscillates, flickers, or grows repeatedly after settling — it reaches its size within about one redraw and stays there

## §2 — Wide & label-dense forms → horizontal scroll (spec AC 2, 3)

Each of these is intrinsically wider than the chat column or carries long labels. **Expected in every case:** a horizontal scrollbar on the widget, every part reachable by scrolling, and no vertical scrollbar.

- [ ] *"Horizontal bar chart of the 30 largest asteroids by diameter_km_max, with the full asteroid name on the axis."* — long names are fully readable, not truncated or clipped
- [ ] *"Grouped bar chart of monthly close-approach counts split by hazard class, across the whole date range."* — many x categories; all tick labels legible
- [ ] *"Heatmap of month against velocity_kps decile, counting approaches."* — all column headers and row labels visible
- [ ] *"Treemap of hazard class then size bucket, sized by count, with labels inside each tile."* — tile labels not clipped at the right edge
- [ ] *"Scatter of absolute_magnitude_h against miss_distance_km, log scale, coloured by hazard class, with a legend."* — the **legend is fully visible** and not overlapping the marks
- [ ] *"Chord diagram of size bucket against miss-distance bucket."* — outer labels around the full circle are all present
- [ ] Scroll one of the above fully right, then left — the chart stays put (no re-layout jump mid-scroll)

## §3 — Tall forms → fits vertically, unbounded (spec AC 3)

- [ ] *"Small multiples: one histogram of velocity_kps per size bucket, stacked vertically."* — every facet is visible; the widget is as tall as it needs to be
- [ ] *"Lollipop chart ranking the 60 closest approaches by miss_distance_km."* — all 60 rows present, none cut off
- [ ] *"Box plot of miss_distance_km per month for the full range."* — whiskers and outliers at both extremes are visible, not clipped at top or bottom
- [ ] *"Violin plot of velocity_kps by hazard class."* — the full violin outline, top and bottom, is visible
- [ ] For each: the page scrolls (normal chat scrolling), but **the widget itself never scrolls vertically**
- [ ] The widget's own chrome (title, status chip, refresh button, "Updated … ago") is not overlapped by the chart's marks

## §4 — Compact forms → no over-growth (spec AC 2)

The reverse failure: a small chart must still fill its column and must not be stretched or given a phantom scrollbar.

- [ ] *"Donut chart of hazardous vs non-hazardous, with a legend beside it."* — fills the column width; no horizontal scrollbar (nothing to scroll)
- [ ] *"Line chart of mean miss_distance_km by month."* — spans the full column width
- [ ] *"Single big number: the count of potentially hazardous asteroids."* — a small widget, not a 360px-tall empty box with a tiny number
- [ ] None of the three shows a scrollbar in either axis

## §5 — Responsive reflow (spec AC 4, 5, 6)

The slice-3 behavior. Use one chart with visible layout sensitivity — a grouped bar or the horizontal-bar case from §2.

- [ ] With a chart on screen, **drag the browser window narrower** — the chart re-lays-out at the new width (bars re-space, labels re-fit); it does not just get visually squashed or clipped
- [ ] **Drag it back wider** — the chart returns to its original layout
- [ ] During the drag the widget stays responsive (no freeze, no flicker storm) — resizes are coalesced to one per frame
- [ ] Narrow the window to a **chat column under 640px** and prompt for a new chart — it lays out for the real narrow width, not a 640px fallback that overflows
- [ ] Open/close any side panel or the browser devtools docked to the side — the chart reflows to the new column width
- [ ] Browser zoom to 150%, then back to 100% — the chart re-fits at each level with no clipping
- [ ] A chart that was horizontally scrolling: narrow the window further — it still scrolls, and the scrollable extent grows rather than the content being clipped
- [ ] After any resize, the chart **settles** — no repeated growth (frame getting wider and wider each redraw) and no oscillation

## §6 — Large data & progressive rendering (spec AC 7)

- [ ] Prompt a chart over the **full 10,254 rows** (e.g. *"Scatter of velocity_kps against miss_distance_km for all asteroids."*)
- [ ] The "Rendering N of 10,254 rows…" caption appears while batches stream, then goes away
- [ ] The widget resizes as batches arrive **without** flicker, jumping, or the page scroll position lurching
- [ ] The finished chart is correctly sized — not still at the initial 360px height, and not clipped
- [ ] Rendering stays responsive throughout (the measurement is per-redraw; a visible stall here is the thing to report)

## §7 — Interop with the shipped epic (spec AC 7)

Nothing from #268–#273 may regress.

- [ ] **Refresh (#270):** click a widget's refresh button — it re-runs, and the re-rendered chart is correctly sized (not reverted to a clipped or 360px state)
- [ ] **Lazy mount/teardown (#271):** scroll a tall widget far offscreen, then scroll back — it re-renders, and **the scroll position does not jump** (the placeholder held its real height)
- [ ] Scroll past several widgets in a long session and back — no accumulating layout drift
- [ ] **Theme:** switch light ↔ dark with charts on screen — they re-render at the correct size in both themes
- [ ] **Error card (#268):** prompt something that fails codegen (e.g. *"chart the colour of each asteroid's mood"*) — the error card renders in place of the chart, correctly sized, with no scrollbars
- [ ] **Pin gating (#273):** hovering a chart widget still shows **no** pin icon; text and data-table blocks still do

## §8 — Codegen guidance (slice 4)

Checks the prompt change is having its intended effect on *newly generated* programs.

- [ ] Prompt a chart with genuinely long category labels (e.g. *"bar chart of approach counts by asteroid name for the 20 closest approaches"*) — the generated program leaves room for the labels rather than clipping them at a 40px margin
- [ ] Prompt a chart that needs a legend (*"stacked area of monthly counts by size bucket, with a legend"*) — the legend has its own space and doesn't overlap the plot
- [ ] Nothing regressed in the basics: charts still clear and redraw idempotently as data streams (no doubled marks, no ghosting)

## §9 — Error, edge, and known-limitation cases

- [ ] **Measurement fail-open:** no chart should ever render *blank* because of sizing. If one does, that's the highest-severity finding here — the fallback is meant to degrade to the old (possibly cropped) behavior, never to nothing
- [ ] **Negative-coordinate content (known limitation, not a bug to fix here):** if a chart paints marks at negative coordinates (a legend or label placed left of / above the origin), growing the frame cannot reveal it and it stays clipped. If you hit a real instance, note it — it's a **follow-up ticket**, out of scope for #278
- [ ] **No `ResizeObserver`:** in devtools console run `Object.defineProperty(window, 'ResizeObserver', { value: undefined })`, hard-reload is **not** needed for already-mounted widgets — instead run it, then prompt a new chart. It renders at mount width (degraded: no reflow on resize) and does **not** throw or blank
- [ ] Very small window (e.g. 400px wide): charts still render and scroll rather than collapsing to zero width
- [ ] Rapid-fire: prompt two charts in quick succession — both size correctly and independently

## Sign-off

- [ ] Every section above verified against my own running stack
- [ ] Any bugs found are filed (template below) with a decision on whether each blocks merge
- [ ] ______________________ (date + name) — confirmed

## Bug-filing template

```
Section:            (e.g. §2, horizontal bar with long names)
Chart prompt:       (the exact prompt used)
Expected:
Got:                (clipped where? scrollbar where? oscillating?)
Repro:              (window width, theme, row count, reproducible or intermittent)
Identifiers:        (portal id / message id / block index — from the URL + devtools)
Screenshot:
```

Findings that are **visual refinement** (a margin that could be nicer, a legend placement) go on the ticket as follow-up notes. Findings that break an acceptance criterion — anything clipped and unreachable, any vertical scrollbar, any blank widget, any oscillation — block the merge.
