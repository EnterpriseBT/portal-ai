# d3-widget-overflow — Smoke Suite

Manual smoke test for [#278](https://github.com/EnterpriseBT/portal-ai/issues/278) — the D3 widget now sizes itself from its **painted extent** instead of its DOM box: it fits its whole visualization vertically, scrolls horizontally when a chart is intrinsically wider than its column, and tracks the container width for the life of the mount.

**Branch under test:** `fix/d3-widget-overflow` (PR [#289](https://github.com/EnterpriseBT/portal-ai/pull/289)).

Because the in-frame measurement can't be meaningfully unit-tested (jsdom has no layout, no `getBBox`), **this walkthrough is the primary verification of the core mechanism**. Expect to refine geometry here rather than treat the first oddity as a failed slice.

## Preflight

### Environment

- [x] `git checkout fix/d3-widget-overflow && git pull --ff-only`
- [x] `npm install` — no migration on this branch (client-side layout + one prompt string; **no DB change**)
- [x] `npm run dev` boots cleanly — web http://localhost:3000, API http://localhost:3001
- [x] Hard-reload the browser (⇧⌘R / Ctrl-Shift-R) — the sandbox `srcdoc` and its CSS are bundled, so a cached bundle will smoke the *old* frame

### Fixtures

- [x] Signed in as your local dev user, with the station that carries the **asteroid dataset — 10,254 rows** (columns: `absolute_magnitude_h`, `date`, `diameter_{km,m,feet,miles}_{min,max}`, `id`, `is_potentially_hazardous`, `miss_distance_{km,miles,lunar,astronomical}`, `name`, `velocity_{kps,kph,mph}`)
- [x] The `visualize` toolpack is enabled for that station
- [x] A second, smaller entity (~1,460 rows) is available for the compact-chart cases

### Reset between runs

- [x] No reset needed — every step is a fresh portal turn; nothing here writes app data. Start a **new portal session** per section so the feed stays short enough to judge scroll behavior.

### What to watch in EVERY step below

- [x] **No vertical scrollbar on a widget, ever** — not on the widget frame, not inside the iframe. This is the invariant; a vertical scrollbar anywhere is a bug even if the chart looks complete.
- [x] Nothing is cut off: axis labels, tick labels, legends, node labels, and the outermost marks are all fully visible (or reachable by horizontal scroll).
- [x] **Every widget SETTLES.** It reaches a size and stays there — no repeated expand/collapse, no creeping growth over successive redraws. Three separate feedback loops were found here during the first walk (measurement reading back its own applied shift; the parent reacting to its own frame's growth; the sizing wrapper double-clipping), and **none of them are catchable by the unit tests** — the sandbox is asserted at source-string level only. Watching for oscillation is therefore the single highest-value check in this document.
- [x] **No refresh storm.** An oscillating widget re-renders, and `useWidgetRefresh` auto-refreshes on mount when data is stale — so a loop surfaces as repeated `/api/portal-sql/widget-refresh` calls and eventually `VIZ_REFRESH_RATE_LIMITED` in the console. A rate-limit error is a *symptom of a sizing loop*, not a rate-limiter bug.

---

## §1 — The reported regressions (spec AC 1, 6)

The two charts from the issue's repro. These are the acceptance bar.

- [x] Prompt: *"Sankey diagram flowing size bucket → hazard class → miss-distance bucket."*
- [x] All node labels on **every** column are fully visible, including the right-most column's; nothing is clipped at the frame edge
- [x] Prompt: *"Beeswarm of velocity_kps for hazardous vs non-hazardous, force-simulated so nothing overlaps."*
- [x] **Both** swarms are complete — no cut-off sliver at the bottom of either (this was the silent vertical clip)
- [x] Both category labels are fully readable
- [x] Neither chart oscillates, flickers, or grows repeatedly after settling — it reaches its size within about one redraw and stays there

## §2 — Wide & label-dense forms → horizontal scroll (spec AC 2, 3)

Each of these is intrinsically wider than the chat column or carries long labels. **Expected in every case:** a horizontal scrollbar on the widget, every part reachable by scrolling, and no vertical scrollbar.

- [x] *"Horizontal bar chart of the 30 largest asteroids by diameter_km_max, with the full asteroid name on the axis."* — long names are fully readable, not truncated or clipped
- [x] *"Grouped bar chart of monthly close-approach counts split by hazard class, across the whole date range."* — many x categories; all tick labels legible
- [x] *"Heatmap of month against velocity_kps decile, counting approaches."* — all column headers and row labels visible
- [x] *"Treemap of hazard class then size bucket, sized by count, with labels inside each tile."* — tile labels not clipped at the right edge
- [x] *"Scatter of absolute_magnitude_h against miss_distance_km, log scale, coloured by hazard class, with a legend."* — the **legend is fully visible** and not overlapping the marks
- [x] *"Chord diagram of size bucket against miss-distance bucket."* — outer labels around the full circle are all present
- [x] Scroll one of the above fully right, then left — the chart stays put (no re-layout jump mid-scroll)

## §3 — Tall forms → fits vertically, unbounded (spec AC 3)

- [x] *"Small multiples: one histogram of velocity_kps per size bucket, stacked vertically."* — every facet is visible; the widget is as tall as it needs to be
- [x] *"Lollipop chart ranking the 60 closest approaches by miss_distance_km."* — all 60 rows present, none cut off
- [x] *"Box plot of miss_distance_km per month for the full range."* — whiskers and outliers at both extremes are visible, not clipped at top or bottom
- [x] *"Violin plot of velocity_kps by hazard class."* — the full violin outline, top and bottom, is visible
- [x] For each: the page scrolls (normal chat scrolling), but **the widget itself never scrolls vertically**
- [x] The widget's own chrome (title, status chip, refresh button, "Updated … ago") is not overlapped by the chart's marks

## §4 — Compact forms → no over-growth (spec AC 2)

The reverse failure: a small chart must still fill its column and must not be stretched or given a phantom scrollbar.

- [x] *"Donut chart of hazardous vs non-hazardous, with a legend beside it."* — fills the column width; no horizontal scrollbar (nothing to scroll)
- [x] *"Line chart of mean miss_distance_km by month."* — spans the full column width
- [x] *"Single big number: the count of potentially hazardous asteroids."* — a small widget, not a 360px-tall empty box with a tiny number
- [x] None of the three shows a scrollbar in either axis

## §5 — Responsive reflow (spec AC 4, 5, 6)

The slice-3 behavior. Use one chart with visible layout sensitivity — a grouped bar or the horizontal-bar case from §2.

- [x] With a chart on screen, **drag the browser window narrower** — the chart re-lays-out at the new width (bars re-space, labels re-fit); it does not just get visually squashed or clipped
- [x] **Drag it back wider** — the chart returns to its original layout
- [x] During the drag the widget stays responsive (no freeze, no flicker storm) — resizes are coalesced to one per frame
- [x] Narrow the window to a **chat column under 640px** and prompt for a new chart — it lays out for the real narrow width, not a 640px fallback that overflows
- [x] Open/close any side panel or the browser devtools docked to the side — the chart reflows to the new column width
- [x] Browser zoom to 150%, then back to 100% — the chart re-fits at each level with no clipping
- [x] A chart that was horizontally scrolling: narrow the window further — it still scrolls, and the scrollable extent grows rather than the content being clipped
- [x] After any resize, the chart **settles** — no repeated growth (frame getting wider and wider each redraw) and no oscillation

## §6 — Large data & progressive rendering (spec AC 7)

- [x] Prompt a chart over the **full 10,254 rows** (e.g. *"Scatter of velocity_kps against miss_distance_km for all asteroids."*)
- [x] The "Rendering N of 10,254 rows…" caption appears while batches stream, then goes away
- [x] The widget resizes as batches arrive **without** flicker, jumping, or the page scroll position lurching
- [x] The finished chart is correctly sized — not still at the initial 360px height, and not clipped
- [x] Rendering stays responsive throughout (the measurement is per-redraw; a visible stall here is the thing to report)

## §7 — Interop with the shipped epic (spec AC 7)

Nothing from #268–#273 may regress.

- [x] **Refresh (#270):** click a widget's refresh button — it re-runs, and the re-rendered chart is correctly sized (not reverted to a clipped or 360px state)
- [x] **Lazy mount/teardown (#271):** scroll a tall widget far offscreen, then scroll back — it re-renders, and **the scroll position does not jump** (the placeholder held its real height)
- [x] Scroll past several widgets in a long session and back — no accumulating layout drift
- [x] **Theme:** switch light ↔ dark with charts on screen — they re-render at the correct size in both themes
- [x] **Error card (#268):** prompt something that fails codegen (e.g. *"chart the colour of each asteroid's mood"*) — the error card renders in place of the chart, correctly sized, with no scrollbars
- [x] **Pin gating (#273):** hovering a chart widget still shows **no** pin icon; text and data-table blocks still do

## §8 — Codegen guidance (slice 4)

Checks the prompt change is having its intended effect on *newly generated* programs.

- [x] Prompt a chart with genuinely long category labels (e.g. *"bar chart of approach counts by asteroid name for the 20 closest approaches"*) — the generated program leaves room for the labels rather than clipping them at a 40px margin
- [x] Prompt a chart that needs a legend (*"stacked area of monthly counts by size bucket, with a legend"*) — the legend has its own space and doesn't overlap the plot
- [x] Nothing regressed in the basics: charts still clear and redraw idempotently as data streams (no doubled marks, no ghosting)

## §9 — Error, edge, and known-limitation cases

- [x] **Measurement fail-open:** no chart should ever render *blank* because of sizing. If one does, that's the highest-severity finding here — the fallback is meant to degrade to the old (possibly cropped) behavior, never to nothing
- [x] **Negative-coordinate content is shifted into view** (was a documented limitation until the first smoke walk found it in the standard rotated-tick-label idiom): a chart painting marks left of / above the origin has its content shifted right/down so nothing is clipped. The chart's position moves; that's expected and is the trade against being unreachable
- [x] **No `ResizeObserver`:** in devtools console run `Object.defineProperty(window, 'ResizeObserver', { value: undefined })`, hard-reload is **not** needed for already-mounted widgets — instead run it, then prompt a new chart. It renders at mount width (degraded: no reflow on resize) and does **not** throw or blank
- [x] Very small window (e.g. 400px wide): charts still render and scroll rather than collapsing to zero width
- [x] Rapid-fire: prompt two charts in quick succession — both size correctly and independently

## Findings from this walk

Three defects were found and **fixed on this branch** before sign-off. All three were sizing feedback loops — the class of bug the unit tests structurally cannot see (the sandbox is asserted at source-string level), which is why they reached a human.

| # | Found in | Defect | Fix |
|---|---|---|---|
| 1 | §1 case 3, §2 case 4, §2+3 case 11 | Content escaping the SVG viewport was clipped a **second** time by the body box, so the frame grew to the right size and the content stayed invisible | `7326c6a7` — grow `#root` to the measured extent |
| 2 | §2 case 4 (rotated tick labels) | Content at **negative** coordinates unreachable by growing. Recorded in the spec as an out-of-scope limitation; the walk proved it is the *common* case (the standard d3 rotated-label idiom lands there) | `c2f69d5f` — pad `#root` by the overshoot; spec deferral recorded as resolved |
| 3 | §9 case 8 | Widget **oscillated** grown↔collapsed continuously, storming the refresh endpoint into `VIZ_REFRESH_RATE_LIMITED`. Two paths: measurement read back its own applied shift; the parent observer reacted to its own frame's growth | `28d7517d` — compensate for the applied shift; width-only observer guard |

Two tests written alongside those fixes were themselves wrong in ways only a real engine exposes — one asserted an inline `overflowY: "visible"` the browser computed as `auto`, the other asserted a weaker fixed point (same width re-sent) than the correct one (nothing sent). Both passed while the bug was live. **Follow-up filed: #290** — executable browser tests for the sandbox (sizing + convergence), so this class of bug becomes a CI failure instead of a smoke finding.

No finding was left open. #290 is infrastructure, not a defect, and does not block this merge.

## Sign-off

- [x] Every section above verified against my own running stack
- [x] Any bugs found are filed (template below) with a decision on whether each blocks merge
- [x] **Ben Turner, 2026-07-27** — confirmed

Walked against a local dev stack on 2026-07-27. §1–§4 were verified case-by-case against the seeded sizing bench (11 hand-written `d3` programs, each isolating one sizing case, so the host fix was tested independently of codegen variance); §5–§9 confirmed section-by-section, including the 10,254-row progressive case and the real-agent codegen checks. The three defects above were fixed and re-verified mid-walk. Boxes were transcribed by the assistant from that confirmation — the walk and the judgement were the author's.

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
