# Configurable basemap tiles — Spec

**Issue:** [EnterpriseBT/portal-ai#910](https://github.com/EnterpriseBT/portal-ai/issues/910) · **Discovery:** `docs/CONFIGURABLE_BASEMAP_TILES.discovery.md`

This spec pins the install-wide basemap setting: four runtime `config.js` keys, the typed reader and its fail-closed parsing, the change to `resolveBasemapStyle` that lets the install override a spec's basemap, the empty no-basemap style, the `MapWidgetUI` fallback and its "Basemap unavailable" notice, and the `web.basemap` Helm block with its schema.

## Key decisions (flag for review)

1. **Mode + URLs, not a sentinel URL (D1).** `BASEMAP_MODE` is `default | custom | none`. `custom` reads `BASEMAP_STYLE_URL`, plus optional `BASEMAP_STYLE_URL_DARK` and `BASEMAP_ATTRIBUTION`.
2. **A custom URL is a style JSON or a raster XYZ template (D2).** A URL containing `{z}` is wrapped in a raster style.
3. **The install wins (D3, PRD gate).** Under `custom` or `none`, the spec's `basemap` is ignored entirely, `{url}` included. Under `default` the behaviour is byte-for-byte today's.
4. **Fail closed on egress, fail open on rendering (D4).** An unknown mode, or `custom` without a valid absolute `http(s)` URL, resolves to `none` with one console warning. It never falls back to CARTO. `values.schema.json` rejects the same mistakes at `helm install`.
5. **Data never waits on the basemap (D5).** Data layers move from `load` to `style.load`. An `error` before the first `style.load`, or `BASEMAP_LOAD_TIMEOUT_MS` (10s) without one, switches to the empty style and shows the notice. Tile errors after `style.load` are only logged.
6. **The image and the chart have different defaults (discovery Q1, confirmed).** The image's `render-config.mjs` and `public/config.js` default to `default`, so SaaS is unchanged. The Helm chart defaults `web.basemap.mode` to `none`.
7. **No change to the core contract, the agent tool or the prompt (Q3).** `MapBasemapSchema`, stored pins and `visualize-map.tool.ts` are untouched. The override happens only at render time.
8. **The notice appears only for a fallback (Q5).** `none` is a choice, so it shows no notice.

## Scope

### In scope
- Runtime keys in `render-config.mjs`, `public/config.js` and the `runtime-config.util.ts` reader.
- `resolveBasemapStyle` gains the install argument; new `emptyBasemapStyle`.
- The `MapWidgetUI` fallback, timeout and notice. The container passes the install setting.
- The Helm `web.basemap` values, schema, ConfigMap and `check-helm` scenarios.
- Docs: Helm README, `DEPLOYMENT_SECURITY_REVIEW.md`, the egress guard's header comment, and the `subprocessors.util.ts` `usedWhen` copy.

### Out of scope
- A browser CSP (`connect-src`/`img-src`). That needs its own ticket.
- Authenticated tile servers (`transformRequest`), root-relative style URLs, and per-org overrides.
- Hosting a tile server in the chart.
- The spec-level `carto-light`/`carto-dark` theme quirk.

## Surface

### Runtime config renderer — `apps/web/scripts/render-config.mjs`

```js
const RUNTIME_KEYS = [
  "AUTH_PROVIDER", "OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_AUDIENCE", "DEPLOY_MODE",
  "BASEMAP_MODE", "BASEMAP_STYLE_URL", "BASEMAP_STYLE_URL_DARK", "BASEMAP_ATTRIBUTION",
];
const DEFAULTS = { AUTH_PROVIDER: "auth0", DEPLOY_MODE: "saas", BASEMAP_MODE: "default" };
```

Values pass through unchanged. Validation belongs to the reader, which is the one place that has to handle hand-edited files. The header's SECURITY note still holds: all four values are public. `render-config.d.mts` is unchanged.

`apps/web/public/config.js` gains `"BASEMAP_MODE":"default","BASEMAP_STYLE_URL":"","BASEMAP_STYLE_URL_DARK":"","BASEMAP_ATTRIBUTION":""`, in `RUNTIME_KEYS` order.

### Reader — `apps/web/src/utils/runtime-config.util.ts`

```ts
export type InstallBasemap =
  | { mode: "default" }
  | { mode: "none" }
  | { mode: "custom"; styleUrl: string; styleUrlDark: string | null; attribution: string };

export interface InstallBasemapResult {
  basemap: InstallBasemap;
  /** Why the raw config was rejected (→ `none`); null when it parsed as given. */
  problem: string | null;
}

/** Pure parse of the BASEMAP_* keys. Fail-closed: never yields CARTO on bad input. */
export function readInstallBasemap(source: Record<string, unknown> | undefined): InstallBasemapResult;

/** Live accessor over window.__RUNTIME_CONFIG__; memoized; console.warn(problem) once. */
export function getInstallBasemap(): InstallBasemap;
```

Parsing rules (every value is `.trim()`med first):

| `BASEMAP_MODE` | Other keys | Result | `problem` |
|---|---|---|---|
| unset / `""` / `default` | ignored | `{mode:"default"}` | null |
| `none` | ignored | `{mode:"none"}` | null |
| `custom` | `STYLE_URL` an absolute `http:`/`https:` URL | `{mode:"custom", styleUrl, styleUrlDark, attribution}` | null |
| `custom` | `STYLE_URL` missing, unparseable or another scheme | `{mode:"none"}` | names the key |
| `custom` | `STYLE_URL_DARK` set but invalid | custom with `styleUrlDark: null` | names the key |
| anything else (`off`, `None`…) | — | `{mode:"none"}` | names the value |

Mode matching is case-sensitive, so `None` is unknown and resolves to `none`. A URL is checked with `new URL(v)` and `protocol ∈ {"http:","https:"}`. The `{z}`/`{x}`/`{y}` placeholders don't affect parsing. `RuntimeConfig` and `readRuntimeConfig` stay unchanged: the basemap is a separate reader, so auth consumers don't depend on it.

### Basemap resolution — `apps/web/src/modules/MapWidget/utils/map-config.util.ts`

```ts
export const BASEMAP_LOAD_TIMEOUT_MS = 10_000;

/** No sources (so attribution credits nobody) + one theme-coloured background layer. */
export function emptyBasemapStyle(mode: "light" | "dark"): Record<string, unknown>;

export function resolveBasemapStyle(
  basemap: MapBasemap,
  mode: "light" | "dark",
  install: InstallBasemap = { mode: "default" }
): string | Record<string, unknown>;
```

- `emptyBasemapStyle` returns `{ version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": <EMPTY_BG[mode]> } }] }`. `EMPTY_BG` takes `palette.background.default` from the brand theme JSONs in `@portalai/core` (light/dark).
- `install.mode === "default"` gives exactly today's mapping (`:627-634`).
- `install.mode === "none"` gives `emptyBasemapStyle(mode)`.
- `install.mode === "custom"`: `url = mode === "dark" && styleUrlDark ? styleUrlDark : styleUrl`. If `url` contains `{z}`, it returns `{ version: 8, sources: { basemap: { type: "raster", tiles: [url], tileSize: 256, attribution } }, layers: [{ id: "basemap", type: "raster", source: "basemap" }] }`, with `attribution` omitted when it is empty. Otherwise it returns `url`.

### Map widget — `apps/web/src/modules/MapWidget/MapWidget.component.tsx`

- `MapWidgetUIProps` gains `installBasemap?: InstallBasemap` (default `{mode:"default"}`). The container `MapWidget` passes `getInstallBasemap()`, so the UI component stays pure.
- The construction call is `style: resolveBasemapStyle(spec.basemap, mode, installBasemap)`.
- The data-layer code currently in `m.on("load", …)` moves to `m.once("style.load", …)` with the same body. A fallback re-registers it after `setStyle`, so the layers are added exactly once, onto whichever style loaded.
- Fallback state, local to the effect: `styleLoaded = false` and `fellBack = false`. `fallback(reason)` runs only when `!styleLoaded && !fellBack && installBasemap.mode !== "none"`. It sets `fellBack`, logs `console.error("[map] basemap unavailable", reason)`, calls `m.setStyle(emptyBasemapStyle(mode))`, and sets `basemapUnavailable` to true.
  - It is triggered by `m.on("error", e)` before the first `style.load`, or by `setTimeout(BASEMAP_LOAD_TIMEOUT_MS)`.
  - The timer is cleared on `style.load` and in the effect cleanup.
  - An `error` after `style.load` is only logged (`console.warn`) and never triggers the fallback.
- New state `basemapUnavailable`, reset to `false` at the start of each effect run (alongside `setRenderError(null)`).
- When `basemapUnavailable` is true, `<BasemapUnavailableNotice />` renders inside the map container's positioned box.

### Notice — `apps/web/src/modules/MapWidget/BasemapUnavailableNotice.component.tsx` (new)

A pure UI component with no props: `BasemapUnavailableNotice`. It renders a small absolutely positioned overlay in the bottom-left corner (it never shifts layout) with the text **"Basemap unavailable"** and `role="status"`. The colours come from the theme (`background.paper`, `text.secondary`, caption typography).

### Helm — `deploy/helm/portalai/`

`values.yaml`, under `web:`:

```yaml
  # Map basemap (#910). none = no tile egress (data layers still render);
  # custom = your own tile server (MapLibre style JSON or an XYZ {z}/{x}/{y}
  # template); default = CARTO + OpenStreetMap (third-party egress).
  basemap:
    mode: none
    styleUrl: ""
    styleUrlDark: ""
    attribution: ""
```

In `values.schema.json`, `web` keeps `additionalProperties: true` and gains `properties.basemap`, an object with `additionalProperties: false`, `mode` enum `["default","custom","none"]`, string fields that accept `""` or match `^https?://`, and `if {mode: const custom} then {styleUrl: minLength 1}`.

`templates/configmap.yaml` adds `BASEMAP_MODE`, `BASEMAP_STYLE_URL`, `BASEMAP_STYLE_URL_DARK` and `BASEMAP_ATTRIBUTION` from `.Values.web.basemap.*`, each `| quote`d. Because the existing `checksum/config` covers them, web pods roll when they change.

### Docs

- `deploy/helm/portalai/README.md`: values-table rows for `web.basemap.*`. The egress section (`:166-168`) replaces "no override yet (#910)" with the three modes and the chart default `none`.
- `docs/DEPLOYMENT_SECURITY_REVIEW.md`:
  - The §1 row (`:41`) and §2 row (`:58`) now read "configurable: `none` (chart default) / `custom` / `default`".
  - The guard note (`:45`) says the hosts in source are the `default` path.
  - The SaaS record (`:127/:129/:140`) records SaaS = `default`.
  - The residency review record gains a "Basemap mode / tile host" field.
- `subprocessor-browser-egress.guard.test.ts`: header comment only. `HOSTS` and the `:101` assertion stay, because the CARTO and OSM hosts remain in source.
- `packages/core/src/content/subprocessors.util.ts`: `carto.usedWhen` becomes "when you view a map in a portal (a residency install can disable or replace the basemap)"; `openstreetmap` gets the same suffix.

## Migration
## Seed

None: no schema or seed changes.

## TDD test plan

Run from each package with `npm run test:unit`. Web uses `-- --testPathPattern <file>` locally. Helm uses `npm run lint:helm` from the root.

### `apps/web/src/__tests__/render-config.test.ts` (+3)
- An unset env renders `BASEMAP_MODE:"default"` and empty strings for the three other keys.
- Given values pass through unchanged, including `custom` and the URLs.
- Key order matches `RUNTIME_KEYS`, and `public/config.js` parses to the same key set as `renderConfigJs({})`.

### `apps/web/src/__tests__/runtime-config.util.test.ts` (+11)
- `readInstallBasemap`, one case per table row:
  - unset → default
  - `default`
  - `none`
  - valid custom
  - custom with a valid dark URL
  - custom with an invalid dark URL → `styleUrlDark: null` + problem
  - custom with no URL → none + problem
  - custom `javascript:`/`ftp:` → none
  - `off` / `None` → none + problem
  - values padded with whitespace are trimmed
- `getInstallBasemap` warns once across two calls (`console.warn` spy, fresh module).

### `apps/web/src/modules/MapWidget/__tests__/map-config.util.test.ts` (+10)
- With no install argument, the existing 3 cases pass unchanged.
- `none` returns `emptyBasemapStyle` for each of `carto-light`, `osm` and `{url}`.
- `custom` uses `styleUrl` in light mode and `styleUrlDark` in dark mode.
- `custom` in dark mode without a dark URL falls back to `styleUrl`.
- `custom` ignores a spec `{url}`.
- An XYZ template is wrapped in a raster style that carries the attribution, and omits it when the attribution is empty.
- `emptyBasemapStyle` has no sources and a background layer whose colour depends on the mode.

### `apps/web/src/modules/MapWidget/__tests__/MapWidget.test.tsx` (+7)

The MapLibre mock gains captured constructor options, `on`/`once` handler registries with an `emit(event, payload)` helper, and a `setStyle` spy.
- The constructor `style` is the empty style under `installBasemap: none`, and the custom URL (not the spec's `{url}`) under `custom`.
- `error` before `style.load` → `setStyle(emptyBasemapStyle)` + "Basemap unavailable" shown + `console.error`.
- After a fallback, emitting `style.load` adds the data layers (`addLayer` is called once per layer).
- Timeout: with fake timers advanced by `BASEMAP_LOAD_TIMEOUT_MS` and no `style.load` → fallback + notice.
- `error` after `style.load` → no `setStyle`, no notice.
- `none` mode with an error → no notice.
- Cleanup clears the timer: unmounting before the timeout → no `setStyle`.

### `apps/web/src/modules/MapWidget/__tests__/BasemapUnavailableNotice.test.tsx` (+1)
- Renders "Basemap unavailable" with `role="status"`.

### `scripts/check-helm.mjs` (+4 scenarios)
- Defaults render `BASEMAP_MODE: "none"`.
- `--set web.basemap.mode=custom,web.basemap.styleUrl=https://tiles.internal/style.json` renders both keys.
- `mode=custom` with no `styleUrl` fails schema validation.
- `mode=off` fails schema validation.

### Unchanged guards to run
`subprocessor-browser-egress.guard.test.ts` (web), `subprocessors.util.test.ts` (core) and `permission-copy.guard.test.ts` (it scans durable docs).

**Totals ≈ 36 cases** (32 jest + 4 helm scenarios).

## Acceptance criteria

- [ ] With `web.basemap.mode=custom` pointing at an internal tile server, rendering a map makes no request to `*.cartocdn.com` or `tile.openstreetmap.org`, for any spec basemap, `{url}` included.
- [ ] With `mode=none`, maps render points and polygons on a plain background, and the attribution control credits no provider.
- [ ] With `BASEMAP_MODE` unset (SaaS), maps render exactly as before: CARTO by theme, `osm`, and spec `{url}`.
- [ ] A fresh `helm install` with default values sends no basemap traffic off the cluster.
- [ ] An unreachable or invalid custom style shows the data layers on a blank background with a non-blocking "Basemap unavailable" notice and a console error, within 10s at worst.
- [ ] An invalid runtime config (unknown mode, `custom` without a URL) results in no basemap rather than CARTO. `helm install` rejects it outright.
- [ ] The Helm README and `DEPLOYMENT_SECURITY_REVIEW.md` describe the three modes and the chart default.

## Risks & rollback

- **The `style.load` semantics in maplibre-gl 6.x are the riskiest part.** The fallback depends on `style.load` firing after `setStyle` replaces a style that failed to load. A unit test against the mock can't prove this, so a smoke step must check it in a real browser (unreachable host, and a host that serves a bad JSON body). If it doesn't hold, the fallback is to rebuild the map with the empty style instead of calling `setStyle`.
- **SaaS regression:** moving the layer code from `load` to `style.load` changes when layers attach under CARTO (earlier, before the tiles finish). The smoke walks SaaS maps (points, polygons, vector tiles, fitBounds, popups). Rollback is to revert the web slice; the config keys are inert when unset.
- **A `custom` operator gets a blank map:** for example, their tile server's CORS blocks the SPA's origin. That counts as a fallback and is visible as the notice plus a console error. The README tells operators to serve the style and tiles with CORS for the app origin.
- **Fail-mode summary:** fail closed on egress (bad config resolves to `none`), fail open on rendering (data layers always render). There's no cost or billing exposure.

## Files touched

- **Edit:**
  - `apps/web/scripts/render-config.mjs`
  - `apps/web/public/config.js`
  - `apps/web/src/utils/runtime-config.util.ts`
  - `apps/web/src/modules/MapWidget/utils/map-config.util.ts`
  - `apps/web/src/modules/MapWidget/MapWidget.component.tsx`
  - `apps/web/src/modules/MapWidget/index.ts` (if the notice is exported)
  - `apps/web/src/__tests__/subprocessor-browser-egress.guard.test.ts` (comment)
  - `packages/core/src/content/subprocessors.util.ts`
  - `deploy/helm/portalai/{values.yaml,values.schema.json,templates/configmap.yaml,README.md}`
  - `scripts/check-helm.mjs`
  - `docs/DEPLOYMENT_SECURITY_REVIEW.md`
  - `apps/web/src/modules/MapWidget/stories/MapWidget.stories.tsx` (`NoBasemap` + `BasemapUnavailable` stories)
- **New:**
  - `apps/web/src/modules/MapWidget/BasemapUnavailableNotice.component.tsx`
  - `apps/web/src/modules/MapWidget/__tests__/BasemapUnavailableNotice.test.tsx`
- **Test edits:** `render-config.test.ts`, `runtime-config.util.test.ts`, `map-config.util.test.ts`, `MapWidget.test.tsx`.

## Next step

`docs/CONFIGURABLE_BASEMAP_TILES.plan.md` will sequence about five TDD slices on this branch:

1. the runtime keys and the fail-closed reader;
2. `resolveBasemapStyle` + `emptyBasemapStyle`;
3. the `MapWidgetUI` move to `style.load`, the fallback and the notice;
4. the Helm values, schema, ConfigMap and `check-helm`;
5. the docs and subprocessor copy.

Each slice is one commit, test-first.
