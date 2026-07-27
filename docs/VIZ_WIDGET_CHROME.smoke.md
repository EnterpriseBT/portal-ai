# viz-widget-chrome — Smoke Suite

Manual smoke test for [#271](https://github.com/EnterpriseBT/portal-ai/issues/271) — frames `d3` visualization widgets (title + status chip + #270 refresh) and bounds live sandboxed iframes by lazy-mounting/tearing down the render body around the viewport. **Branch under test:** `feat/viz-widget-chrome` (PR [#283](https://github.com/EnterpriseBT/portal-ai/pull/283), into `epic/d3-dashboard-widgets`).

Pure `apps/web` change — no API/DB/schema touched. This is a **visual + interaction** smoke: most checks are observed in the browser (Elements panel + scrolling), not in the DB.

## Preflight

### Environment

- [ ] `git checkout feat/viz-widget-chrome && git pull --ff-only`
- [ ] `npm install` (no new deps of note; no migration — pure client change)
- [ ] `npm run dev` boots cleanly (API :3001, web :3000); open http://localhost:3000 and sign in
- [ ] Open browser DevTools → **Elements** and **Console** panels (you'll inspect iframe mount/teardown and watch for errors)

### Fixtures

- [ ] A station whose data has the **asteroid dataset** loaded (10,000+ records) — the same set used for #270 smoke. Columns available include `absolute_magnitude_h`, `diameter_km_max`, `is_potentially_hazardous`, `name`.
- [ ] A portal session you can send prompts to and that renders `d3` visualization blocks inline.

### Reset between runs

- [ ] No reset needed — read-only from the app's side. To get a long-scroll session, just send several visualization prompts in one session (steps below). Refresh the browser to clear render state between runs.

## §1 — Widget frame + status chip (slice 2 · AC3)

- [ ] Prompt: **"Show a histogram of asteroid absolute_magnitude_h."** A `d3` widget renders.
- [ ] The widget is wrapped in an **outlined frame** (MUI `Paper variant="outlined"`, `data-testid="d3-widget"`) with a **header**: the title, an "Updated ⟨time⟩ ago" caption, and a refresh icon button (from #270).
- [ ] While the chart is computing/rendering, a small **status chip** is visible (e.g. "Rendering"); once rendered and current, the chip is **gone** (the `ready` state shows no chip — a clean framed chart with just the header).
- [ ] Click the refresh button. The chip shows a **refreshing/pending** state and the button is not double-fireable (disabled/spinner while the request is in flight — #270 behavior); when it settles, the "Updated" caption resets to "just now" and the chip clears.
- [ ] Leave the widget until its data ages past the freshness window (or reopen the session later): the widget presents a **stale** affordance (status chip reads stale and/or the inline refresh copy appears) — auto-refresh (when in view) clears it back to ready.

## §2 — Lazy-mount, teardown & placeholder (slice 3 · AC1, AC2, AC5)

Build a long session so widgets scroll well past one viewport apart.

- [ ] Send **4–5 visualization prompts** in the same session, e.g.:
  - "Histogram of asteroid `absolute_magnitude_h`."
  - "Scatter plot of `diameter_km_max` vs `absolute_magnitude_h`."
  - "Bar chart of count of asteroids by `is_potentially_hazardous`."
  - "Top 20 asteroids by `diameter_km_max` as a bar chart, labeled by `name`."
  - "Histogram of `diameter_km_max`."
- [ ] Each renders a framed `d3` widget; the session is now several viewports tall.
- [ ] In the **Elements** panel, search for `<iframe`. Confirm the number of **live sandbox iframes is bounded** — only widgets within roughly one viewport above/below the visible area have an `<iframe>`; widgets far offscreen do **not**. (The gate uses a `"100% 0px"` margin — one viewport band.)
- [ ] Scroll so an earlier widget goes **far offscreen** (more than a viewport away). In Elements, confirm that widget's `<iframe>` is gone and it now renders a `d3-widget-placeholder` `<div>` (a sized empty box) — **not** a collapsed/zero-height gap. **AC2/AC5.**
- [ ] Confirm **scroll position and layout stay stable** as widgets tear down — the placeholder holds the widget's last rendered height, so content below does not jump. **AC2.**
- [ ] Scroll that earlier widget **back into view**. Confirm it **re-mounts**: the `<iframe>` reappears and the chart **re-renders from its block content** (same chart), re-paging its data if it was handle-backed. **AC1.**
- [ ] (Bridge cleanup) With the Console open, scroll a widget out and back several times. Confirm **no accumulating errors** and no growing count of leaked iframes for the same widget (each teardown removes its iframe; each re-mount adds exactly one). **AC5.**

## §3 — Non-viz blocks unchanged (AC4)

- [ ] Prompt something that returns a **text** answer and a **data table** (e.g. "How many asteroids are potentially hazardous? Show the breakdown as a table.").
- [ ] Confirm the text block, the data-table block, and any mutation-result block render and behave **exactly as before** — they are **not** framed as widgets, get **no** status chip, and are **never** torn down/placeholdered when scrolled offscreen (search Elements: no `d3-widget-placeholder` appears for these blocks).

## §4 — Error & edge cases

- [ ] **Render error:** prompt a visualization that would error in the sandbox (e.g. an intentionally malformed request, or reuse a known-bad program if you have one). Confirm the widget frame stays, the status chip shows **error**, and the error is contained inside the frame (no app-level crash, no console flood).
- [ ] **Streaming/in-progress:** while a `d3` widget is first streaming in (before it has a durable `blockRef`), confirm it renders the **frame + in-progress status** with **no refresh button**, and — because it's at the bottom and in view — stays live (not placeholdered).
- [ ] **Fail-open:** the gating is presentation-only and fails open — if `IntersectionObserver` behaved oddly, widgets would stay mounted rather than hide. Confirm you never see a **permanently blank** widget that won't render when scrolled to (content is never hidden).

## Sign-off

- [ ] §1 verified (frame + status chip + refresh)
- [ ] §2 verified (bounded live iframes, teardown → placeholder, scroll-stable, re-mount on scroll-back, no bridge leak)
- [ ] §3 verified (non-viz blocks unchanged)
- [ ] §4 verified (error, streaming, fail-open)
- [ ] ⟨date⟩ ⟨name⟩ — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/session/block ids):
