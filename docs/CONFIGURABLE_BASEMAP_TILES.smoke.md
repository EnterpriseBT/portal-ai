# configurable-basemap-tiles — Smoke Suite

Manual smoke test for [#910](https://github.com/EnterpriseBT/portal-ai/issues/910): an install-wide basemap setting (`BASEMAP_MODE` = `default` | `custom` | `none`, Helm `web.basemap.*`) that overrides every map spec's basemap. Map data now renders whatever happens to the basemap, with a "Basemap unavailable" notice when it fails. **Branch under test:** `feat/910-configurable-basemap-tiles` (PR [#927](https://github.com/EnterpriseBT/portal-ai/pull/927)).

Run **§Preflight** once before any section. After that each section stands alone. Steps tagged **— manual** need a human, steps tagged **— backend** run in a terminal, and every other step can be walked by `/smoke-walk`.

**Why the egress checks are manual.** MapLibre fetches styles and tiles from a **web worker**. Playwright's page-level request events don't see those fetches (observed while building slice 3), but Chrome DevTools' Network panel does. So every "no request to host X" check is a human reading DevTools Network, with **Preserve log** on and a filter of `cartocdn|openstreetmap|demotiles|smoke`.

---

## Preflight

### Environment

- [ ] `git checkout feat/910-configurable-basemap-tiles && git pull --ff-only`
- [ ] `npm install`. No migration and no core model change. A `packages/core` rebuild isn't needed for the web app (core only changed copy), but run `npm run build --workspace=packages/core` if the dev server reports stale core types.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`), and sign-in lands on `/dashboard`.

### How this suite switches the basemap

The dev server serves `apps/web/public/config.js` as-is, so a section sets the mode by editing that file's `BASEMAP_*` values and **hard-reloading** the page. Nothing else needs a restart. **Never commit these edits** (see Reset).

Two throwaway style files make `custom` fully local, with no external tile server. Create them once:

- [ ] `apps/web/public/smoke-basemap-light.json`, containing:
  `{"version":8,"sources":{},"layers":[{"id":"bg","type":"background","paint":{"background-color":"#cfe3d4"}}]}` (pale green)
- [ ] `apps/web/public/smoke-basemap-dark.json`, the same with `"#3a2a4a"` (deep purple)

### Fixtures

- [ ] An org with map data: `npx portalai demo seed --org <your-org-id> --rows 1000 --env local --yes` (run `npm run build --workspace=@portalai/admin-cli` first). This seeds the demo company, including its **sites** entity, and links it to the org's station.
- [ ] **Map A, the spec's default basemap.** In a portal on that station, prompt: "Show all sites on a map". Expect a map widget with site points. Pin it.
- [ ] **Map B, a spec-authored basemap URL.** In a portal, prompt: "Show all sites on a map, using the basemap style https://demotiles.maplibre.org/style.json". Confirm the pinned spec's `basemap` is `{ url: "https://demotiles.maplibre.org/style.json" }`; if the agent drops it, reword until it doesn't. Pin it. This is the agent-authored egress the override has to block.
- [ ] *(Optional, for §1's tile row)* A **vector-tile map**: a pinned map whose result exceeded the inline cap (`map-widget-tiles-loading` / "Rendering…" appears while panning). Skip that row if the org has no geo result large enough.

### Reset between runs

- [ ] `git checkout apps/web/public/config.js && rm -f apps/web/public/smoke-basemap-*.json`, then hard-reload. `git status --short apps/web/public` must be empty before anything is committed.

---

## §1 — `default`: SaaS behaviour unchanged (AC3)

`config.js`: `"BASEMAP_MODE":"default"`, all other `BASEMAP_*` `""` (as shipped).

- [ ] Open Map A's pin. Expect the CARTO light basemap under the site points, and attribution reading **"© OpenStreetMap contributors © CARTO"**. No "Basemap unavailable" notice.
- [ ] Switch the app to the dark theme. Map A re-renders on CARTO **dark-matter**, with the points still drawn and fitted to their bounds.
- [ ] Open Map B's pin. Expect the **demotiles** world basemap (coloured countries): under `default` a spec's own `{url}` is honoured exactly as on `main`.
- [ ] Click a point on Map A. The popup opens, as before.
- [ ] *(If the vector-tile fixture exists)* Pan and zoom the tiled map: tiles render, "Rendering…" appears and clears, and there's no notice.
- [ ] **— manual** DevTools Network on Map A shows requests to `basemaps.cartocdn.com` (style + tiles). This is the baseline the later sections remove.

## §2 — `none`: no basemap, no tile egress (AC2)

`config.js`: `"BASEMAP_MODE":"none"`.

- [ ] Open Map A. The site points render on a **plain background**: white in light theme, `#0f0f1f` in dark. The attribution control is empty: no CARTO, no OSM.
- [ ] No "Basemap unavailable" notice, because `none` is a choice, not a failure.
- [ ] Open Map B (spec `{url}` = demotiles). It also renders on the plain background, so the spec's URL is ignored.
- [ ] **— manual** DevTools Network across Map A and Map B (and a pan/zoom): **zero** requests to `cartocdn`, `openstreetmap` or `demotiles`.

## §3 — `custom`: the operator's tile server (AC1)

`config.js`: `"BASEMAP_MODE":"custom","BASEMAP_STYLE_URL":"http://localhost:3000/smoke-basemap-light.json","BASEMAP_STYLE_URL_DARK":"http://localhost:3000/smoke-basemap-dark.json"`.

- [ ] Open Map A in light theme. Points render on **pale green** (`#cfe3d4`), with no notice.
- [ ] Switch to dark theme. Map A re-renders on **deep purple** (`#3a2a4a`).
- [ ] Set `BASEMAP_STYLE_URL_DARK` back to `""` and reload in dark theme. Map A uses the **green** light style in both themes.
- [ ] Open Map B. It renders on the **custom** style, not demotiles.
- [ ] **— manual** DevTools Network across Map A, Map B and a theme switch: requests go to `localhost:3000/smoke-basemap-*.json` only, with **zero** to `cartocdn`, `openstreetmap` or `demotiles`.
- [ ] **XYZ template.** Set `"BASEMAP_STYLE_URL":"http://localhost:3000/apple-touch-icon.png?z={z}&x={x}&y={y}"`, `"BASEMAP_STYLE_URL_DARK":""`, `"BASEMAP_ATTRIBUTION":"© Smoke tiles"`. Map A's background becomes a grid of the app icon (each "tile" is that PNG), points stay on top, attribution reads **"© Smoke tiles"**, and there's no notice.

## §4 — Fallback: data survives a failing basemap (AC5)

Each row edits `config.js`, hard-reloads, and opens Map A.

- [ ] **Unreachable style.** `custom` with `BASEMAP_STYLE_URL` = `https://tiles.smoke.invalid/style.json`. Within a few seconds (at worst 10s) the points render on the plain background, the overlaid **"Basemap unavailable"** notice sits bottom-left (layout doesn't shift), and the console shows `[map] basemap unavailable`.
- [ ] **Invalid style body.** `custom` with `BASEMAP_STYLE_URL` = `http://localhost:3000/robots.txt` (not JSON). Same outcome: points, notice, console error.
- [ ] **Failing XYZ tiles.** `custom` with `BASEMAP_STYLE_URL` = `https://tiles-dead.smoke.invalid/{z}/{x}/{y}.png`. Points render and the notice appears. The style is inline, so this exercises the tile-failure path, not the style-failure one.
- [ ] **— manual** **SaaS basemap blocked.** `default`. In DevTools → Network → right-click a `basemaps.cartocdn.com` request → **Block request domain**, then hard-reload. Points render with the notice. On `main` the same block left the map with **no points at all**. Remove the block afterwards.
- [ ] **— manual** **Slow SaaS style isn't timed out.** `default`, DevTools throttling **Slow 3G**, hard-reload Map A and wait over 10s. CARTO eventually renders with **no** notice: `default` has no timeout.

## §5 — Misconfiguration fails closed (AC6, runtime half)

- [ ] `"BASEMAP_MODE":"off"`. Map A renders with **no basemap** (plain background, no notice). The console shows exactly one warning, `[basemap] Unknown BASEMAP_MODE "off" …`, even with two maps on the page.
- [ ] `"BASEMAP_MODE":"custom"` with `BASEMAP_STYLE_URL` `""`. No basemap, and one warning naming `BASEMAP_STYLE_URL`.
- [ ] `"BASEMAP_MODE":"custom"` with `BASEMAP_STYLE_URL` `"javascript:alert(1)"`. No basemap, no alert, and one warning.
- [ ] **— manual** In all three, DevTools Network shows **zero** requests to `cartocdn` or `openstreetmap`: a bad config never falls back to CARTO.

## §6 — Helm contract (AC4, AC6 install half) — backend

Run from the repo root. The `--set image.*` flags are the minimum a render needs.

- [ ] **— backend** `npm run lint:helm` → "All helm chart checks passed.", including the `#910` scenarios.
- [ ] **— backend** `helm template p deploy/helm/portalai --set image.api.repository=a --set image.api.tag=t --set image.web.repository=b --set image.web.tag=t | grep BASEMAP_` → `BASEMAP_MODE: "none"` and three empty strings. A fresh install has no basemap egress.
- [ ] **— backend** The same with `--set web.basemap.mode=custom --set web.basemap.styleUrl=https://tiles.corp.example/style.json` → those values in the ConfigMap. `kubectl`-free check: the web Deployment's `checksum/config` annotation differs from the default render's, so pods would roll.
- [ ] **— backend** `--set web.basemap.mode=custom` (no URL) → refused with `at '/web/basemap/styleUrl': minLength`.
- [ ] **— backend** `--set web.basemap.mode=off` → refused with `value must be one of 'default', 'custom', 'none'`.

## §7 — Documentation (AC7) — manual

- [ ] **— manual** `deploy/helm/portalai/README.md`: the values table has the `web.basemap.*` rows, and the Egress section describes `none` (the default), `custom` (CORS note, `{z}/{x}/{y}` only), `default`, the "Basemap unavailable" fallback and running the image without the chart. Nothing still says "no override yet".
- [ ] **— manual** `docs/DEPLOYMENT_SECURITY_REVIEW.md`: the §1 basemap row names `BASEMAP_MODE` with `on / self-host / drop`, §2 scopes CARTO/OSM to `default`, §4 asks for the basemap mode and tile host, and the SaaS baseline records `default`.
- [ ] **— manual** Marketing site (`npm run dev --workspace=@portalai/site`, `:3002`), `/security/#subprocessors`. The CARTO line reads "Used when you view a map in a portal, unless the deployment replaces or turns off the basemap." and OSM's ends the same way. Read it for public-facing tone.

## Sign-off

- [ ] Every section above verified
- [ ] `<date + name>` — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro (config.js values + map) · Identifiers (org / portal / pin ids) · Console + DevTools Network excerpt:
