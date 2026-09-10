# Upgrade astro 5→7 (apps/site) — Condensed design (#547)

**Issue:** [EnterpriseBT/portal-ai#547](https://github.com/EnterpriseBT/portal-ai/issues/547) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `npm audit` (via the #545 workflow) flags **critical** advisories on `astro` (incl. AVIF-image RCE, reflected XSS/SSRF) and **high** on its bundled `sharp`/libvips/libheif. `apps/site` pins `astro@^5.16.0`; the fix is a major bump to `astro@^7.3.2` (two majors). The marketing site is static and simple, so the migration is config/build-surface only. Touches `apps/site`. **Audit 13 → 11** (clears the astro critical + sharp high).

## Current shape

| Piece | Location | Note |
|---|---|---|
| astro dep | `apps/site/package.json:24` | `^5.16.0` → `^7.3.2` |
| Integrations | `@astrojs/sitemap@^3.7.0`, `@astrojs/check@^0.9.10` | sitemap resolves 3.7.3 (astro-7-compatible; no 4.x exists); check peers only TS |
| Config | `apps/site/astro.config.mjs` | minimal: `site`, `trailingSlash:"always"`, `build.format:"directory"`, `server`, `sitemap()` — canonical-URL contract with CloudFront |
| Pages | `apps/site/src/pages/**` (11 routes) | `.astro` only; API used = `Astro.props`, `Astro.site` (both stable) |
| Build gate | `scripts/verify-pages.mjs` | asserts titles/canonicals/JSON-LD/sitemap/pricing figures |

## Decision — bump only; breaking changes don't apply

Bump astro to `^7.3.2`. Assessed every v6+v7 breaking change against the site (from the official upgrade guides): **N/A** — no content collections, no `astro:assets`/image service, no i18n, no adapter/actions, no `astro:transitions`, no `.md`/`.mdx`, no `src/fetch.ts`, no experimental flags. Node ≥22.12 (v6) is satisfied (CI node 22-latest, local 25). The two that *could* bite — the Rust compiler's stricter markup and the `compressHTML: 'jsx'` default — are covered by build + a rendered visual check. sitemap/check need no bump. **No config or code change required.**

## Plan — 1 slice

**Files**
- `apps/site/package.json` — `astro` `^5.16.0` → `^7.3.2`.
- `package-lock.json` — regenerated (astro 7.3.2, sitemap 3.7.3, vite 8, sharp dropped).
- `astro.config.mjs` — **no change** (options unchanged in v7).

**Tests** — dep bump validated by existing suites: `npm run build` (site: tokens + `astro build` + `verify-pages`), `npm run --workspace @portalai/site type-check` (`astro check`), `npm run lint`, site unit suite. Green is the gate.

## Smoke (suites + one visual check, per #551 disposition)

1. Site build green — 11 pages emitted, `sitemap-index.xml` created, `verify-pages` passes (titles/canonicals/JSON-LD/sitemap/pricing). ✓
2. `astro check` 0 errors (31 files); lint clean; site unit suite 58 pass. ✓
3. `npm audit` → `astro` + `sharp` gone (13 → 11). ✓ (residual `esbuild` is via drizzle-kit/tsx/apps/web — #553, not astro.)
4. Visual: `astro preview` the astro-7 build → `/pricing/` renders cards, prices, toolpack lists, and **inline whitespace intact** (the `compressHTML:'jsx'` risk), 0 console errors. ✓
5. Post-merge: eyeball site-dev after the `deploy-site-dev` build (real Stripe prices bake in there, not locally).

## Out of scope

- The remaining #545 findings (maplibre #548; storybook/exceljs/drizzle-kit/esbuild #553).
