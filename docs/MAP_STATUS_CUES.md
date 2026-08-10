# Map status cues: freshness + tile-rendering — Condensed design (#348, #352)

**Issues:** [#348](https://github.com/EnterpriseBT/portal-ai/issues/348) (freshness cue) + [#352](https://github.com/EnterpriseBT/portal-ai/issues/352) (tile-rendering cue) · Tasks · epic [#84](https://github.com/EnterpriseBT/portal-ai/issues/84) · **small / condensed**. Two ~10-line cues on the same widget (`MapWidget`), done together in one PR.

**Why.** `MapWidget` under-communicates two states `D3Widget`/the data-load path already show: (#348) **how fresh** the data is — the map refreshes (auto #270 + manual) but shows no "Updated ⟨time⟩ ago", so a stale map reads as current; (#352) that it's **actively rendering tiles** — it shows a spinner for the *data* fetch but goes silent while tiles fetch/render on pan/zoom and during #350's queued whole-valley load. Single package: `apps/web`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| MapWidget header (title/chip/refresh) | `MapWidget.component.tsx:259-294` | No "Updated X ago" cue (D3 has one at `D3Widget.component.tsx:139-147` via `lastUpdatedAt` + `DateFactory.relativeTime`). |
| `dataUpdatedAt` on the container | `MapWidget.component.tsx:439` | Already received (feeds `useWidgetRefresh`) — the timestamp #348 needs. |
| map-lifecycle effect (owns `maplibregl.Map`) | `MapWidget.component.tsx:148-256` | Where MapLibre `dataloading`/`idle` events wire for #352 (the UI component owns the map, like `internalTileStatus`). |
| controlled-vs-internal prop pattern | `tileStatus?` (`:66`) | Precedent: a prop overrides internal live state for tests/stories — reuse for #352's `tilesLoading`. |

## Decision — two props on `MapWidgetUI`, cues mirroring existing patterns

- **#348 — freshness cue.** Add `lastUpdatedAt?: number | null`; render *"Updated ⟨relativeTime⟩"* in the header (mirror `D3Widget`, `DateFactory.relativeTime` from `@portalai/core/utils`). The container passes the **`lastUpdatedAt` returned by `useWidgetRefresh`** (not the raw `dataUpdatedAt` prop) — the hook advances it on every successful refresh, so a manual/auto refresh flips the cue to "just now"; the raw prop never changes and would freeze the timestamp.
- **#352 — tile-rendering cue.** Add internal `tilesLoading` state set from MapLibre `dataloading` → true / `idle` → false in the map effect (tile path only), plus a controlled `tilesLoading?` prop override (mirroring `tileStatus`) for tests/stories. Render a small spinner + *"Rendering…"* caption while busy. `idle` is the natural debounce (fires once tiles settle), so no manual throttling.

Both are additive props; no container restructure, no change to the refresh mechanism or the existing notices.

## Plan — 1 slice

**Files**
- Edit `apps/web/src/modules/MapWidget/MapWidget.component.tsx` — import `DateFactory`; add `lastUpdatedAt?` + `tilesLoading?` to `MapWidgetUIProps`; header "Updated X ago" cue; `internalTilesLoading` state + `m.on("dataloading"/"idle")` in the effect + a "Rendering…" caption (`data-testid="map-widget-tiles-loading"`); container passes `lastUpdatedAt={lastUpdatedAt}` from `useWidgetRefresh`.
- Edit `apps/web/src/modules/MapWidget/__tests__/MapWidget.test.tsx` — tests below.

**Tests** (`cd apps/web && npm run test:unit`)
- `lastUpdatedAt` set → `map-widget-updated` shows "Updated …"; absent → not rendered.
- `tilesLoading` (controlled prop) true → `map-widget-tiles-loading` "Rendering…" shows; false/absent → not rendered.
- Regression: existing header (title/chip/refresh) + notice tests still pass.

## Smoke (manual, against your dev stack)

1. Render a map; note the header shows **"Updated ⟨time⟩ ago"**; after an auto/manual refresh the timestamp updates (#348).
2. Zoom out to the whole-valley view / pan deep: a **"Rendering…"** cue shows while tiles fetch+render (through #350's queue) and clears when the map settles (#352).
3. Regression: the simplified/partial/aggregated/timeout notices and the legend are unchanged; an inline (small) map needs no tile cue.

## Out of scope

- Per-tile progress bar / count (#352 is a single busy/idle cue).
- Changing the refresh cadence or the freshness model (that's #349).
