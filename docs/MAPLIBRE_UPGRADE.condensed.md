# Upgrade maplibre-gl 4→6 (apps/web) — Condensed design (#548)

**Issue:** [EnterpriseBT/portal-ai#548](https://github.com/EnterpriseBT/portal-ai/issues/548) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `npm audit` (via the #545 workflow) flags a **critical** XSS advisory in `maplibre-gl` (`<=6.4.0`, sanitizer bypass in `DOM.sanitize()`). `apps/web` pins `maplibre-gl@^4.7.1`; the fix is a major bump to `^6.9.0` (two majors). Usage is contained to `src/modules/MapWidget/`. **Audit 11 → 10 — this clears the last critical (0 criticals remaining).**

## Current shape

| Piece | Location | Note |
|---|---|---|
| maplibre import | `MapWidget.component.tsx:5` | was `import maplibregl from "maplibre-gl"` (default) |
| Map API used | `MapWidget.component.tsx:161-233` | `new Map()`, `NavigationControl`, `Popup().setLngLat().setHTML()`, `addSource`/`addLayer` (cast `as never`), `on/jumpTo/fitBounds` |
| Custom tile protocol | `utils/tile-protocol.util.ts:150-171` | `addProtocol(scheme, (params, abortController) => Promise<{data}>)` — the v4+ promise form, unchanged in v6 |
| Popup fill | `utils/tile-source.util.ts:71` | `String(props[key])` — no `JSON.parse` on feature properties |
| Test mock | `__tests__/MapWidget.test.tsx:10` | `jest.unstable_mockModule("maplibre-gl", …)` |

## Decision — bump + adopt v6's ESM named-export shape

Bump to `^6.9.0`. Assessed the v4→v5→v6 breaking changes against MapWidget: most are **N/A** (no `instanceof` event checks, no `styleimagemissing`, no `map.transform`, WebGL2 is fine in real browsers, no `JSON.parse` on props to remove). Two apply: **(1)** v6 is ESM-only with **named exports** — the default import becomes `import * as maplibregl from "maplibre-gl"` (one line); **(2)** the test's mock returned everything under `default:`, so it's updated to named exports (`__esModule: true` + top-level `Map`/`addProtocol`/`Popup`/…), which is also more faithful to the real module. `addProtocol` signature is unchanged. `@astrojs`-style integration bumps: none needed.

## Plan — 1 slice

**Files**
- `apps/web/package.json` — `maplibre-gl` `^4.7.1` → `^6.9.0`.
- `package-lock.json` — regenerated.
- `MapWidget.component.tsx` — default import → `import * as maplibregl`.
- `__tests__/MapWidget.test.tsx` — mock to named-export (v6) shape.

**Tests** — `npm run --workspace @portalai/web type-check` (catches the import + Map/NavigationControl/Popup/StyleSpecification types), `npm run --workspace @portalai/web build` (Vite bundles v6 + its worker), the MapWidget suites (`--testPathPattern MapWidget` — 86 tests), lint. Green is the gate.

## Smoke (suites + live init check)

1. type-check · web build · MapWidget suites (86) · lint — all green. ✓
2. `npm audit` → `maplibre-gl` gone; **11 → 10, 0 criticals left**. ✓
3. Live (dev stack, authed): opened a portal with two real maps (400 customers + 15 sites). maplibre v6 **initializes error-free** — style/sprites/tiles.json load (200), attribution + `NavigationControl` render, `dataloading` events fire, **0 console errors** (no worker/`addProtocol`/WebGL2 failures). ✓
4. **Not automatable here:** the full WebGL tile *paint* doesn't complete under the container's headless software renderer (swiftshader — no frames, "GPU stall due to ReadPixels"). This is an environment limit, not a v6 issue. **Confirm the painted map on app-dev (real GPU) after deploy** — the one manual step.

## Out of scope

- The remaining #545 findings — all non-critical and tracked under #553 (storybook/exceljs/drizzle-kit/esbuild) and the uuid transitives.
