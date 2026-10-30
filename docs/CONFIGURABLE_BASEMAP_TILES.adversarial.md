# configurable-basemap-tiles — Adversarial Review

Adversarial probes for [#910](https://github.com/EnterpriseBT/portal-ai/issues/910): the install-wide basemap setting (`BASEMAP_MODE` = `default` | `custom` | `none`, Helm `web.basemap.*`), which overrides every map spec's basemap, and the "Basemap unavailable" fallback. **Branch under test:** `feat/910-configurable-basemap-tiles` (PR [#927](https://github.com/EnterpriseBT/portal-ai/pull/927)).

The surfaces this change exposes are listed below. §1, §2, §3, §6 and §7 are engaged. §4 and §5 are `N/A` because the change adds no API route, no permission check and no per-org state.

- an operator-set runtime config, read fail-closed by the SPA;
- an agent-authored spec `{url}` that `custom` and `none` must override;
- an XYZ template path;
- MapLibre's attribution control, which renders attribution as HTML;
- a timeout and fallback lifecycle inside the map effect;
- a Helm schema.

Tags: untagged probes can be driven in the browser by `/smoke-walk`, `— backend` probes are terminal-only (helm/curl), and `— manual` probes need a human (DevTools Network or judgment).

## Preflight

### Environment
- [ ] `git checkout feat/910-configurable-basemap-tiles && npm install && npm run dev` (web :3000, API :3001). Playwright MCP is available and the `e2e:auth` storageState is fresh.
- [ ] Probes switch the mode by editing `apps/web/public/config.js` (served as-is) and hard-reloading, exactly as in `CONFIGURABLE_BASEMAP_TILES.smoke.md`.

### Fixtures
- [ ] The smoke walk's pins in `e2e-fixture`: **Map A** `5d33949a…` (spec `carto-light`) and **Map B** `b6755daf…` (spec `{url}` = demotiles). Recreate them per the smoke doc's Fixtures if they're gone.
- [ ] A throwaway file `apps/web/public/smoke-basemap-light.json` (the smoke doc's pale-green style).

### Reset between runs
- [ ] `git checkout apps/web/public/config.js && rm -f apps/web/public/smoke-basemap-*.json apps/web/public/adv-*.json`. `git status --short apps/web/public` must be empty.

## §1 — Boundary & limit inputs

- [ ] `"BASEMAP_MODE":"NONE"` (upper case), then `" none "` (padded). Expected safe: `NONE` is an **unknown** mode, so no basemap and one `[basemap] Unknown BASEMAP_MODE "NONE"` warning, never CARTO. `" none "` trims to `none`: no basemap and **no** warning.
- [ ] `custom` with `BASEMAP_STYLE_URL` = `http://localhost:3000/` followed by 8,000 `a`s + `.json`. Expected safe: the map renders its points, the style request fails (404), the notice shows, and the page doesn't hang or throw.
- [ ] `custom` with an XYZ template missing `{x}`/`{y}`: `http://localhost:3000/apple-touch-icon.png?z={z}`. Expected safe: every tile requests the same PNG, so the background is the icon repeated with the points on top. No crash and no notice (tiles load). Record what renders.
- [ ] `"BASEMAP_MODE":"none"` with a valid `BASEMAP_STYLE_URL` and `BASEMAP_STYLE_URL_DARK` still set. Expected safe: the URLs are **ignored**, giving a plain background in both themes. — manual (the DevTools Network check that `smoke-basemap-*.json` is never requested)
- [ ] `"BASEMAP_MODE":"default"` with `BASEMAP_STYLE_URL` = `http://localhost:3000/smoke-basemap-light.json`. Expected safe: the URL is ignored and Map A renders CARTO. Operators can't half-configure `custom`.

## §2 — Malformed & injection input

- [ ] **Agent-authored hostile basemap under the override.** Create `apps/web/public/adv-hostile-style.json` as a raster style whose source attribution is `<img src=x onerror="window.__advPwned=1">`, with tiles at `http://localhost:3000/apple-touch-icon.png?{z}`. In a portal prompt: "Show all sites on a map, using the basemap style http://localhost:3000/adv-hostile-style.json". With `custom` (the green style) and then with `none`, open that map. Expected safe: the hostile style is **never applied**, `window.__advPwned` stays undefined, and the attribution is empty or the operator's.
- [ ] **The same hostile spec under `default`**, for context rather than a regression of this PR, since `main` behaves the same. Record whether `window.__advPwned` becomes `1`. If it does, that is a **pre-existing** spec-URL attribution XSS that `custom` and `none` now close off. File it as its own bug, not as a #910 finding.
- [ ] **Operator attribution containing HTML.** `custom` with an XYZ template and `"BASEMAP_ATTRIBUTION":"<img src=x onerror=\"window.__advAttr=1\">"`. Record whether `window.__advAttr` becomes `1`. This input is operator-controlled (the Helm value or container env), so it's trusted per the security review. Expected: if it executes, record it as a finding to waive with that reason or to fix by setting text rather than HTML. Either way, decide it explicitly.
- [ ] `custom` with `BASEMAP_STYLE_URL` = `data:application/json,{"version":8,"sources":{},"layers":[]}`. Expected safe: **rejected** by the reader (not `http(s)`), so no basemap and one warning naming `BASEMAP_STYLE_URL`.
- [ ] `custom` with `BASEMAP_STYLE_URL` = `//tiles.example.invalid/style.json` (protocol-relative). Expected safe: rejected (not absolute), no basemap, one warning.
- [ ] Hand-edit `config.js` into invalid JavaScript, e.g. a dropped closing `}`. Expected safe: `window.__RUNTIME_CONFIG__` is undefined, so the basemap falls back to `default` (the SaaS defaults; the auth config fails the same way). Record what the app does. This is an operator mistake outside the chart, since the chart renders the file. — manual (judge whether the failure mode is acceptable)

## §3 — Concurrency & races

- [ ] `custom` with an unreachable `BASEMAP_STYLE_URL` (`https://tiles.adv.invalid/style.json`). Open Map A, and **within 1s** toggle the theme 5 times. Expected safe: the final map is in the final theme, exactly **one** notice is visible (no stacked notices), points are drawn, and the console has no React "state update on unmounted" or MapLibre "map removed" errors.
- [ ] Same config. Open Map A and click **Refresh** (the widget's refresh control) twice quickly while the fallback is happening. Expected safe: the map rebuilds, the notice appears exactly once on the final map, and points are drawn.
- [ ] `custom` with a style URL that **hangs**. Use DevTools request blocking with "Slow 3G", or a local endpoint that never responds. Open Map A, then navigate away to `/` at about 5s. Expected safe: no console error fires at 10s (the timer was cleared on unmount), and returning to Map A starts a fresh 10s window. — manual (needs a hanging endpoint)
- [ ] `default`. Open the portal holding both maps (`/portals/564f2b2e…`) and scroll quickly up and down so the two map blocks mount and unmount repeatedly. Expected safe: no `[basemap]` warning, and no growing WebGL context count (`WARNING: Too many active WebGL contexts`).

## §4 — Auth & permission boundaries
- N/A. No route, permission or capability is added. `config.js` is a public static file whose values are non-secret by contract. Changing it needs operator (deploy) access, not app permissions. An app user's only lever is a spec `{url}`, which §2 covers.

## §5 — Multi-tenant isolation
- N/A. The setting is install-wide by PRD decision and carries no org id or org data. The one cross-tenant question, whether config.js differs per org, has the answer "no, by design".

## §6 — State & lifecycle abuse

- [ ] With Map A open under `default`, edit `config.js` to `none` **without reloading** and wait 30s. Expected safe: nothing changes until reload (the config loads once before the bundle, and the widget caches it). There's no partial state, such as a notice without a style change. After a hard reload, `none` applies.
- [ ] A pin created under `default` with a spec `{url}` (Map B), viewed after switching to `custom` and then back to `default`. Expected safe: `custom` shows the operator style; back on `default`, Map B shows demotiles again. The spec is never rewritten in storage (check that `portal_results.content->spec->basemap` is unchanged). — backend (the DB read)
- [ ] `custom` with a working style JSON that references a **sprite** and **glyphs** at an unreachable host (`"sprite":"https://adv.invalid/sprite","glyphs":"https://adv.invalid/{fontstack}/{range}.pbf"`, plus a symbol layer). Expected safe: the style itself loads, so there is **no** style swap. Points render. Record whether the notice appears: sprite and glyph errors come after `style.load`, with no basemap `sourceId`. Judge whether a missing notice is acceptable here. — manual (judgment)

## §7 — Misuse sequences (plausible operator mistakes)

- [ ] `custom` with `BASEMAP_STYLE_URL` pointing at a **single PNG**, not a template (`http://localhost:3000/apple-touch-icon.png`, no `{z}`). Expected safe: it's treated as style JSON, fails to parse, and shows the notice with points drawn. Nothing hangs.
- [ ] `custom` with a Leaflet-style template `https://{s}.tile.adv.invalid/{z}/{x}/{y}.png`. Expected safe: the tiles fail and the notice shows (the README warns that `{s}` isn't expanded). Points are drawn.
- [ ] `custom` with `BASEMAP_STYLE_URL` = `https://example.com/style.json` (a real host that returns HTML and sends no CORS headers). Expected safe: a CORS or parse failure shows the notice with points drawn.
- [ ] `helm template p deploy/helm/portalai --set image.api.repository=a --set image.api.tag=t --set image.web.repository=b --set image.web.tag=t --set web.basemap=null`. Expected safe: the render **fails** with an error. A nil-pointer template error is acceptable, a silent render with an empty `BASEMAP_MODE` is not. Record the message. — backend
- [ ] The same render with `--set web.basemap.extra=1`. Expected safe: refused by `additionalProperties: false`. — backend
- [ ] The same render with `--set web.env.BASEMAP_MODE=bogus`. Expected safe: Helm accepts it (`web.env` is free-form), and the container's `BASEMAP_MODE` is `bogus` (env wins over the ConfigMap). The SPA then fails closed to no basemap with one warning, never CARTO. Record the rendered env order. — backend

## Findings

| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | low / med / high | fixed-in-PR / waived: <reason> |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] `<date + name>` — confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro (config.js values / helm args / prompt) · Identifiers (org / portal / pin ids) · Console + DevTools Network excerpt:
