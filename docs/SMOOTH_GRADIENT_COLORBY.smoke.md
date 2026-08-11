# smooth-gradient-colorby — Smoke Suite

Manual smoke test for [#336](https://github.com/EnterpriseBT/portal-ai/issues/336) — a third `colorBy` scale, **`interpolate`** (continuous gradient + gradient-bar legend), alongside `match`/`step`. **Branch under test:** `feat/smooth-gradient-colorby` (PR [#354](https://github.com/EnterpriseBT/portal-ai/pull/354), base `epic/gis-toolpack`).

## Preflight

### Environment

- [x] `git checkout feat/smooth-gradient-colorby && git pull --ff-only`
- [x] `npm install`
- [x] Rebuild core so the git-ignored dist carries the new `scale` field + `SEQUENTIAL_PALETTE`: `npm run build --workspace @portalai/core` (else web/api type-check against a stale dist). **No DB migration** — `scale` is JSON block content, not a column.
- [x] `npm run dev` boots cleanly (API :3001, web :3000)

### Fixtures

- [x] The `GIS smoke` station with the **parcels** connector from the epic smokes — it has a **numeric** column to shade (e.g. market value / acreage) and a **categorical** column (e.g. property class) for the regression check. A large/statewide layer is used for the tiled/aggregate step.

### Reset between runs

- [x] No reset needed — every step is a read-only visualization; re-prompt freely.

## §1 — Smooth gradient vs. discrete bands (AC1, AC3)

- [x] Prompt: *"map the parcels colored by market value **with a smooth gradient**"*
- [x] Expected: the parcels render as a **continuous colour blend** across the value range (not stepped bands); the legend is a **horizontal gradient bar** with the **min value on the left and max on the right** (testid `map-widget-legend-gradient`), not a row of discrete swatches.
- [x] Prompt (same column, default): *"map the parcels colored by market value"*
- [x] Expected: the parcels render as **discrete bands** (stepped colours) with a **swatch legend** (testid `map-widget-legend`) — the pre-#336 behaviour, unchanged.

## §2 — Agent routes "gradient" phrasing to interpolate (AC1; slice 5 surfaces)

- [x] Prompt: *"show the parcels with a continuous shading by acreage"* (a phrasing that isn't the literal word "gradient")
- [x] Expected: the agent chooses `colorBy.scale: "interpolate"` — the map renders a **continuous blend + gradient bar**, confirming the system-prompt/tool-description guidance landed (not a banded/step render).

## §3 — Large / tiled + aggregate layers (AC6)

- [x] Prompt a **large** numeric layer with a gradient, e.g. *"map every parcel in the state colored by market value with a smooth gradient"* so the result tiles.
- [x] Expected: at full zoom the **tiled features are shaded by the gradient** (not all grey / not all one colour) — the server `MIN/MAX` back-fill populated the ramp stops for the tile path.
- [x] **Zoom out** to the aggregate view: the **grid bins are coloured by the gradient** over each bin's value (interpolate applies to aggregate layers), and the view stays responsive.

## §4 — Regression: categorical + banded unchanged (AC5)

- [x] Prompt: *"map the parcels colored by property class"* (a string/categorical column)
- [x] Expected: **categorical colours** with a **swatch legend** — identical to pre-#336; no gradient bar.
- [x] Confirm the **default numeric** map from §1 (no "gradient" wording) still renders **bands + swatches**, and a map with **no `colorBy`** renders a solid colour.

## §5 — Error & edge cases (AC2, AC4 — the spec's Risks)

- [x] On a gradient map, confirm parcels with a **null / missing** value render the **neutral no-data colour** (grey), **never black** (a raw `interpolate` throwing on null would black the whole layer — the `case(has, …)` + `to-number` guard prevents it).
- [x] Prompt a gradient on a column that resolves to **fewer than two distinct numeric values**: the map **degrades gracefully** to a solid/step render — **no blank layer, no console expression error**.
- [x] (Optional) Prompt a gradient on a **non-numeric** column: it falls back to a **solid colour** (no stops), not a crash.

## Sign-off

- [x] Every section above verified
- [x] 2026-08-11 / Ben Turner — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro (prompt + column): · Identifiers (org/station/layer):
