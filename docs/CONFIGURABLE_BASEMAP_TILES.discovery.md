# Configurable basemap tiles for residency installs — Discovery

**Issue:** [EnterpriseBT/portal-ai#910](https://github.com/EnterpriseBT/portal-ai/issues/910)

**Why this exists.** Every map the app draws pulls its basemap from CARTO (`basemaps.cartocdn.com`), or from OpenStreetMap's tile server when a spec names `osm`, and both hosts are hard-coded in the web bundle. A residency install promises that its browsers talk only to hosts inside the customer's environment, yet today the operator can neither turn this egress off nor point it at a tile server of their own. #615's audit recorded CARTO/OSM in `docs/DEPLOYMENT_SECURITY_REVIEW.md` as a fixed browser egress "until #910".

A second gap sits underneath: when the style can't be fetched, MapLibre never fires `load`, and the data layers are added only on `load`. So a blocked or unreachable basemap leaves an empty map with no data. A residency install whose firewall drops CARTO hits that today, and SaaS would hit it in a CARTO outage.

This ticket adds an install-wide basemap setting that can stop map tile egress or redirect it to the operator's own server, and makes the data layers render whatever happens to the basemap.

PRD gate answers (recorded on the issue): the setting is **install-wide and operator-only**; when it is set it **overrides every map spec's basemap**, custom `{url}` included; an unreachable or invalid style renders the **data on a blank background with a quiet "Basemap unavailable" notice**.

## The current shape

### Basemap resolution and map construction

| Piece | Location | Note |
|---|---|---|
| CARTO / OSM constants | `apps/web/src/modules/MapWidget/utils/map-config.util.ts:603-620` | Positron / dark-matter GL style URLs; `osm` is an inline raster style object carrying its own attribution |
| `resolveBasemapStyle(basemap, mode)` | `map-config.util.ts:627-634` | `{url}` is returned as given and `osm` returns the inline style. Anything else returns CARTO keyed to the **theme**, so `carto-light` vs `carto-dark` in a spec is effectively ignored |
| Sole caller | `apps/web/src/modules/MapWidget/MapWidget.component.tsx:177` | Inside `MapWidgetUI`'s mount effect (`:161-273`) |
| Map construction | `MapWidget.component.tsx:175-186` | `attributionControl: { compact: true }`. Attribution comes only from style sources, so a style with no sources credits nobody |
| Data layers | `MapWidget.component.tsx:194-250` | Added only in `m.on("load")`: a `portalmap://` vector source or GeoJSON sources, then `addLayer` |
| Theme change | `MapWidget.component.tsx:264`, `:529-530` | `mode` is an effect dependency, so the map is torn down and rebuilt (no `setStyle`) |
| Error handling | — | **No `on("error")` handler.** `renderError` (`:120`, `:229`) only catches synchronous `addLayer` throws, and the outer `catch` (`:252`) swallows construction failures |
| Glyph / sprite dependency | `map-config.util.ts:377`, `:418` | **None.** Layers are only `circle|fill|line|heatmap`, and `label` is legend text (`map-spec.contract.ts:134`). A style with no sources works |

No other surface renders a map: no thumbnails, exports or server-side rendering. The widget is registered once (`MapWidgetGate.component.tsx:15`, from `main.tsx:13`).

### Map spec

`MapBasemapSchema` (`packages/core/src/contracts/map-spec.contract.ts:21-25`) is `carto-light | carto-dark | osm | {url}`, defaulting to `carto-light` (`:181`). `visualize-map.tool.ts:184` parses through it, so the default is stored on every block. **Nothing server-side reads `spec.basemap`**, so the override can apply entirely at render time. Stored pins don't change.

### Runtime config (#566 / #607)

| Piece | Location |
|---|---|
| Renderer + keys + defaults | `apps/web/scripts/render-config.mjs:16-28`. Unset keys render as `""` (`:39`); types in `render-config.d.mts` |
| Container entrypoint | `apps/web/scripts/40-render-config.sh:8` → `/usr/share/nginx/html/config.js` |
| SaaS/dev static file | `apps/web/public/config.js`. Hard-codes the keys and must gain any new one |
| Reader | `apps/web/src/utils/runtime-config.util.ts:26-32` (interface), `:66-77` (**whitelist**: unknown keys dropped), `:80-84` |
| Tests | `src/__tests__/runtime-config.util.test.ts`, `src/__tests__/render-config.test.ts` |

Nothing falls back from a runtime key to a `VITE_*` key. A runtime key with a SaaS default in both `DEFAULTS` and `public/config.js` is the established shape (`DEPLOY_MODE`).

### Helm

`values.yaml:43-56` (`web:`) has no basemap value. `templates/configmap.yaml:8-14` emits the config.js env, `web-deployment.yaml:36-48` mounts it with `envFrom`, and its `checksum/config` (`:21`) rolls the pods when it changes. `values.schema.json:34` leaves `web` open. The chart's tests are the scenarios in `scripts/check-helm.mjs` (`npm run lint:helm`, from `:249`). The README values table is at `README.md:57-85`, and the egress section (`:166-168`) says "no override yet (#910)".

### Egress accounting

- `apps/web/src/__tests__/subprocessor-browser-egress.guard.test.ts` has a `HOSTS` map (`:25-41`) that maps `basemaps.cartocdn.com` → `carto` and `tile.openstreetmap.org` → `openstreetmap`. It asserts the CARTO host stays in the source (`:101`). Its header (`:12-14`) treats spec `{url}` hosts as author-supplied.
- `packages/core/src/content/subprocessors.util.ts:111-125` lists `carto` and `openstreetmap` as browser-reached.
- `docs/DEPLOYMENT_SECURITY_REVIEW.md` covers them in the §1 row (`:41`), the guard note (`:45`), the §2 row (`:58`) and the SaaS record (`:127`, `:129`, `:140`).
- **No CSP exists for the SPA** (`apps/web/nginx.conf` sets only Cache-Control), so nothing enforces egress in the browser today.

## The design space

### Decision 1 — Shape of the config contract

**A. One URL key, with `none` as a sentinel value.** `BASEMAP_STYLE_URL=none|<url>`, where unset means CARTO. This is the smallest change, but it overloads a URL field with a mode, and a typo such as `None` or `off` becomes a URL that is fetched.

**B. An explicit mode plus URLs.** `BASEMAP_MODE=default|custom|none`, `BASEMAP_STYLE_URL`, optional `BASEMAP_STYLE_URL_DARK`, and optional `BASEMAP_ATTRIBUTION`. The mode is an enum that can be validated in three places (schema, renderer, reader). A dark URL keeps the light/dark theme behaviour SaaS has today.

**C. A JSON style blob in config.js.** The most flexible option, but it puts an arbitrary MapLibre style into an env var, Helm value and ConfigMap, and nothing can sensibly validate it.

| | A | B | C |
|---|---|---|---|
| Validatable | Weak | Enum + URL | No |
| Misconfiguration risk | A typo becomes egress | Unknown mode → fail closed | High |
| Theme parity | No | Optional dark URL | Yes |
| Operator ergonomics | Simple | Simple | Poor |

**Lean: B.** An explicit mode is what lets misconfiguration fail closed (Decision 4), and the dark URL is optional, so the common case is one URL.

### Decision 2 — What a "custom" URL may point at

Self-hosted tile servers come in two shapes: a **MapLibre style JSON** (tileserver-gl, Martin, OpenMapTiles) and a **raster XYZ template** (a self-hosted OSM tile server, `…/{z}/{x}/{y}.png`).

**A. Style JSON only.** The operator wraps an XYZ server in their own style file.
**B. Both, detected by `{z}` in the URL.** A template is wrapped in a raster style like today's `OSM_STYLE`, with `BASEMAP_ATTRIBUTION` as the source attribution.

**Lean: B.** It costs about ten lines and one test. Without it the common "we already run an OSM tile server" case needs a hand-written style file served from somewhere.

### Decision 3 — Precedence between the install setting and the spec

Already decided by the PRD gate. Under `custom` or `none`, the install wins for **every** spec value, `{url}` included. Under `default`, today's behaviour is preserved exactly (CARTO by theme, `osm`, and a spec's `{url}`). This becomes one `InstallBasemap` argument to `resolveBasemapStyle`, and the spec's value is consulted only under `default`.

