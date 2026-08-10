# Map-widget flicker on unrelated re-renders — Condensed design (#341)

**Issue:** [EnterpriseBT/portal-ai#341](https://github.com/EnterpriseBT/portal-ai/issues/341) · Bug · epic [#84](https://github.com/EnterpriseBT/portal-ai/issues/84) · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** While any new visualization streams into a chat, every already-rendered **tiled** map flickers and refetches its tiles (pan/zoom/popup reset). Root cause is a single unstable input: the `MapWidget` container derives `rows` as a **new array literal every render**, which cascades through the `useMemo` that builds the MapLibre layers into the one `useEffect` that owns the map lifecycle — and that effect *destroys and recreates* the whole `maplibregl.Map` on any dependency change. So every parent re-render (constant during streaming) remounts every map. Single package: `apps/web`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| `rows` derivation | `apps/web/src/modules/MapWidget/MapWidget.component.tsx:500-502` | `freshInlineRows ?? (fresh == null && "rows" in parsedContent ? parsedContent.rows : [])` — for a **handle/tiled** map there are no inline rows, so this is a **new `[]` on every render**. |
| layer `useMemo` | `MapWidget.component.tsx:120-144` | deps `[spec, rows, isTile]`; recomputes (new `layerData`/`mlLayers`/`bounds` identities) whenever `rows` identity changes. |
| map-lifecycle `useEffect` | `MapWidget.component.tsx:148-256` | `new maplibregl.Map(...)` on run, `map?.remove()` on cleanup; dep array `:242-256` includes `rows`, `layerData`, `mlLayers`, `bounds`. |
| other effect deps (already stable) | — | `resolveTileUrl = resolveApiUrl` (module import, `:20`), `getTileToken` (memoized, `:466`), `onHeight = setLastHeight` (a `useState` setter, `MapWidgetGate.component.tsx:72`), `ctxId` (`useId`); `spec/mode/tileTemplate/isTile` are stable values. |

So `rows` is the **only** input that loses identity on an unrelated re-render — stabilize it and the effect stops re-running (hence remounting) except on genuine spec/data changes.

## Decision — stabilize `rows` identity (don't remount on unrelated re-renders)

Options weighed: **(A)** memoize `rows` with a shared empty constant so the effect's inputs are stable across re-renders; **(B)** the larger mount-once + incremental source/layer-update refactor (create the map once, `getSource().setData()` / re-point the tile source on change).

**Chosen: A.** It targets the exact, certain root cause (the per-render `[]`), is contained to the container, and low-risk. Extract a pure `pickMapRows(fresh, content)` that returns a module-level frozen `EMPTY_ROWS` for the no-inline-rows case (so the reference is stable even across recomputes), and memoize its call. After this, a tiled map's `useMemo` and lifecycle effect see stable inputs on every unrelated re-render → no remount, no tile refetch.

**(B) is an explicit non-goal here** — it only improves the *rarer* "genuine inline-data change still remounts" case (a refresh delivering new rows), which is intentional, not the reported flicker. If that ever matters, it's a separate, larger ticket. Recorded in Out of scope.

## Plan — 1 slice

**Files**
- Edit `apps/web/src/modules/MapWidget/utils/map-config.util.ts` — add `export const EMPTY_ROWS: Row[]` (frozen) and `export function pickMapRows(fresh, content): Row[]` (pure: inline-fresh rows → content rows → `EMPTY_ROWS`).
- Edit `apps/web/src/modules/MapWidget/MapWidget.component.tsx` — replace the inline `rows` derivation (`:500-502`) with `const rows = pickMapRows(fresh, parsedContent)`. A plain call suffices (and avoids a rules-of-hooks issue after the container's early return): `pickMapRows` returns only existing references — the shared `EMPTY_ROWS`, or `fresh.rows`/`content.rows` — never a fresh literal, so identity is already stable across renders.
- Edit `apps/web/src/modules/MapWidget/__tests__/map-config.util.test.ts` — tests below.

**Tests** (`cd apps/web && npm run test:unit`)
- `pickMapRows` returns the **same `EMPTY_ROWS` reference** (`toBe`) for a handle/no-rows content and for two separate calls (stable across renders).
- `pickMapRows` returns the inline rows array when `fresh` is an inline delivery, and the content's rows when present.
- (Guard) `EMPTY_ROWS` is empty and not mutated.

## Smoke (manual, against your dev stack)

1. On the `GIS smoke` station, render at least one tiled map (e.g. `"map the road network"`), pan/zoom it.
2. Ask for another visualization so a block streams in (a second map, or any streaming answer).
3. **Expected:** the existing map(s) **do not flicker or refetch tiles**, and pan/zoom/open-popup are preserved, while the new viz streams. (Before: all tiled maps remounted for the duration of the stream.)
4. Sanity: a genuine map refresh still updates normally; scrolling a map out of and back into view still mounts/unmounts via the viewport gate (unchanged).

## Out of scope

- The **mount-once + incremental source/layer update** refactor (option B) — larger architectural change; only affects the intentional remount-on-genuine-data-change case, not the reported flicker.
- Any upstream churn of the block **`content` reference** itself (if it were ever recreated per render, `spec` would churn too) — not observed; the certain per-render `[]` is the fix. If residual flicker appears in smoke, that's the next thread, separate ticket.
