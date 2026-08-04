# @portalai/site

The public marketing site — `site-dev.portalsai.io` today, `www.portalsai.io`
at launch. Astro, fully static, no client framework.

Everything here follows from one constraint: **a published page is a durable
artifact seen by strangers on unknown networks**. That is why prices are baked
in rather than fetched, why a config failure fails the build instead of
degrading, and why SEO regressions are build errors.

## Local development

```bash
npm run dev -w @portalai/site      # http://localhost:3002
```

No `.env` is required. With `SITE_CONFIG_URL` unset the build uses a
committed fixture, so the site builds offline and root `npm run build` passes
with no API running. Point it at a real endpoint to see live prices:

```bash
SITE_CONFIG_URL=http://localhost:3001/api/public/site-config \
  npm run dev -w @portalai/site
```

| Variable | Default | Purpose |
|---|---|---|
| `SITE_CONFIG_URL` | *(unset → fixture mode)* | The public snapshot endpoint. Set in every deploy. |
| `SITE_URL` | `https://site-dev.portalsai.io` | Canonical origin for canonicals, OG tags, sitemap. |
| `SITE_APP_URL` | `https://app-dev.portalsai.io` | Where sign-in/sign-up CTAs point. |
| `GITHUB_SHA` | `local` | Stamped into `<meta name="portal:build">`. |

## Where the content comes from

| Content | Source | Changing it |
|---|---|---|
| Prices, credit allocations, plan names | `GET /api/public/site-config` at build time | `portalops tier apply`, or a Stripe price edit |
| Support / sales addresses | the same snapshot (SSM behind the API) | `portalops vars set SUPPORT_EMAIL …` |
| Glossary + FAQ | `@portalai/core/content` | edit the shared module (also changes in-app Help) |
| Colours, fonts, spacing | `@portalai/core` theme JSONs → `scripts/generate-tokens.mjs` | edit the theme JSON |
| Page copy, personas | this package (`src/pages`, `src/lib/use-cases.ts`) | edit here |

**None of the top two rows is a code change.** That is the point of the
endpoint: publishing a price is an operator action.

### Fixture mode is never publishable

A fixture build stamps `fixture` into `<meta name="portal:build">`. Two
independent gates refuse to publish it: `verify-pages.mjs` fails if the stamp
is present when `SITE_CONFIG_URL` was set, and the deploy workflow greps the
built HTML for it. The fixture prices are `$0` — visibly wrong on purpose.

## The rebuild loop

The site is static, so a config change is invisible until something rebuilds
it. Three independent triggers, none load-bearing on its own:

| Trigger | Fires on | Source |
|---|---|---|
| `push` to `main` | changes to this package, shared content, or the site stack | `deploy-site-dev.yml` |
| `repository_dispatch` | a Stripe `price.*` webhook, `vars set` of a `siteConfig` key, or a `tier apply` with changes | `RebuildDispatchService` (API) / `fireSiteRebuild` (portalops) |
| `schedule` | nightly, 09:00 UTC, unconditionally | `deploy-site-dev.yml` |

**Staleness contract: ≤ 24 hours, always.** Dispatches are best-effort — they
never block the write that triggered them — so the nightly run is what turns
"probably fresh" into a bound.

## Authoring pages

- Every page uses `src/layouts/Page.astro`. It owns the entire head contract
  (title, description, self-referencing canonical, OG/Twitter, the build
  stamp, the theme script). **Never hand-roll head tags in a page** — the tags
  are uniform because no page is allowed to assemble its own.
- Pass page-specific structured data as `jsonLd`, built with the helpers in
  `src/lib/jsonld.ts`. Build it from the snapshot, never by hand: a rich
  result advertising a price the page doesn't show is worse than no rich
  result.
- Read config from `src/lib/site-context.ts`, not by calling
  `fetchSiteConfig()` again. That module's top-level await runs once per
  build, which is what guarantees every page renders from the same snapshot.
- New route → check `npm run build` still passes; `verify-pages.mjs` will
  reject a missing title, a wrong canonical, an absent sitemap entry, or
  unparseable JSON-LD.

## Tests

```bash
npm run test:unit -w @portalai/site   # jest: src/lib + scripts
npm run build -w @portalai/site       # includes the page self-check
```

Jest covers only build-time logic. **Astro components have no useful
unit-test surface** — their contract is the emitted HTML, and mocking the
renderer would assert nothing worth knowing. Their tests are
`scripts/verify-pages.mjs`, which runs against real `dist/` output as part of
`build`:

- unique, non-empty `<title>` per page; a meta description
- a self-referencing canonical matching the route
- exactly one `<h1>`; OG/Twitter tags present
- every JSON-LD block parses and carries `@context`/`@type`
- the sitemap covers every indexable route — and excludes every `noindex` one
- the pricing page renders a figure or contact card for every tier
- no fixture stamp on a live-config build

`scripts/__tests__/cloudfront-rewrite.test.ts` tests the CloudFront Function
from `infra/cloudformation/site.yml`, because what it must agree with is
`astro.config.mjs`'s `trailingSlash: "always"`. Its only other feedback loop
is a site-wide 404 discovered by visitors.

## Theming

`scripts/generate-tokens.mjs` reads `@portalai/core`'s two theme JSONs and
emits `src/styles/tokens.css` (gitignored — a build artifact). Stylesheets use
only those custom properties; no brand colour is hardcoded here.

The theme is resolved by an inline, synchronous `<head>` script before first
paint, reading the app's own `portalai-theme` localStorage key and JSON
encoding. A visitor arriving from the product keeps their choice, and nobody
sees a light-then-dark snap.

## Deploy

`deploy-site-dev.yml` and `deploy-site-prod.yml` both call the reusable
`deploy-static-site.yml`, so the two paths can't drift.

S3 sync runs in two passes: fingerprinted `_astro/*` assets first with a
one-year immutable cache (so new HTML never references an asset that isn't
uploaded yet), then HTML/XML/TXT with `must-revalidate` and `--delete` (so a
price change can't sit in a browser cache). Then a full CloudFront
invalidation.

**Production never builds from a branch.** A release event builds its tag; a
dispatch or manual run resolves the latest release tag. A merge to `main`
cannot reach the public site. Prod deploys are also gated behind the `prod`
GitHub Environment's required reviewers.

### Not yet done

- Legal pages (`/privacy/`, `/terms/`) ship structure-only behind a
  `<!-- business copy pending: blocks prod tag -->` marker and are `noindex`.
  Business-reviewed copy must replace them before any production release.
- `public/og-default.png` is a **generated placeholder** — an on-brand
  gradient card drawn from the theme palette by
  `scripts/generate-og-image.mjs`, with no wordmark (rendering text needs a
  font rasteriser, and a wrong-font wordmark looks worse than none). It makes
  shares render correctly today; a designed card should replace it before
  launch. `verify-pages.mjs` fails the build if the referenced image is
  missing from the output.
- Prod deploys exit early until the `PROD_SITE_CONFIG_URL` repository
  variable is set (the prod API is #83).
