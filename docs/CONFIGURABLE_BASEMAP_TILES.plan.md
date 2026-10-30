# Configurable basemap tiles — Plan

**A TDD-sequenced implementation of the install-wide basemap setting. It starts with the fail-closed runtime reader and the pure style resolution, then wires the map widget's fallback and notice, then the Helm contract, and ends with the docs that stop recording CARTO/OSM as a fixed egress.**

Spec: `docs/CONFIGURABLE_BASEMAP_TILES.spec.md`. Discovery: `docs/CONFIGURABLE_BASEMAP_TILES.discovery.md`. Issue: #910 (residency epic #569). Builds on the shipped runtime `config.js` path (#566 renderer, #607 reader).

Five slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/910-configurable-basemap-tiles`**, giving one feature and one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly; `feedback_use_npm_test_scripts`):

```bash
cd apps/web && npm run test:unit -- --testPathPattern <file>
cd packages/core && npm run test:unit -- --testPathPattern subprocessors
npm run lint:helm            # from the repo root
```

Each slice: (1) write failing tests; (2) make the smallest change that turns them green; (3) run the focused tests; (4) run `npm run lint && npm run type-check` in the touched package(s) at the boundary; (5) move to the next slice.

Sequencing rationale: everything is pure logic until slice 3, so the riskiest wiring sits on proven pieces.

- **Slice 1:** the runtime keys and `readInstallBasemap`. This is the only producer of `InstallBasemap`, which every later slice consumes.
- **Slice 2:** `resolveBasemapStyle(…, install)` + `emptyBasemapStyle`. Pure functions with a defaulted third argument, so the existing caller compiles unchanged.
- **Slice 3:** `MapWidgetUI`: the `style.load` move, the fallback and timeout, the notice, and the container wiring. This is the one slice with runtime risk (spec "Risks"), so it ends with a browser check before anything is built on it.
- **Slice 4:** Helm values, schema and ConfigMap. Independent of 2–3 but sequenced after them, so the chart's `none` default ships only once the web side renders `none` correctly.
- **Slice 5:** doc sync (README, security review, guard comment, subprocessor copy). It goes last because it describes what slices 1–4 shipped.

No migration or seed.

---

## Slice 1 — Runtime keys + fail-closed reader

The image gains the four `BASEMAP_*` keys, and the SPA gets a typed, fail-closed reader for them. Nothing consumes the reader yet.

**Files**

- Edit: `apps/web/scripts/render-config.mjs`: add the four keys to `RUNTIME_KEYS` and `BASEMAP_MODE: "default"` to `DEFAULTS`.
- Edit: `apps/web/public/config.js`: add the four keys with SaaS defaults, in key order.
- Edit: `apps/web/src/utils/runtime-config.util.ts`: add `InstallBasemap`, `InstallBasemapResult`, `readInstallBasemap` and the memoized `getInstallBasemap`, which warns once.
- Edit: `apps/web/src/__tests__/render-config.test.ts` (+3), `apps/web/src/__tests__/runtime-config.util.test.ts` (+11).

**Steps**

1. **Tests (spec § TDD: render-config ×3, runtime-config ×11).**
   - Render defaults, passthrough and key order. The `public/config.js` key set must match `renderConfigJs({})`: read the file as text and evaluate it against a stub `window`.
   - One `readInstallBasemap` case per row of the spec's parsing table.
   - `getInstallBasemap` warns once. Use a fresh module import per test so the memo resets.
   - Run them and confirm they fail.
2. **Implement** the keys and the parser. URL check: `new URL(v)` inside a try, with `protocol ∈ {"http:","https:"}`. Turn the tests green.
3. Lint + type-check (`apps/web`).

**Done when:** all 14 cases pass, the existing render-config and runtime-config cases still pass, and nothing outside the tests imports `readInstallBasemap`.

**Risk:** the memo in `getInstallBasemap` can leak between tests. Isolate with `jest.isolateModulesAsync` or a `__resetForTests` export (prefer isolation).

---

## Slice 2 — Basemap style resolution

`resolveBasemapStyle` honours the install setting, and the empty style exists.

**Files**

- Edit: `apps/web/src/modules/MapWidget/utils/map-config.util.ts`:
  - add `BASEMAP_LOAD_TIMEOUT_MS`, `EMPTY_BG` and `emptyBasemapStyle(mode)`;
  - give `resolveBasemapStyle` a third parameter, `install: InstallBasemap = { mode: "default" }`;
  - add a private `rasterStyle(url, attribution)` helper for XYZ templates.
- Edit: `apps/web/src/modules/MapWidget/__tests__/map-config.util.test.ts` (+10).

**Steps**

1. **Tests (spec § TDD: map-config ×10).**
   - The existing three cases run untouched (no third argument).
   - `none` overrides every spec value.
   - `custom` light/dark selection, plus the dark fallback to the light URL.
   - A spec `{url}` is ignored under `custom`.
   - XYZ wrapping with and without attribution.
   - The shape of the empty style.
   - Run them and confirm they fail.
2. **Implement.** `EMPTY_BG` comes from the brand themes' `palette.background.default`. If `@portalai/core` doesn't export the theme JSON in a form web can import synchronously, use two named constants with a comment pointing at the theme files. Don't add a new core export for one colour pair. Turn the tests green.
3. Lint + type-check.

**Done when:** all 10 cases pass. `MapWidget.component.tsx` is unchanged and still compiles, because it relies on the defaulted parameter.

**Risk:** none; this is pure code.

---

## Slice 3 — Map widget fallback, notice and wiring

The container passes the install setting. Data layers attach on `style.load`. A style error or timeout before the first `style.load` swaps to the empty style and shows "Basemap unavailable".

**Files**

- New: `apps/web/src/modules/MapWidget/BasemapUnavailableNotice.component.tsx`: a pure UI overlay with `role="status"`.
- New: `apps/web/src/modules/MapWidget/__tests__/BasemapUnavailableNotice.test.tsx` (+1).
- Edit: `apps/web/src/modules/MapWidget/MapWidget.component.tsx`:
  - add the `installBasemap` prop on `MapWidgetUIProps`, with `getInstallBasemap()` passed from the container;
  - move the data-layer body from `load` to `once("style.load")`, extracting it into a local `attachData()`;
  - add the `styleLoaded`/`fellBack` flags, the `error` handler, the timeout and its cleanup;
  - add the `basemapUnavailable` state and render the notice.
- Edit: `apps/web/src/modules/MapWidget/__tests__/MapWidget.test.tsx` (+7). The MapLibre mock gains captured constructor options, `on`/`once` registries with `emit`, and a `setStyle` spy. Existing cases that rely on `on()` being a no-op must still pass.
- Edit: `apps/web/src/modules/MapWidget/stories/MapWidget.stories.tsx`: add `NoBasemap` (`installBasemap: none`) and `BasemapUnavailable` (custom URL pointing at an unreachable host).
- Edit: `apps/web/src/modules/MapWidget/index.ts` only if the barrel exposes UI pieces by convention.

**Steps**

1. **Tests (spec § TDD: MapWidget ×7, notice ×1).**
   - Constructor style under `none` and under `custom`.
   - An error before `style.load` falls back (`setStyle` + notice + `console.error`).
   - Layers attach after the fallback's `style.load`.
   - Timeout via fake timers.
   - An error after `style.load` is ignored.
   - `none` + error shows no notice.
   - Unmount clears the timer.
   - Run them and confirm they fail.
2. **Implement** the notice, then the effect changes. Keep the `addLayer` try/catch → `setRenderError` behaviour exactly as it is. Turn the tests green.
3. Lint + type-check, and run the whole MapWidget test folder (the mock changed under the existing cases).
4. **Browser check (the gate for this slice, spec "Risks").** Against the dev stack, using a local `public/config.js` edit that is **not committed**:
   - `custom` pointing at an unreachable host;
   - `custom` pointing at a URL that serves invalid JSON;
   - `none`;
   - unset (CARTO), on a points map, a polygon map, a vector-tile map and a popup.

   Confirm that `style.load` fires after the fallback's `setStyle` and the data layers render. If it doesn't fire, switch the fallback to rebuilding the map with `emptyBasemapStyle` before committing, and note the deviation in the spec.

**Done when:** the 8 cases and the existing MapWidget suite pass, and the browser check passes in all four configurations.

**Risk:** this slice carries the highest risk on the branch.
- MapLibre 6.x `style.load` semantics after a failed initial style (mitigated by step 4).
- SaaS layers now attach before the basemap tiles finish. The visual result is the same, but the `fitBounds` timing changes; the browser check covers it.

---

## Slice 4 — Helm contract

The chart exposes `web.basemap`, defaults to `none`, and rejects bad values at install time.

**Files**

- Edit: `deploy/helm/portalai/values.yaml`: add the `web.basemap` block with its comment (spec § Helm).
- Edit: `deploy/helm/portalai/values.schema.json`: add `web.properties.basemap` (closed object, mode enum, URL pattern, `if custom then styleUrl minLength 1`).
- Edit: `deploy/helm/portalai/templates/configmap.yaml`: add the four `BASEMAP_*` keys.
- Edit: `scripts/check-helm.mjs` (+4 scenarios).

**Steps**

1. **Tests (spec § TDD: check-helm ×4).**
   - The default scenario asserts `BASEMAP_MODE: "none"`.
   - A custom scenario asserts both keys render.
   - Two failing-render scenarios: custom without a URL, and `mode=off`. Follow the file's existing pattern for an expected `helm template` failure. If it has none, add one: assert a non-zero exit and that the schema error names the field.
   - Run `npm run lint:helm` and confirm it fails.
2. **Implement** the values, schema and ConfigMap. Turn the scenarios green.
3. Run `npm run lint:helm`. No TypeScript is touched.

**Done when:** all `lint:helm` scenarios pass, old and new.

**Risk:** a JSON-schema `if/then` inside a property that allows `additionalProperties` elsewhere. Check that helm's validator honours it (the failing scenario proves this).

---

## Slice 5 — Documentation sync

Every surface that called CARTO/OSM a fixed egress now describes the three modes.

**Files**

- Edit: `deploy/helm/portalai/README.md`: rows in the values table (`:57-85`). The egress section (`:166-168`) explains the modes, the `none` default and the CORS note for `custom`.
- Edit: `docs/DEPLOYMENT_SECURITY_REVIEW.md`: the §1 row (`:41`), guard note (`:45`), §2 row (`:58`), the SaaS record (`:127/:129/:140`), and a "Basemap mode / tile host" field in the residency review record.
- Edit: `apps/web/src/__tests__/subprocessor-browser-egress.guard.test.ts`: header comment (`:12-14`) only.
- Edit: `packages/core/src/content/subprocessors.util.ts`: the `usedWhen` suffix on `carto` and `openstreetmap`.

**Steps**

1. **Tests.** No new cases. Run the guards that pin these surfaces:
   - `subprocessor-browser-egress.guard.test.ts` (web);
   - `subprocessors.util.test.ts` (core);
   - `permission-copy.guard.test.ts` (api + web; both scan the durable docs);
   - `npm run lint:doc-pointers` (root).

   If `subprocessors.util.test.ts` pins `usedWhen` text, update the expectation in the same commit.
2. **Edit** the copy. Turn the guards green.
3. Lint + type-check `packages/core` and `apps/web`. Because core changed, also run the **full root `npm run build`**: `subprocessors.util.ts` renders on the marketing site (`apps/site`), and the per-package checks miss downstream consumers (memory: core model change → full build).

**Done when:** the guards pass, the root build passes, and no doc still says "no override yet (#910)" (`grep -rn "#910" docs deploy` finds only intentional references).

**Risk:** the `usedWhen` copy is public on the marketing site's security and privacy pages. Keep it a statement of what ships.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | `BASEMAP_*` runtime keys + `readInstallBasemap` | 14 jest cases |
| 2 | `resolveBasemapStyle(install)` + `emptyBasemapStyle` | 10 jest cases |
| 3 | Widget fallback/timeout/notice + container wiring | 8 jest cases + browser check |
| 4 | Helm `web.basemap` (default `none`) + schema | 4 `lint:helm` scenarios |
| 5 | README, security review, guard comment, subprocessor copy | existing guards + root build |

Total ≈ 36 cases, matching the spec.

## Cross-slice notes

- **`InstallBasemap` spans slices 1–3.** It's defined once in `runtime-config.util.ts` and imported elsewhere; it is never redeclared.
- **Never commit a local `public/config.js` edit made for testing.** Only slice 1's defaults change in that file.
- **Prettier runs on commit through lint-staged.** `scripts/` and `deploy/` aren't in its globs, so format `check-helm.mjs` by hand to match the file's style.
- **Before pushing**, run the full root `npm run build && npm run type-check && npm run lint`, because Static Checks gates all three, and slice 5 touches core.
- **Doc sync is slice 5, but the CLAUDE.md surfaces table needs no change**: there is no new convention. If the spec deviates in slice 3 (rebuild instead of `setStyle`), update the spec doc in that slice's commit.
- **Smoke afterwards** (`/smoke 910`) inherits slice 3's browser configurations as agent-walkable steps. The Helm `none` default is a backend step (`helm template`), not a browser walk.

## Next step

Implementation begins on this branch with slice 1, tests first, one commit per slice, once discovery, spec and plan are confirmed.
