# Public marketing site (`apps/site`) — Spec

**Issue:** [EnterpriseBT/portal-ai#311](https://github.com/EnterpriseBT/portal-ai/issues/311) · **Discovery:** `docs/MARKETING_SITE.discovery.md`

Pins the contract for the public marketing site: the `public` + `displayOrder` tier columns and their `tier apply` convergence, the `GET /api/public/site-config` endpoint (shape, caching, rate limit, fail-closed price rule), the runtime SSM business-config reader, the glossary/FAQ relocation into `@portalai/core`, the WOFF2 font pipeline, the `apps/site` Astro package (token bridge, theme protocol, SEO surface), `site.yml` + the CloudFront Function, and the reusable static-site deploy workflow with its three rebuild triggers.

## Key decisions (flag for review)

Ratified from discovery (D1–D6 + resolved open questions):

1. **D1/C — token bridge, zero React by default.** CSS custom properties generated from the theme JSONs' portable lines (`2-187`); fonts via `@portalai/core/styles/fonts`; islands only by justified exception (none expected).
2. **D2/A — inline blocking theme script** on the shared `"portalai-theme"` localStorage key, **including its JSON encoding** (the stored value is `"brand.dark"` *with quotes*, per `apps/web/src/utils/storage.util.ts:39-79`).
3. **D3/A — runtime SSM contact config** in the API, TTL-cached, fail-soft to `process.env`; `backend.yml`'s TaskRole gains `ssm:GetParameters`.
4. **D4/A — amounts from persisted `stripePriceId` via `StripeService.getPrice`**, with the split rule: `stripePriceId === null` → legitimate contact card; non-null but unresolvable → **503, build fails**.
5. **D5/A — new `site.yml` sibling stack** with a CloudFront Function for directory-index rewrite and a real 404, and **discriminated export/physical names** (`frontend.yml`'s collide).
6. **D6/A — reusable `deploy-static-site.yml`** + thin dev (`push: main`) and prod (`release: published`, `prod` GitHub Environment) callers; three rebuild triggers funnel into one `repository_dispatch` event type; prod builds from the latest release tag.
7. **Confirmed:** WOFF2 conversion in `core`'s asset build; `.astro` joins prettier/lint-staged; fully-permissive `robots.txt` allow-list; prod API URL stays an unset input until #83.

Inferred in this spec (not stated in discovery — confirm):

8. **DB column is `is_public`** (property `public` on all schemas) — `PUBLIC` is a reserved word in Postgres; Drizzle quotes DDL, but raw `psql` operator sessions shouldn't need quoting.
9. **New CHECK `tiers_public_org_check`** (`is_public = false OR visible_to_organization_id IS NULL`) — makes "public ∧ org-private" unrepresentable at the DB, not just filtered by the finder.
10. **The snapshot cache is in-process TTL, not Redis.** Discovery's rec 8 said "Redis-backed response cache"; this spec pins an in-process 60s snapshot cache in `SiteConfigService` (same shape as `priceCache`). Per-instance staleness ≤60s is harmless for marketing facts, and the Redis hop buys nothing the rate limit doesn't already provide.
11. **Glossary/FAQ land under a new `@portalai/core/content` subpath** (`packages/core/src/content/`), not `./utils` — they are product content, and the CLI packages import `./utils`.
12. **The API fires `repository_dispatch` itself** (Stripe `price.*` webhook path) via a new fine-grained `GITHUB_DISPATCH_TOKEN` secret; `portalops` fires it from the operator's shell `GITHUB_TOKEN`. Dispatch failures never fail the webhook or the CLI write — the nightly schedule is the safety net.

## Scope

### In scope

1. `tiers.public` + `tiers.displayOrder` through the full dual-schema chain + migration + `tier apply` convergence + seed.
2. `GET /api/public/site-config` — contract schema, service, router, rate limit, OpenAPI registration.
3. `BusinessConfigService` (runtime SSM, TTL-cached, env fallback) + two new `portalops vars` catalog keys.
4. `RebuildDispatchService` (API-side) + `portalops` post-write dispatch + the three-trigger rebuild wiring.
5. `glossary.util.ts` / `faq.util.ts` → `@portalai/core/content`; `apps/web` repoints; site consumes for vocabulary + `FAQPage` JSON-LD.
6. WOFF2 font pipeline in `packages/core`'s asset build.
7. `apps/site` Astro package: pages, token bridge, theme protocol, SEO/JSON-LD/sitemap/robots/llms.txt, build-time config fetch (fail-loud).
8. `infra/cloudformation/site.yml` + CloudFront Function.
9. `.github/workflows/deploy-static-site.yml` + `deploy-site-dev.yml` + `deploy-site-prod.yml`; `deploy-dev.yml` gains the site stack in `deploy-infra`.
10. Doc sync (CLAUDE.md + mirror, READMEs, COMMANDS.md, doc-surfaces inventory, font correction).

### Out of scope

- Blog/resources, lead capture, analytics/consent, CMS, apex/`www`, i18n (ticket).
- Prod pipelines for `apps/web`/`apps/api`; prod API/Auth0/Stripe instantiation (#83).
- Legal copy text (business-supplied on this branch before the prod tag).
- `lint`/`type-check` in CI (separate ticket, user-filed).
- Repointing `apps/web`'s hardcoded `SUPPORT_MAILTO` (`apps/web/src/utils/tier-format.util.ts:16`, `mailto:ben.turner@btdev.io`) at the endpoint — noted drift, separate change; the grep criterion covers `apps/site` only.
- A non-React token accessor as supported `core` public API (site generates its own CSS variables at build time).

## Surface

### 1. `tiers` table — `apps/api/src/db/schema/tiers.table.ts`

Two columns appended after `visibleToOrganizationId` (`:70-75`):

```ts
/** #311: served to anonymous visitors by GET /api/public/site-config.
 *  Fail-closed default — a row is invisible to the marketing site unless
 *  the catalog explicitly marks it. Column `is_public`: PUBLIC is a
 *  Postgres reserved word. */
public: boolean("is_public").notNull().default(false),
/** #311: pricing-card order (ascending). Converged from the catalog. */
displayOrder: integer("display_order").notNull().default(0),
```

New CHECK (after `tiers_cta_price_check`, `:96-99`):

```ts
// #311: a public tier can never be org-private — unrepresentable, not
// merely filtered.
check(
  "tiers_public_org_check",
  sql`${t.public} = false OR ${t.visibleToOrganizationId} IS NULL`
),
```

Dual-schema chain: `TierSchema` (`packages/core/src/models/tier.model.ts:101-138`) gains `public: z.boolean()` and `displayOrder: z.number().int()`; `apps/api/src/db/schema/zod.ts` regenerates; `type-checks.ts` bidirectional `IsAssignable` holds (build fails otherwise).

### 2. Tier catalog + `tier apply` — `packages/core/src/registries/tier-catalog.ts`, `packages/devops-cli/src/commands/tier.ts`

`TierCatalogEntrySchema` (`tier-catalog.ts:23-50`) gains:

```ts
/** #311: served on the public marketing site. */
public: z.boolean(),
/** #311: pricing-card order, ascending. */
displayOrder: z.number().int().nonnegative(),
```

Catalog values: all four entries `public: true`; `displayOrder`: `standard` 1, `plus` 2, `pro` 3, `enterprise` 4.

`CONVERGED_POLICY_FIELDS` (`tier.ts:61-80`) appends `"public", "displayOrder"` (before `"cta"`; order = render order). `computeTierChanges` (`:127`) needs no change — it iterates the constant. `SeedService.seedTiers` (`apps/api/src/services/seed.service.ts:329-357`) needs no change — the new fields ride in via `...policy` exactly as `cta` does.

### 3. Repository — `apps/api/src/db/repositories/tiers.repository.ts`

New finder alongside `findSelectableForOrg` (`:49-67`):

```ts
/** #311: tiers served to ANONYMOUS visitors (public marketing site).
 *  Predicates on BOTH `public = true` AND `visibleToOrganizationId IS
 *  NULL` — belt to the DB CHECK's braces; a per-client private tier must
 *  be provably absent. Ordered by displayOrder, then created. */
async findPublic(client: DbClient = db): Promise<TierSelect[]>
```

`where`: `and(eq(tiers.public, true), isNull(tiers.visibleToOrganizationId), this.notDeleted())`; `orderBy(tiers.displayOrder, tiers.created)`.

### 4. Public contract — `packages/core/src/contracts/site-config.contract.ts` (new)

```ts
import { z } from "zod";
import { TierCtaSchema } from "../models/tier.model.js";

/** Stripe-resolved display price (mirrors BillingTierSchema.price). */
export const PublicSitePriceSchema = z.object({
  unitAmount: z.number().int(), // cents
  currency: z.string(),
  interval: z.enum(["month", "year"]),
});

/** One marketing-site tier card. A PRESENTATION snapshot — deliberately
 *  NOT TierPolicy: no charge grid, perToolCaps, period, or overage
 *  (billing internals #172/#214 will keep moving). Additions are additive. */
export const PublicSiteTierSchema = z.object({
  slug: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  cta: TierCtaSchema,
  displayOrder: z.number().int(),
  /** Monthly credit allocation per charged class; null = unlimited.
   *  `free` is deliberately absent — never charged, never marketed. */
  credits: z.object({
    metered: z.number().int().nullable(),
    expensive: z.number().int().nullable(),
  }),
  /** Built-in pack slugs; the site maps slugs → display copy via
   *  @portalai/core/registries at build time. */
  builtinToolpacks: z.array(z.string()),
  customToolpacks: z.boolean(),
  /** null ⇔ stripePriceId null (contact card). An unresolvable non-null
   *  price is a 503, never a null here — the split rule. */
  price: PublicSitePriceSchema.nullable(),
});

export const PublicSiteContactSchema = z.object({
  supportEmail: z.string(),
  salesEmail: z.string(),
});

/** GET /api/public/site-config response — one atomic snapshot. */
export const PublicSiteConfigResponseSchema = z.object({
  tiers: z.array(PublicSiteTierSchema),
  contact: PublicSiteContactSchema,
  /** ISO timestamp of snapshot assembly — baked into the site's meta stamp. */
  generatedAt: z.string(),
});
export type PublicSiteConfigResponse = z.infer<typeof PublicSiteConfigResponseSchema>;
```

Exported from the contracts barrel. Registered in `swagger.config.ts` as a `publicSiteSchemas` const (sibling of `billingSchemas:227-248`) spread at `:1643-1650`: components `PublicSiteConfigResponse`.

### 5. `BusinessConfigService` — `apps/api/src/services/business-config.service.ts` (new)

Static-method class (API style guide), the repo's first runtime SSM reader:

```ts
export interface ContactConfig { supportEmail: string; salesEmail: string }

export class BusinessConfigService {
  /** SSM GetParameters over the two contact paths, TTL-cached
   *  (CONTACT_CACHE_TTL_MS = 300_000). Fail-SOFT: any SSM error, missing
   *  parameter, or unset BUSINESS_CONFIG_SSM_PREFIX falls back to
   *  environment.SUPPORT_EMAIL / SALES_EMAIL (warn once per TTL window).
   *  Never throws. */
  static async getContact(): Promise<ContactConfig>;
  /** Test seam. */
  static clearCache(): void;
}
```

- Paths: `${environment.BUSINESS_CONFIG_SSM_PREFIX}/support-email`, `…/sales-email` — matching the `portalops` catalog leaf names exactly.
- Dependency: `@aws-sdk/client-ssm` in `apps/api` (its first config-time AWS SDK; S3 precedent at `services/s3.service.ts:9-10`).
- `apps/api/src/environment.ts` additions (frozen-literal style): `SUPPORT_EMAIL` (default `""`), `SALES_EMAIL` (default `""`), `BUSINESS_CONFIG_SSM_PREFIX` (default `""` = SSM disabled → env-only; local dev needs no AWS credentials), `GITHUB_DISPATCH_TOKEN` (default `""`), `GITHUB_DISPATCH_REPO` (default `"EnterpriseBT/portal-ai"`).

### 6. `SiteConfigService` — `apps/api/src/services/site-config.service.ts` (new)

```ts
export class SiteConfigService {
  /** Assemble the snapshot: tiersRepo.findPublic() → map rows →
   *  { tiers, contact, generatedAt }. In-process TTL cache
   *  (SITE_CONFIG_CACHE_TTL_MS = 60_000), priceCache shape — errors are
   *  never cached. */
  static async getSiteConfig(): Promise<PublicSiteConfigResponse>;
  static clearCache(): void;
}
```

Per-row mapping: `credits.metered = meteredUnitsPerPeriod`, `credits.expensive = expensiveUnitsPerPeriod`; `price`:

- `stripePriceId === null` → `price: null` (legitimate contact card).
- `stripePriceId` set → `StripeService.getPrice(stripePriceId)` (`stripe.service.ts:190-227`); a `null` return **throws** `ApiError(503, ApiCode.SITE_CONFIG_PRICE_UNRESOLVED, …)` — the split rule. (`getPrice` itself is unchanged; the distinction lives here.)

### 7. Rate limit + router — `apps/api/src/middleware/public-rate-limit.middleware.ts`, `apps/api/src/routes/public-site.router.ts` (new)

**Middleware** `publicRateLimit(limitPerMinute = 60)`: keys `incrementRateWindow` (`rate-limit.util.ts:21`) with `` `public-site:${req.ip}` ``; count > limit → `next(new ApiError(429, ApiCode.SITE_CONFIG_RATE_LIMITED, …))`. Redis error → **fail-open** (matches the util's documented contract, `rate-limit.util.ts:5-7`; a marketing-page fetch must not 500 on a Redis blip — conscious, recorded).

**Router**: `GET /site-config` → rate limit → `SiteConfigService.getSiteConfig()` → set `Cache-Control: public, max-age=60, s-maxage=300` (honest note: no CDN fronts the API today; `s-maxage` is correct-but-inert) → validate against `PublicSiteConfigResponseSchema` → 200. Full `@openapi` block, **no `security` key**, `$ref` to `PublicSiteConfigResponse`, documented 429 + 503 responses.

**Mount** (`apps/api/src/app.ts`, after `:59`, before `:60`): `app.use("/api/public", publicSiteRouter);` with a comment matching the sibling mounts' style (anonymous by design; rate-limited; serves no tenant data).

**`ApiCode` additions** (`apps/api/src/constants/api-codes.constants.ts`, `<DOMAIN>_<FAILURE>`): `SITE_CONFIG_PRICE_UNRESOLVED`, `SITE_CONFIG_RATE_LIMITED` (+ their message-map entries).

### 8. Rebuild dispatch — API + `portalops` + catalog

**`apps/api/src/services/rebuild-dispatch.service.ts`** (new):

```ts
export class RebuildDispatchService {
  /** POST https://api.github.com/repos/${GITHUB_DISPATCH_REPO}/dispatches
   *  { event_type: "site-config-changed", client_payload: { reason } }
   *  with GITHUB_DISPATCH_TOKEN. Fire-and-forget: unset token → debug-log
   *  and return; HTTP failure → warn. NEVER throws — the nightly schedule
   *  is the safety net. */
  static async fireSiteRebuild(reason: string): Promise<void>;
}
```

Wired into the Stripe webhook path: `BillingService`'s event handling treats `price.created` / `price.updated` / `price.deleted` as "record `ignored` (unchanged semantics) + `fireSiteRebuild("stripe:" + event.type)`". No tier convergence happens here — `tier apply` owns price↔tier pointing; the dispatch only refreshes baked amounts.

**`packages/devops-cli`**: `CatalogEntry` (`catalog.ts:18-26`) gains `siteConfig?: boolean`; `CATALOG` gains `ssm("SUPPORT_EMAIL", "support-email")` and `ssm("SALES_EMAIL", "sales-email")`, both `siteConfig: true`. New `packages/devops-cli/src/github-dispatch.ts` exports `fireSiteRebuild(reason)` using the operator's shell `GITHUB_TOKEN` (unset → one-line notice, exit 0 — never blocks the write). Called after: a successful `vars set` of a `siteConfig` key, and a non-dry-run `tier apply` with ≥1 change. Documented in `COMMANDS.md`.

**Token**: `GITHUB_DISPATCH_TOKEN` joins the secret catalog (`secret("GITHUB_DISPATCH_TOKEN", "github-dispatch-token")`) and `backend.yml`'s `Secrets` block (`:480-516` pattern) — a fine-grained PAT scoped to this repo, Contents: read + Actions/repository dispatch only.

### 9. Glossary/FAQ → `@portalai/core/content`

- New `packages/core/src/content/`: `glossary.util.ts`, `faq.util.ts`, `index.ts` barrel; new `./content` subpath in `packages/core/package.json` `exports` (same triple shape as `./registries`, `:38-43`).
- `faq.util.ts` (27 entries, zero imports) moves verbatim.
- `glossary.util.ts` moves with **`pageRoute` values stripped** (the type is already `pageRoute?: string`, `:29`; the 27 `ApplicationRoute` assignments are the app coupling). New `apps/web/src/utils/glossary-routes.util.ts`: `GLOSSARY_PAGE_ROUTES: Partial<Record<string, ApplicationRoute>>` (term → route, the 27 pairs) + `withPageRoutes(entries: GlossaryEntry[]): GlossaryEntry[]`.
- `apps/web` repoints: `Help.view.tsx` + glossary/FAQ components import from `@portalai/core/content` (glossary wrapped in `withPageRoutes`); `getting-started.util.ts` stays (hard `ApplicationRoute` dependency, `:9`).
- Pinning tests move: `glossary.util.test.ts`, `faq.util.test.ts` → `packages/core/src/__tests__/content/` (route-pinning assertions stay behind in a new `apps/web/src/__tests__/glossary-routes.util.test.ts`).

### 10. WOFF2 pipeline — `packages/core`

- devDependency `ttf2woff2`; new `build:fonts` script converting `src/assets/fonts/*.ttf` → `dist/fonts/*.woff2` (TTFs still copied by `build:assets`, `package.json:79`, as fallbacks).
- `fonts.scss:2-80`: every `@font-face` `src` becomes `url("../fonts/<X>.woff2") format("woff2"), url("../fonts/<X>.ttf") format("truetype")`. Family names, weights, `font-display: swap` unchanged. Consumers (`apps/web/src/main.tsx:6`, the site) change nothing.

### 11. `apps/site` — the Astro package

**Package**: `@portalai/site`, `private: true`, deps `astro`, `@astrojs/sitemap`, `@portalai/core`; devDeps `prettier-plugin-astro`, `eslint-plugin-astro`, jest/ts-jest (per-package ESM preset, `apps/web/jest.config.js` shape). Scripts: `dev` (`astro dev --port 3002`), `build` (`astro build`, preceded by token generation), `preview`, `lint`/`lint:fix` (`--max-warnings 0`), `format`/`format:check` (globs include `.astro`), `type-check` (`astro check`), `test:unit` (jest over `src/lib`/`scripts`), `test:integration": "true"`, `clean`. Root lint-staged glob (`package.json:44-46`) extends to `…/*.{ts,tsx,json,css,scss,astro}`; `prettier-plugin-astro` registers in `.prettierrc.json` `plugins`. `tsconfig.json` extends `astro/tsconfigs/strict` (not the root — Astro's compiler options conflict with `composite`; deviation noted).

**Astro config**: `site` from `SITE_URL` env, `trailingSlash: "always"`, default `build.format: "directory"`, `@astrojs/sitemap` integration, `outDir: dist`.

**Build-time config** — `src/lib/site-config.ts`: `fetchSiteConfig(): Promise<PublicSiteConfigResponse>` — fetches `SITE_CONFIG_URL`, parses with `PublicSiteConfigResponseSchema` from `@portalai/core/contracts`; **any fetch error, non-200, or parse failure throws** (build fails loudly — the ticket's rule). Called once, threaded to every page (atomic snapshot). Build env contract: `SITE_URL`, `SITE_CONFIG_URL`, `SITE_APP_URL` (signup CTA target) — all three required, build throws if unset.

**Token bridge** — `scripts/generate-tokens.mjs` (runs before `astro build` and `astro dev`): reads both theme JSONs' `palette`/`typography`/`spacing`/`shape`/`breakpoints`, emits `src/styles/tokens.css` with the two sets under `:root[data-theme="light"]` / `:root[data-theme="dark"]` (naming: `--color-*`, `--font-*`, `--space-unit`, `--radius-*`, `--bp-*`). Generated file is gitignored.

**Theme protocol** — inline `<head>` script (sub-1kB, in the base layout): read `localStorage["portalai-theme"]`, `JSON.parse` (app encoding), map `"brand"`→light / `"brand.dark"`→dark, else `matchMedia("(prefers-color-scheme: dark)")`; stamp `data-theme` on `<html>` before paint. Visible toggle writes the same key via `JSON.stringify`.

**Pages** (each with unique `<title>`, meta description, self-referencing canonical, OG/Twitter tags + share image, one `<h1>`, JSON-LD): `index` (Organization + WebSite + SoftwareApplication with `Offer`s from real amounts), `features/`, `use-cases/<n×persona>/`, `pricing/` (cards from the snapshot; `price: null` → contact card, CTA → `/contact/`; else CTA → `SITE_APP_URL` signup; BreadcrumbList), `contact/` (endpoint-sourced addresses), `privacy/` + `terms/` (structure only; business copy lands on this branch before the prod tag), `404`. Every page carries `<meta name="portal:build" content="<git sha> <generatedAt>">`. Static files: `robots.txt` (explicit allow-list: `GPTBot`, `ClaudeBot`, `PerplexityBot`, `Google-Extended`, `CCBot`, `Bingbot`, `Googlebot` + `Sitemap:` line), `llms.txt` (product summary + canonical page pointers). Vocabulary copy imports `@portalai/core/content` (glossary definitions + `FAQPage` JSON-LD from FAQ entries).

### 12. Infra — `infra/cloudformation/site.yml` (new)

Sibling of `frontend.yml`: same params (`Environment [dev, prod]`, `Subdomain` default `site-dev`, `DomainName`, `CertificateArn`, `HostedZoneId`), same private-bucket + access-log + OAC + Route 53 shape. Differences:

- **Physical names**: `portalai-${Environment}-site-oac`, `portalai-${Environment}-site-headers` (frontend's collide, `frontend.yml:110,129`).
- **Exports**: `${Environment}-SiteBucketName`, `${Environment}-SiteDistributionId`.
- **`AWS::CloudFront::Function`** (`SiteIndexRewrite`, viewer-request, `cloudfront-js-2.0`): URI ends `/` → append `index.html`; last segment has no `.` → append `/index.html` (301-free normalization consistent with `trailingSlash: "always"`).
- **`CustomErrorResponses`**: 403 and 404 → `ResponsePagePath: /404.html`, **`ResponseCode: 404`**. No SPA rewrite, no COOP header.

`deploy-dev.yml`'s `deploy-infra` job gains the site stack deploy step (after frontend, same inline `cloudformation deploy` pattern). The prod caller deploys `dns-certs` + `site.yml` with `Environment=prod` before syncing (the only two stacks the site needs; no prod network/database dependency).

### 13. CI/CD — `.github/workflows/`

**`deploy-static-site.yml`** (`workflow_call`). Inputs: `environment` (`dev|prod`), `subdomain`, `build-ref`, `site-url`, `site-config-url`, `app-url`; secrets: `aws-role-arn`, `hosted-zone-id`. Steps: checkout `build-ref` → `./.github/actions/setup` → OIDC assume → deploy `site.yml` (prod also `dns-certs`) → `npx turbo run build --filter=@portalai/site` with the three site env vars → read `${environment}-SiteBucketName`/`-SiteDistributionId` via `describe-stacks` → **two-pass sync**: `aws s3 sync dist/ --exclude "*.html" --cache-control "public, max-age=31536000, immutable"` then `--include "*.html" --include "*.xml" --include "*.txt" --cache-control "public, max-age=0, must-revalidate"` (both `--delete`-safe ordering) → `create-invalidation --paths "/*"`.

**`deploy-site-dev.yml`**: triggers `push: [main]`, `repository_dispatch: [site-config-changed]`, `schedule: cron "0 9 * * *"`, `workflow_dispatch`; concurrency `deploy-site-dev`; calls the reusable workflow with `build-ref: main`, dev URLs (`https://site-dev.portalsai.io`, `https://api-dev.portalsai.io/api/public/site-config`, `https://app-dev.portalsai.io`), `secrets.AWS_ROLE_ARN` + `DEV_HOSTED_ZONE_ID`.

**`deploy-site-prod.yml`**: triggers `release: [published]`, `repository_dispatch: [site-config-changed]`, `workflow_dispatch`; **`environment: prod`** (new GitHub Environment, required reviewers; holds `PROD_AWS_ROLE_ARN`, `PROD_HOSTED_ZONE_ID`); a resolve-ref step: `release` event → the release tag, dispatch/manual → latest release tag via `gh release view --json tagName` (**never `main`**; no release exists → skip cleanly); prod URLs with the API base URL a caller-level input **left unset until #83** — unset → the job exits early with a notice instead of building against a nonexistent origin.

## Migration

`npm run db:generate -- --name tier-public-display-order` (from `apps/api/`): adds `is_public boolean NOT NULL DEFAULT false`, `display_order integer NOT NULL DEFAULT 0`, and `tiers_public_org_check`. No backfill — existing rows default non-public (fail-closed); each env goes public via `portalops tier apply --env <e>` after deploy (migration → apply, that order). No production data exists; no dual-write needed.

## Seed

No `seed.service.ts` change: `seedTiers` (`:329-357`) spreads catalog policy fields, so `public`/`displayOrder` ride in automatically. The seeded `standard` row is `public: true, displayOrder: 1` from the catalog.

## TDD test plan

All via `npm run test:unit` / `npm run test:integration` per package — never raw jest.

### `packages/core`

- `src/__tests__/registries/tier-catalog.test.ts` (existing, extend): every entry carries `public`/`displayOrder`; orders are unique + ascending; schema rejects negative `displayOrder`. (3)
- `src/__tests__/contracts/site-config.contract.test.ts` (new): parses a full snapshot; rejects a tier with extra `perToolCaps`-like leakage via `.strict()` expectations on the pinned keys; `price` nullable round-trip. (3)
- `src/__tests__/content/glossary.util.test.ts` + `faq.util.test.ts` (moved from `apps/web`): pinning assertions unchanged minus route pins; **new** assertion: no `pageRoute` value present in core data; glossary module has no `apps/web` imports. (2 suites + 2 new cases)

### `packages/devops-cli`

- `tier.test.ts` (extend): `CONVERGED_POLICY_FIELDS` includes `public`/`displayOrder`; convergence diff flips a live `is_public=false` row to true; catalog↔`TierSchema` mirror still pins. (3)
- `catalog.test.ts` (extend): the two new ssm keys resolve paths; `siteConfig` marker present. (2)
- `github-dispatch.test.ts` (new): fires with token; unset token → no-op notice, exit 0; HTTP 4xx → warning, not error. (3)

### `apps/api` (unit)

- `db/repositories/tiers.repository` (extend): `findPublic` excludes non-public rows; **excludes a `public`-flagged-but-org-scoped row** (the named private-tier test — constructed below the CHECK via mock rows); orders by `displayOrder`. (3)
- `services/site-config.service.test.ts` (new): happy snapshot; `stripePriceId: null` → `price: null` (no throw); resolvable price mapped; **unresolvable non-null price → ApiError 503 `SITE_CONFIG_PRICE_UNRESOLVED`**; TTL cache hit skips repo/Stripe; error not cached. (6)
- `services/business-config.service.test.ts` (new): SSM values win; SSM error → env fallback (no throw); unset prefix → env-only, SSM never called; cache TTL respected. (4)
- `middleware/public-rate-limit.test.ts` (new): under limit passes; over limit → 429 `SITE_CONFIG_RATE_LIMITED`; Redis error → fail-open. (3)
- `services/billing.service.test.ts` (extend): `price.updated` event → recorded `ignored` + `fireSiteRebuild` called; dispatch failure doesn't fail the webhook. (2)

### `apps/api` (integration — `src/__tests__/__integration__/routes/`)

- `public-site.router.integration.test.ts` (new): 200 with **no Authorization header**; response validates against the contract and contains no org/user/usage keys; a seeded org-private tier row is absent; `Cache-Control` header present; 429 after limit exhaustion. (5)

### `apps/web`

- Existing `HelpView.test.tsx` + component suites pass against the repointed imports (moved-import regression, no new cases).
- `glossary-routes.util.test.ts` (new): every mapped term exists in core's glossary; `withPageRoutes` merges without dropping entries. (2)

### `apps/site`

- `src/lib/__tests__/site-config.test.ts` (new): valid payload parses; non-200 throws; shape-mismatch throws (fail-loud rule). (3)
- `scripts/__tests__/generate-tokens.test.ts` (new): emits both `data-theme` blocks from the real theme JSONs; palette hex + font family values present; deterministic output. (3)

**Totals ≈ 40 cases** (new + extended; the two moved core suites re-run existing assertions).

## Acceptance criteria

Lifted from #311 (the smoke doc will map these 1:1):

- Every `site-dev.portalsai.io` page `curl`s to full HTML: copy, nav, JSON-LD, and real tier names + amounts on Pricing — no JS executed.
- `grep` over `apps/site` finds no hardcoded amount or contact email.
- `GET /api/public/site-config` returns 200 with no `Authorization` header and exposes no org/user/usage data; a non-public or org-private tier is absent; flipping `public` via `tier apply` + rebuild changes the site with no code change.
- A public tier without a Stripe price renders the contact card (CTA → Contact); the build does **not** fail on it. Taking the endpoint down (or an unresolvable priced tier) **fails the build**.
- `portalops vars set` of a support email + the fired rebuild updates the site with no manual deploy.
- Unique title/description/canonical per page; sitemap covers every route; `robots.txt` references it; `llms.txt` served; Slack unfurls correctly; Rich Results Test passes on Home/Features/Pricing; Lighthouse SEO 100 / a11y ≥95; no horizontal scroll at mobile widths.
- Light + dark verified side-by-side against the app; toggle persists; no wrong-theme flash.
- Release/tag publish → `site.portalsai.io` only; push to `main` → `site-dev` only; prod job blocks on the `prod` Environment review and skips while the prod API input is unset.
- Root `build`/`lint`/`type-check`/`format:check`/`test:unit` pass with `apps/site`; `npm run dev` brings the site up on `:3002` beside web/api.
- Nonexistent path → branded 404 with HTTP 404, not S3 XML and not a soft-404 200.

## Risks & rollback

- **Wrong price published** — the split rule fails closed (503 → failed build → previous site stays up, since a failed build never reaches `s3 sync`). Detection: the failed workflow run.
- **Rate-limit fail-open + SSM/Stripe TTL caches** mean an abusive client costs at most one upstream round-trip per TTL window per instance; quota exhaustion on Stripe is not reachable through this surface. Conscious fail-open recorded in the Surface.
- **`GITHUB_DISPATCH_TOKEN` compromise** — fine-grained, single-repo, dispatch-only: blast radius is spurious rebuilds (idempotent, config still fetched fresh). Rotate via `portalops vars set`.
- **Glossary move breaks Help** — covered by the existing web suites running against repointed imports; rollback is re-exporting from the old paths (one-commit revert).
- **CloudFront Function bug** (rewrite loop / wrong index) — scoped to the new site distribution only; `frontend.yml` untouched. Rollback: delete the `site.yml` stack; nothing else references its exports.
- **Migration rollback**: drop the two columns + CHECK; no data loss (both derivable from the catalog).
- **Prod caller mis-fire before #83** — structurally prevented: unset API-base input → early exit; `prod` Environment review gates the rest.

## Files touched

**New**: `packages/core/src/contracts/site-config.contract.ts` · `packages/core/src/content/{glossary.util,faq.util,index}.ts` · `apps/api/src/services/{site-config,business-config,rebuild-dispatch}.service.ts` · `apps/api/src/middleware/public-rate-limit.middleware.ts` · `apps/api/src/routes/public-site.router.ts` · `apps/web/src/utils/glossary-routes.util.ts` · `packages/devops-cli/src/github-dispatch.ts` · `apps/site/**` (package) · `infra/cloudformation/site.yml` · `.github/workflows/{deploy-static-site,deploy-site-dev,deploy-site-prod}.yml` · migration · new/moved test files per the plan.

**Edited**: `tiers.table.ts` · `tier.model.ts` · `db/schema/zod.ts` · `type-checks.ts` · `tier-catalog.ts` · `devops-cli/src/commands/tier.ts` (+`vars.ts` hook) · `devops-cli/src/catalog.ts` · `tiers.repository.ts` · `billing.service.ts` (price.* dispatch) · `environment.ts` · `app.ts` · `api-codes.constants.ts` · `swagger.config.ts` · `packages/core/package.json` (+`fonts.scss`, `build:fonts`) · `.prettierrc.json` · root `package.json` (lint-staged) · `apps/web` imports (`Help.view.tsx`, glossary/FAQ components, tests) · `infra/cloudformation/backend.yml` (TaskRole SSM grant + dispatch-token secret) · `.github/workflows/deploy-dev.yml` (site stack step) · docs (`CLAUDE.md` + mirror incl. font correction + doc-surfaces inventory, root/`apps/site`/`packages/core` READMEs, `COMMANDS.md`).

**Deleted**: `apps/web/src/utils/{glossary.util,faq.util}.ts` (+ their old test files) — moved, not aliased (clean cut).

## Next step

`docs/MARKETING_SITE.plan.md` slices this into ~9 TDD commits on this branch, backend-first so the site never blocks on a stub: (1) tier columns through the dual-schema chain + migration + catalog + `tier apply`; (2) the public endpoint (contract, services, router, rate limit, codes, swagger); (3) SSM business config + catalog keys + task-role grant; (4) rebuild dispatch (API webhook path + `portalops` hook); (5) core content move + web repoint; (6) WOFF2 pipeline; (7) `apps/site` skeleton + token bridge + theme protocol; (8) pages + SEO + config fetch; (9) `site.yml` + workflows + doc sync. Slices 1–6 are provable by the unit/integration suites; 7–8 by the site's own tests + local build; 9 lands with the smoke doc (`/smoke 311`) as its gate.