### Decision 4 — Behaviour when the config itself is invalid

**A. Fall back to CARTO.** This is today's SaaS behaviour, but a residency install with a typo in `BASEMAP_MODE` would quietly send traffic to CARTO.
**B. Fall back to `none`.** No egress; the maps lose their background and keep their data.
**C. Refuse to start the container.** The loudest option, but it takes the whole SPA down over a cosmetic setting.

**Lean: B in the SPA, plus validation upstream.** `values.schema.json` gets an enum on `mode`, and `custom` requires `styleUrl`, so `helm install` refuses bad values. `render-config.mjs` passes values through unchanged, and the reader treats an unknown mode, or `custom` without a valid `https?:` URL, as `none` with a single console warning. Misconfiguration can therefore cost a basemap but never add egress.

### Decision 5 — Making data independent of the basemap

**A. On a style-load `error` before `load`, `setStyle(EMPTY_STYLE)`.** The empty style is an inline object with no sources and one theme-coloured `background` layer. `load` then fires and the existing layer code runs unchanged, with the widget showing the notice.
**B. Start with the empty style and add the basemap as a layer after `load`.** The data never waits on the basemap, but this restructures `MapWidgetUI` and needs layer ordering (`beforeId`) for every data layer.

**Lean: A**, plus a **style-load timeout** (fallback if `load` hasn't fired within ~10s), because a firewall that silently drops packets produces no `error` event at all. Errors on individual tiles after `load` stay console-only with no notice: a few 404s at the edge of a self-hosted tile set are normal. `none` mode uses the same `EMPTY_STYLE` from the start, so the no-basemap path and the fallback path share one style that is tested once.

## Tradeoff comparison

| | D1: B (mode + URLs) | D2: B (style or XYZ) | D3: install wins | D4: B (fail to none) | D5: A (error → empty style) |
|---|---|---|---|---|---|
| Packages touched | web, chart | web | web | web, chart | web |
| New contract surface | 4 runtime keys + `web.basemap` Helm block | — | — | schema rules | — |
| Changes SaaS behaviour | No | No | No | No | Yes: data now renders in a CARTO outage (fix) |
| Spread to spec | Yes | Yes | Yes | Yes | Yes |

## Recommendation

1. Add runtime keys `BASEMAP_MODE` (`default` | `custom` | `none`, default `default`), `BASEMAP_STYLE_URL`, `BASEMAP_STYLE_URL_DARK` and `BASEMAP_ATTRIBUTION` to `render-config.mjs`, its `.d.mts`, `public/config.js` and the `runtime-config.util.ts` whitelist.
2. The reader parses these into an `InstallBasemap` discriminated union. An unknown mode, or `custom` without a valid `http(s)` style URL, resolves to `{ mode: "none" }` and logs one warning.
3. `resolveBasemapStyle(basemap, mode, install)`: under `default` it behaves exactly as today. Under `custom` it picks the dark URL when the theme is dark and one is set, otherwise the light URL, and wraps an XYZ template (`{z}` present) in a raster style carrying `BASEMAP_ATTRIBUTION`. Under `none` it returns `EMPTY_STYLE`. The spec's basemap is ignored outside `default`.
4. `EMPTY_STYLE` has no sources (so the attribution control shows nothing) and a single `background` layer coloured from the theme.
5. `MapWidgetUI` handles a style-load `error` before `load`, or a ~10s timeout, by switching to `EMPTY_STYLE` and showing a small overlaid "Basemap unavailable" notice (positioned so it never shifts the layout) with a console error. Tile errors after `load` are logged only.
6. Helm: a `web.basemap: { mode, styleUrl, styleUrlDark, attribution }` block feeding `configmap.yaml`. `values.schema.json` enforces the mode enum and requires `styleUrl` under `custom`. `check-helm.mjs` gains scenarios for all three modes plus the rejected `custom`-without-URL case.
7. Documentation: the Helm README values table and egress section; `DEPLOYMENT_SECURITY_REVIEW.md` §1/§2 rows and guard note, now "configurable; `none` removes it"; the egress guard's header comment (the CARTO/OSM hosts stay in the source as the `default` path, so its `HOSTS` entries and the `:101` assertion still hold); and `subprocessors.util.ts` `usedWhen` copy noting that residency installs may disable or replace the basemap.

## Open questions

1. **What should the Helm chart default to: `default` (CARTO) or `none`?** The chart only serves residency installs, and residency promises no third-party egress, so a secure default would be `none`. The cost is that a fresh install has maps with no basemap until the operator configures one. No residency customer is installed yet (the mock client install is pending), so changing the chart's behaviour now breaks nobody. **Lean: `none` in the chart**, with the README showing how to set `custom` or `default`. The image's own `render-config.mjs` default stays `default`, so SaaS is untouched. *This is the call I'd most like you to confirm.*
2. **Should the theme-follows-mode quirk for `carto-light`/`carto-dark` be fixed here?** Today a spec's light/dark choice is ignored. It's unrelated to egress, and fixing it changes how stored SaaS pins render. **Lean: no.** Leave it and note it in "What this doesn't decide".
3. **Should the agent be told about the override?** The tool description says only "an optional basemap", which stays true: a spec stays valid and is just overridden at render time. **Lean: no tool or prompt change.** The agent has nothing to do differently, and telling it about install config would leak deployment details into every SaaS prompt.
4. **How long should the timeout be?** CARTO's style usually loads in well under 1s, and a self-hosted server on a LAN faster still. **Lean: 10s**, as a named constant. It has to cover slow tunnels, and the timeout only changes what happens after the wait.
5. **Should the notice be shown under `none`?** No: `none` is a choice, not a failure. **Lean: the notice appears only for the `custom`/`default` fallback.**

## Enterprise-scale considerations

- **Concurrency & correctness:** N/A because this is static, per-install config read once at page load. Nothing is shared or written.
- **Accuracy & auditability:** The Helm values are the record of what an install allows, and `DEPLOYMENT_SECURITY_REVIEW.md`'s per-install review records the mode. Lean: the residency review template gets a "basemap mode / host" field so the customer's sign-off names it.
- **Failure modes:** This is the part that matters. Lean: **fail closed on egress, fail open on rendering.** Invalid config becomes `none` (no unexpected host is ever contacted), and an unreachable basemap still renders the data. The decision is deliberately asymmetric: losing a basemap is cosmetic, while unexpected egress breaks a contractual promise.
- **Scale & unbounded growth:** N/A because tile request volume is unchanged and goes to whatever host is configured. The timeout bounds the wait for one map.
- **Multi-tenancy:** The setting is install-wide by PRD decision. On SaaS (`default`) every org gets today's behaviour. Lean: no per-org override; a residency install is effectively one tenant boundary.
- **Contract stability:** The `InstallBasemap` union can take new modes (an `allowlist` mode, or authenticated tile servers via `transformRequest`) without changing call sites. Lean: keep the mode an enum rather than a boolean.
- **Data lifecycle:** N/A because nothing is stored. Stored pin specs are untouched and keep rendering under any mode.

## What this doesn't decide

- **A browser CSP (`connect-src`/`img-src`)** would turn "the bundle doesn't request it" into "the browser can't request it". The SPA has no CSP at all today; adding one is a cross-cutting change worth its own ticket.
- **Bundling or hosting a tile server in the chart.** Out of scope per the issue: the customer supplies one.
- **Authenticated tile servers** (API keys, bearer tokens via MapLibre `transformRequest`). No caller needs this yet, and the `custom` mode leaves room for it.
- **The spec's `carto-light`/`carto-dark` theme quirk** (open question 2).

## Next step

`docs/CONFIGURABLE_BASEMAP_TILES.spec.md` will pin the four runtime keys, the `web.basemap` Helm block and schema, and the `InstallBasemap` precedence table. `.plan.md` will then cut about five TDD slices:

1. the runtime keys and reader (fail-closed parsing);
2. `resolveBasemapStyle` with the install argument, `EMPTY_STYLE` and the XYZ wrapping;
3. `MapWidgetUI`'s error/timeout fallback and notice (this needs the MapLibre mock to capture `on` handlers and the constructor `style`);
4. the Helm values, schema, ConfigMap and `check-helm` scenarios;
5. the docs, guard comment and subprocessor copy.
