# Public marketing site (`apps/site`) — Discovery

**Issue:** [EnterpriseBT/portal-ai#311](https://github.com/EnterpriseBT/portal-ai/issues/311)

**Why this exists.** Portal.ai has no public front door. `app-dev.portalsai.io` is the authenticated product and `api-dev.portalsai.io` is the API; nothing exists that a prospect, a search crawler, or an AI answer engine can reach. The monetization surface landing now (#172 tier credit allocation, #214 toolpack entitlement, Stripe-backed subscriptions behind `billing.router.ts:84`) means there is finally a purchasable product to advertise and a pricing story to tell — and #83's Stripe live-mode business verification requires a public site describing the offering.

The hard part is not the pages. It is that **pricing and contact facts must live in exactly one place and propagate to static HTML without a human deploy**, while the site must be byte-for-byte on-brand with an MUI/React app it shares no runtime with. This is the static publication surface that turns operator-owned business config into crawlable HTML.

## The current shape

### Monorepo tooling — a new app is nearly free

| Piece | Location | Note |
|---|---|---|
| Workspaces | `package.json:33-36` | `["apps/*", "packages/*"]` — `apps/site` is auto-included, no registration |
| Turbo tasks | `turbo.json:5-12` | `build` has `dependsOn: ["^build"]`, `outputs: ["dist/**"]` — Astro's default `dist/` already matches. Astro's `.astro/` type-gen dir is **not** in `outputs`, so it is neither cached nor restored |
| Root scripts | `package.json:5-21` | Thin `turbo run <task>` delegations; a task absent from a package's own scripts is silently skipped |
| Shared config | root `tsconfig.json:1-18` only | TSConfig **is** shared (`apps/web/tsconfig.json:2`, `apps/api/tsconfig.json:2`, `packages/core/tsconfig.json:2` all extend it) and prettier is shared (`.prettierrc.json:1-10`). ESLint is **not** — `apps/web/eslint.config.js:1-108` and `packages/core/eslint.config.js:1-87` are near-identical hand-rolled copies |
| lint-staged | `package.json:44-46` | One rule, glob `{apps,packages}/*/src/**/*.{ts,tsx,json,css,scss}` — **no `.astro`**, and no astro tooling (`astro`, `prettier-plugin-astro`) exists anywhere in the tree |
| "no tests" convention | `apps/web/package.json:20`, `packages/core/package.json:72` | The literal `"true"` stub. Every `test:unit` is `NODE_OPTIONS=--experimental-vm-modules jest` over a local ESM `ts-jest` config |
| Ports | web `3000` (`apps/web/vite.config.ts:111`), api `3001` (`apps/api/package.json:8`) | Astro's default is `4321`; the ticket asks for `3002`, which collides with nothing |
| CI gates | `.github/workflows/unit-test.yml:21-25` | Runs `format:check` + `test:unit`, turbo-wide (a new package participates automatically). **No CI job runs `lint` or `type-check`** — local-only gates today |

### `@portalai/core` — what it can and cannot hand to Astro

| Piece | Location | Portable to a static build? |
|---|---|---|
| Brand themes | `brand-theme.json` (854 lines), `brand-theme-dark.json` (877 lines) in `packages/core/src/assets/themes/` | **Partly.** Six top-level keys; `palette`/`typography`/`spacing`/`shape`/`breakpoints` occupy lines `2-187` (~22%) and are portable token data. `components` (`:188-853` light, `:188-876` dark — ~78%) is emotion `styleOverrides` across 39 `Mui*` slots. Not portable |
| Fonts | `packages/core/src/assets/scss/fonts.scss:2-80`, TTFs in `packages/core/src/assets/fonts/` | **Yes, with a caveat.** 10 `@font-face` blocks, all `format("truetype")` — **no WOFF2 anywhere**. Compiled by plain `sass` (`packages/core/package.json:78`) into `dist/styles`, fonts copied by `build:assets` (`:79`), exported as `./styles`, `./styles/fonts`, `./styles/global` (`:53-55`) — plain CSS, zero MUI |
| Font families | `brand-theme.json:64`, `:71-169` | **Exo 2** (body), **Fraunces** (h1–h6), **Space Grotesk** (subtitles + button), **Space Mono** (`code`/`monospace`). Note the themes name `'Exo 2 Variable'` first, which `fonts.scss` never declares — it always falls through to `'Exo 2'` |
| Export surface | `packages/core/package.json:3-52` | ESM-only, `dist` from plain `tsc` (`:77`, `tsconfig.build.json`), not a bundler. Subpaths `.`, `/models`, `/contracts`, `/ui`, `/utils`, `/registries`, `/constants` |
| `ui` barrel | `packages/core/src/ui/Icon.tsx:37,51` | **Trap.** Imports `.svg` directly, typed by an ambient `declare module` (`packages/core/src/types/svg.d.ts:1`). `tsc` emits the specifier verbatim into `dist/ui/Icon.js`, so `/ui` loads only under an SVGR transform matching `packages/core/vite.config.ts:8-16` (`exportType: "default"`, `ref: true`, `svgo: false`, `titleProp: true`) — config that does **not** travel to consumers |
| ThemeProvider | `packages/core/src/ui/ThemeProvider.tsx:20-26,49` | Builds both themes at module scope via `createTheme` + `responsiveFontSizes`; theme name is plain `useState`. **No `prefers-color-scheme`, no `matchMedia`, no localStorage in core** |
| Persistence | `apps/web/src/utils/theme.util.ts:6,39-41`, `storage.util.ts:39-79` | Lives in `apps/web`. Key `"portalai-theme"`, read in a `useState` lazy initializer, and the stored value is **JSON-encoded** (`JSON.parse`/`JSON.stringify`) — the raw entry is `"brand.dark"` *with quotes* |

**Documentation drift found.** Both the issue and `CLAUDE.md` → Theming state the fonts are *Noto Sans / Playfair Display / Cutive Mono*. The shipped fonts are Exo 2 / Fraunces / Space Grotesk / Space Mono — verified in `fonts.scss`, the theme JSON `fontFamily` values, and the TTF filenames. `CLAUDE.md` and its `.github/copilot-instructions.md` mirror are wrong and must be corrected in this PR under the standing doc-sync rule.

### Tier catalog — no "public" concept, and no ordering

`apps/api/src/db/schema/tiers.table.ts:25` carries `slug:29`, `displayName:30`, the billing-period fields (`:31-33`), the `free|metered|expensive` charge grid (`:35-40`), `perToolCaps:41`, `stripePriceId:47` (nullable, unique `:85`), `selectable:50`, `builtinToolpacks:53` / `customToolpacks:58`, `cta:63` (CHECK `subscribe|contact|none`, `:93`), `description:66`, and `visibleToOrganizationId:70` (nullable FK; null = all orgs, set = private to one). A second CHECK, `tiers_cta_price_check:96`, already enforces that a `subscribe` row has a price. Zod mirror: `packages/core/src/models/tier.model.ts:101-138`.

**No column answers "show this to an anonymous visitor," and there is no ordering column** — the repository sorts by `created` from `baseColumns`. `selectable` and `visibleToOrganizationId` both answer "is this offered to an authenticated org." Today's `enterprise` row (`tier-catalog.ts:139`) happens to be `cta: "contact"` with no lookup key, which coincidentally matches the desired bespoke-card behavior — by data coincidence, not enforcement.

Provisioning: `packages/devops-cli/src/commands/tier.ts:301` (`tierApply`) reads `TIER_CATALOG` (`packages/core/src/registries/tier-catalog.ts:67`; entries carry `stripeLookupKey:49` and deliberately **no amount** — header comment `:6-22`), resolves keys through `stripePriceResolver` (`packages/devops-cli/src/stripe.ts:70`, one read-only `prices.list({lookup_keys, active:true})` at `:80`), **fails closed on any unresolved key** (`tier.ts:320-321`, `TierApplyMissingPricesError`), diffs via `computeTierChanges:127`, and upserts only `CONVERGED_POLICY_FIELDS` (`tier.ts:61-80` — `description` and `visibleToOrganizationId` are explicitly excluded, `:76-78`).

Repository (`apps/api/src/db/repositories/tiers.repository.ts`): `findBySlug:24`, `findSelectable:37`, `findSelectableForOrg:49`, `priceIndex:71`. `findSelectable` is the only org-free finder but is **not anonymous-safe** — nothing filters `visibleToOrganizationId`, so it returns per-client private tiers.

### Stripe — the amount-resolution machinery already exists

`apps/api/src/services/stripe.service.ts` pins the API version at `:21` (`2026-06-24.dahlia`, mirrored in `packages/devops-cli/src/stripe.ts:17`). **`getPrice(priceId)` (`:190-227`) already does what the endpoint needs**: `Map`-backed cache (`:40`) with `PRICE_CACHE_TTL_MS = 60_000` (`:25`), returning `PriceDisplay { unitAmount, currency, interval }` (`:27-31`). It never throws — a non-recurring or amount-less price returns `null` (`:200-209`) and so does a Stripe API failure (`:220-226`, failures not cached).

Its one consumer is `BillingService.listBillingTiers` (`apps/api/src/services/billing.service.ts:266-283`): `findSelectableForOrg` → `TierService.tierPolicyFromRow` → `getPrice` only when `stripePriceId` is set. Wire shape `BillingTierSchema` (`packages/core/src/contracts/billing.contract.ts:18-36`), response `:40`, route `billing.router.ts:84`. Resolution is **by `stripePriceId`**, pre-resolved once by `tier apply`; there is no request-time lookup-key path in `apps/api`.

### Public routes, rate limiting, caching

JWT is mounted **per-router**: `apps/api/src/routes/protected.router.ts:30` does `protectedRouter.use(jwtCheck)`, mounted as `app.use("/api", protectedRouter)` at `apps/api/src/app.ts:60`. Everything unauthenticated sits at a sibling top-level path *before* that line — `/api/webhooks:37`, `/api/docs:46`, `/api/health:47`, the OAuth-callback routers `:51-52`, `/api/sse:55`, `/api/webhook:59`. Each substitutes its own boundary (HMAC, signed `state`, scoped token); `health.router.ts` escapes purely by mount position. A `/api/public` router must be registered after `express.json()` (`:39`) and strictly before `:60`.

- **Rate limiting:** no `express-rate-limit` anywhere. `apps/api/src/utils/rate-limit.util.ts:21` has `incrementRateWindow(key, now)` — a Redis fixed-window counter (`WINDOW_TTL_SECONDS = 120`, `:12`) used inline by the cost gate. Reusable in shape, but a plain function, not middleware.
- **Redis:** `apps/api/src/utils/redis.util.ts:10` — lazy `ioredis` singleton.
- **Caching:** no generic response-cache helper. `Cache-Control` is set in exactly three places, all `no-cache` for SSE (`utils/sse.util.ts:11`, `portal-sql-handle.router.ts:262`, `portal-events.router.ts:221`). **No precedent for a positive, edge-cacheable value.**
- **Swagger:** `z.toJSONSchema(Schema, JSON_SCHEMA_OPTS)` (`swagger.config.ts:75`) is the convention; the pattern to copy is the `billingSchemas` block (`:227-248`), spread into `components.schemas` at `:1648` alongside siblings `:1643-1650`.

### Business config — and the gap that threatens an acceptance criterion

`packages/devops-cli/src/catalog.ts:18-26` defines `CatalogEntry { key, kind: "secret"|"ssm", name, ssmType? }`; `CATALOG:40-62` lists 10 secrets and 9 SSM params, with `pathFor:76` resolving per-env paths. Commands live in `src/commands/vars.ts` (`describeVars:81`, `listVars:124`, `getVar:146`, `setVar:169`, `applyVars:236`, all writing via `writeEntry:54`). **No contact/support/sales key exists today** — net-new `ssm`-kind entries.

The gap: `apps/api/src/environment.ts:1-176` is a frozen literal read **exclusively from `process.env`** at module load. The only `@aws-sdk` usage in `apps/api/src` is S3 (`services/s3.service.ts:9-10`). The bridge is the ECS task definition — `infra/cloudformation/backend.yml:480-516` wires each secret/parameter into a container env var via `ValueFrom`, resolved by the **execution** role (`ssm:GetParameters` at `:240-243`, `secretsmanager:GetSecretValue` at `:226-239`) **at task start**. The **task** role (`:263-300`) has S3 + `ssmmessages:*` only — **no `ssm:GetParameter*`**. So `portalops vars set` changes the stored value, but a running API task serves the old one until it recycles, and the app cannot read SSM itself today. **This directly threatens the acceptance criterion "changing a support email through `portalops` and letting the rebuild fire updates the site with no code change and no manual deploy."** See Decision 3.

### Infrastructure — `frontend.yml` is an SPA template, and its exports collide

`infra/cloudformation/frontend.yml` params (`:4-21`): `Environment`, `Subdomain`, `DomainName`, `CertificateArn`, `HostedZoneId`. Resources: access-log bucket (`:28-47`, self-logging), private site bucket (`:52-73`, full public-access block, AES256, versioned, named exactly `${Subdomain}.${DomainName}`), OAC bucket policy (`:76-101`, plus a `DenyNonSSLRequests` statement) + `OriginAccessControl` (`:106-113`), a response-headers policy (`:125-144`, COOP for OAuth popups), the distribution (`:147-189`, AWS-managed CachingOptimized policy), Route 53 alias (`:192-202`), Outputs (`:204-219`).

Two problems, both load-bearing:

1. **The distribution is SPA-shaped.** `CustomErrorResponses` (`:160-166`) rewrites **both 403 and 404 → `/index.html` with `ResponseCode: 200`**. The origin is a REST/regional S3 origin behind OAC (`:167-172`), so S3 has no per-directory `IndexDocument` behavior: `/features/` requests a key that does not exist and gets 403. For a multi-page site this returns HTTP 200 + the homepage for every typo'd URL — a soft-404 SEO failure that breaks the branded-404 criterion outright. **No CloudFront Function or Lambda@Edge exists anywhere in the repo.**
2. **The exports and physical names key only on `Environment`.** `${Environment}-FrontendBucketName` (`:205-209`) and `${Environment}-CloudFrontDistributionId` (`:211-215`), plus `portalai-${Environment}-frontend-oac` (`:110`) and `-frontend-headers` (`:129`). A second frontend-shaped stack in `dev` clashes on all four. The site stack needs its own discriminated names — reusing the template as-is is not an option even before the routing problem.

Cert: `infra/cloudformation/dns-certs.yml:20-35` is one ACM cert for `portalsai.io` + SAN `*.portalsai.io`, exported `${Environment}-CertificateArn` (`:41-45`). **Both `site-dev.portalsai.io` and `site.portalsai.io` are already covered — no cert change.** All stacks deploy to `us-east-1` (`deploy-dev.yml:12-13`), satisfying CloudFront's requirement incidentally. Other stacks: `network.yml`, `database.yml`, `cache.yml`, `bastion.yml`, `backend.yml`. Convention is strictly `!ImportValue` + `${Environment}-<Name>`; every template declares `Environment` with `AllowedValues: [dev, prod]`; **no deploy script or Makefile** — stacks deploy via inline `aws cloudformation deploy` steps (`deploy-dev.yml:40-118`). Only `dev` has ever been instantiated.

### CI/CD — three workflows, and the prod path is genuinely new

`.github/workflows/deploy-dev.yml`: triggers `push: [main]` + `workflow_dispatch` (`:3-6`), `concurrency: deploy-dev, cancel-in-progress: false` (`:8-10`), `AWS_REGION: us-east-1` (`:12-13`). Jobs: `unit-test`/`integration-test` (`workflow_call`, `:17-21`) → `deploy-infra` (`:24-118`) → `deploy-frontend` (`:121-171`) + `deploy-backend` (`:174-306`) → `tag-deploy` (`:309-322`, pushes `dev-<ts>-<sha7>`).

`deploy-frontend`: checkout → `./.github/actions/setup` (`:131-132`) → `configure-aws-credentials@v4` with `secrets.AWS_ROLE_ARN` (`:134-138`, OIDC) → `npx turbo run build --filter=@portalai/web` (`:148`) with `VITE_*` injected as step env (`:141-147`, `VITE_API_BASE_URL` hardcoded to `https://api-dev.portalsai.io`) → stack outputs read live via `describe-stacks` ExportName filters (`:150-162`) → `aws s3 sync apps/web/dist/ s3://$BUCKET --delete` (`:165`, **no `--cache-control` flags at all**) → blanket `create-invalidation --paths "/*"` (`:167-171`).

`workflow_call` is already established (`unit-test.yml:7`, `integration-test.yml:7`). **Nothing uses `release`, tag-push, `repository_dispatch`, or `schedule`** — all four net-new. Two traps: `tag-deploy` already pushes `dev-*` tags, so a prod tag trigger must be pattern-filtered (`v*`); and tags pushed by `GITHUB_TOKEN` do not re-trigger workflows. `.github/actions/setup/action.yml` is 21 lines — `setup-node@v4` (Node 22, `cache: "npm"`) then `npm ci`; it does **not** check out. No Turbo remote cache (no `TURBO_TOKEN`/`TURBO_TEAM`, no `remoteCache` block).

Secrets inventory (all 19 in `deploy-dev.yml`): `AWS_ROLE_ARN` (`:37,137,187`), `DEV_HOSTED_ZONE_ID`, ten `DEV_SECRET_ARN_*` (`:107-116`), three `DEV_VITE_AUTH0_*` (`:144-146`). **Zero `vars.*` references** and **no GitHub Environments configured**. Convention is a `DEV_` prefix — **except `AWS_ROLE_ARN`, unprefixed** despite naming an environment-specific role. A prod pipeline forces that inconsistency to be resolved.

## The design space

### Decision 1 — How far does `@portalai/core` reuse reach into Astro?

The issue's open question #3. Astro is zero-JS-by-default; core's useful surface is MUI/emotion/React.

- **A — Full island reuse.** Import `@portalai/core/ui` components as React islands. Requires mirroring `vite.config.ts:8-16`'s svgr options into `astro.config.mjs` (the `Icon.tsx` trap), plus MUI + emotion + React 19 in the dependency tree and `client:*` directives.
- **B — Token bridge, zero React.** Consume only the portable parts: `@portalai/core/styles/fonts` (prebuilt CSS) and **CSS custom properties generated from `brand-theme.json` / `brand-theme-dark.json` lines `2-187`** at build time. Author all marketing presentation in plain Astro + CSS.
- **C — B by default, islands by exception.** The token bridge is the foundation; a React island is permitted only where a genuinely interactive core component earns its bytes, justified per use.

| | A (full islands) | B (tokens only) | C (B + exceptions) |
|---|---|---|---|
| Per-page JS | React + MUI + emotion (~150kB+ gz) | **0 kB** | 0 kB baseline |
| Lighthouse 100 SEO / ≥95 a11y | At risk | Comfortable | Comfortable |
| Brand fidelity | Exact (same components) | Exact on color/type/spacing | Exact |
| Drift risk when core changes | Lowest | Tokens tracked; `components` block not shared | Low |
| Build complexity | svgr config + SSR-safe emotion | One token-generation step | One token step |
| Matches the ticket | "consumes core as far as it usefully reaches" | Yes — usefully reaching == tokens + fonts | Yes |

**Lean: C.** The ticket already concedes that "marketing-only presentation (hero, pricing table, section layouts) is new work," so almost nothing in `core/ui` is actually wanted on a marketing page, and A would pull React + MUI to render static text. B captures 100% of what "reads as the same product" means at zero JS cost, and the ~78% of each theme file that is `styleOverrides` was never portable anyway. C keeps the door open without making islands the default. **The theme toggle is explicitly not an island** — see Decision 2.

### Decision 2 — Theme resolution with no flash, on a static page

Core's `ThemeProvider` has no `prefers-color-scheme` and no persistence; that logic is `apps/web`-side, behind React hooks, and stores a **JSON-encoded** value under `"portalai-theme"`.

- **A — Inline blocking script + `data-theme` attribute.** A synchronous `<script>` in `<head>` reads `localStorage["portalai-theme"]` (parsing the JSON quoting `storage.util.ts:39-62` writes), falls back to `matchMedia("(prefers-color-scheme: dark)")`, and stamps `data-theme` on `<html>` before first paint. Both token sets emit as CSS under `:root[data-theme="light"]` / `[data-theme="dark"]`. The visible toggle is ~15 lines of vanilla JS writing the same key in the same encoding.
- **B — CSS-only via `@media (prefers-color-scheme)`.** No script, no flash — but no user override, which the ticket requires.
- **C — React island wrapping core's `ThemeProvider`.** Reuses app code, but pulls MUI in and flashes.

**Lean: A.** The only option satisfying all three requirements at once (system default, persisted override, no flash), at a sub-1kB inline script. It shares the exact `"portalai-theme"` key and encoding with `apps/web` — but state note, stated plainly rather than over-promised: `localStorage` does **not** cross `site-dev.` → `app-dev.` subdomains, so this is continuity of *behavior* and of the storage contract, not literal state transfer.

### Decision 3 — How does an operator's contact-email change reach the served HTML?

The survey's sharpest finding: `apps/api` reads only `process.env`, populated by ECS at task start, and the **task role cannot read SSM at all** (`backend.yml:263-300`).

- **A — Runtime SSM read in the API, TTL-cached.** Add `@aws-sdk/client-ssm` to `apps/api`, read the narrow set of business-config keys via `GetParameters`, cache with a TTL mirroring `priceCache`'s shape. Env var stays the local-dev fallback. Requires adding `ssm:GetParameters` on the env's prefix to the **task** role.
- **B — Env-var only; the rebuild also forces an ECS redeploy.** The dispatch path runs `ecs update-service --force-new-deployment` before the site build.
- **C — CI reads SSM directly.** The site build fetches contact values from SSM itself, bypassing the API for those fields.
- **D — Move contact config into the DB.** A settings table the API already reads.

| | A (runtime SSM) | B (force redeploy) | C (CI reads SSM) | D (DB table) |
|---|---|---|---|---|
| Criterion "no manual deploy" | Met | Met, but rolls the API to change an email | Met | Met |
| "One definition, two consumers" | Yes | Yes | **No** — site and API read different paths | Yes |
| New dependency | SSM SDK + task-role IAM | ECS perms in the site workflow | SSM perms in CI | Migration + new table |
| Blast radius of an email typo | Endpoint response | **A full API rolling deploy** | Site only | Endpoint response |
| Contradicts the ticket | No | No | Yes (duplication is what the endpoint prevents) | Yes ("no new table and no migration") |

**Lean: A — confirmed.** The only option that keeps the endpoint the single definition without rolling production to change a support address. The read is narrow, cached, and fails soft to the env var, and it establishes a runtime business-config reader the app will want again. B makes an email typo a deploy event; C reintroduces the duplication the endpoint exists to eliminate; D is excluded by the ticket. The admitted scope: `apps/api` gains its first runtime AWS-SDK config dependency, and `backend.yml`'s `TaskRole` gains `ssm:GetParameters` on `parameter/portalai/${Environment}/*` — the execution role already has exactly that grant (`:240-243`), so the policy shape is copy-shaped, not novel. Local dev is unaffected.

### Decision 4 — Where do price amounts come from, and what happens when Stripe is down?

The issue's open question #1. The ticket says "amounts resolved from Stripe by lookup key," but `tier apply` already resolves lookup key → `stripePriceId` once and persists the **id** (`tiers.table.ts:47`), and `getPrice(priceId)` already resolves + caches the amount.

- **A — Reuse `stripePriceId` + `getPrice`.** Extend the `listBillingTiers` shape (`billing.service.ts:266-283`) for the public, org-free case.
- **B — New request-time lookup-key resolution.** A new `StripeService` method doing `prices.list({ lookup_keys })` with its own cache, mirroring the devops-cli resolver.

**Lean: A.** A price *id* is an identifier, not an amount — persisting it does not violate "never store an amount," and the ticket's intent is fully satisfied. B adds a second resolution path and a `prices.list` call per cache miss to solve a problem `tier apply` already solved (and already fails closed on, `tier.ts:320-321`).

**The failure mode is the real decision here, and it is not in the ticket.** `getPrice` returns `null` both when a price legitimately does not exist and when Stripe is unreachable (`:200-209` vs `:220-226`). Since "no amount" is a *legitimate* served state (the bespoke contact tier), a Stripe outage would silently render "Pro — let's talk" instead of "Pro — $X/mo": a wrong pricing page published by an outage. **Lean: distinguish the two.** A tier with `stripePriceId === null` is legitimately amountless → contact card. A tier that *has* a `stripePriceId` whose price will not resolve is an **error** → the endpoint fails (503) rather than serving a misleading card, which makes the site build fail loudly per the ticket's own rule. The DB already agrees: `tiers_cta_price_check:96` forbids a `subscribe` row without a price.

### Decision 5 — CloudFront routing for a multi-page static site

`frontend.yml`'s 403/404 → `/index.html` + 200 rewrite is SPA-only, and its exports collide with a second stack in the same environment.

- **A — New `site.yml` + a CloudFront Function.** A viewer-request function normalizes URLs (append `index.html` to directory-style paths), plus one `CustomErrorResponse` mapping 403/404 → `/404.html` with **`ResponseCode: 404`** (a real status). Its own discriminated export names and physical resource names.
- **B — Switch the origin to the S3 website endpoint.** Gets `IndexDocument` for free, but the bucket must be public — abandoning OAC and the private-bucket posture every other stack holds.
- **C — Astro `build.format: "file"`.** Emits `features.html` instead of `features/index.html` — still 403s on `/features`, so a function is *still* needed. Solves nothing on its own.

**Lean: A**, with Astro's default `build.format: "directory"` and `trailingSlash: "always"` as the canonical convention, so the canonical URL, the sitemap entry, and the S3 key all agree. This introduces the repo's first CloudFront Function — a real but small new primitive, unavoidable given B's security regression. The new template is a **sibling** of `frontend.yml`, not a parameterization of it: the SPA rewrite and the COOP header are app-specific, the export names would have to be discriminated anyway, and forking is cheaper than making one template serve two routing models.

### Decision 6 — Prod deploy trigger shape, and who fires a rebuild

Two coupled questions: the issue's open questions #4 and #2.

**Prod trigger.** `workflow_call` is established; there is no prod pipeline of any kind yet.

- **A — Reusable `deploy-static-site.yml` (`workflow_call`) + two thin callers.** `deploy-site-dev.yml` (`push: [main]`) and `deploy-site-prod.yml` (`release: published`) both call it with environment inputs. `apps/web` adopts it later by adding a caller.
- **B — One workflow, both triggers,** resolving the environment in a step.
- **C — Site-only now, generalize when the next consumer arrives.**

**Lean: A.** The ticket explicitly asks not to paint the prod path into a site-only corner, the pattern already exists here, and B's in-job environment branching is exactly the shape that becomes unfactorable once a second consumer needs it. A also forces the `AWS_ROLE_ARN` naming inconsistency to be resolved cleanly — introduce `PROD_AWS_ROLE_ARN` and pass the role ARN as a caller **input** rather than reading a fixed secret name inside the reusable workflow. Trigger on `release: published` rather than raw tag-push, since `tag-deploy` (`deploy-dev.yml:309-322`) already pushes `dev-*` tags with `GITHUB_TOKEN` (which would not re-trigger anyway).

**Rebuild dispatch.** The API has **no config-write path** — contact config is CLI-only (`vars.ts`), so "the API fires on config write" does not exist as an option. That leaves a `portalops` post-write hook, a Stripe webhook on `price.updated`, and a scheduled safety net. **Lean: all three, funneling into one `repository_dispatch` event type** consumed by the same reusable workflow. The scheduled net is inherently safe against publishing a broken build — the config fetch fails the build, and a failed build never reaches `s3 sync`.

**One hazard the ticket does not mention:** a `repository_dispatch` rebuild of **prod** must build from the last released tag, not from `main`, or a config change would silently publish whatever unreleased code sits on `main`. The reusable workflow takes an explicit ref; the prod caller resolves it to the latest release tag.

## Tradeoff comparison

|  | D1: C (tokens + exceptions) | D2: A (inline script) | D3: A (runtime SSM) | D4: A (priceId + fail on unresolvable) | D5: A (new stack + CF Function) | D6: A (reusable workflow) |
|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes | Yes |
| New dependency | none (drops MUI) | none | `@aws-sdk/client-ssm` + task-role IAM | none | first CloudFront Function | first `release`/`repository_dispatch`/`schedule` |
| Touches existing code | core (token export) | none | `environment.ts`, `backend.yml` | `stripe.service.ts`, `billing.service.ts` | none (sibling template) | `AWS_ROLE_ARN` naming |
| Reversible later | Yes — islands are additive | Yes | Yes — env fallback stays | Yes | Template fork is cheap | Yes |

## Recommendation

1. **`apps/site` is an Astro package with zero runtime JS by default.** It duplicates the existing per-package `eslint.config.js` pattern and extends the shared root `tsconfig.json`, declares `build`/`dev`/`lint`/`lint:fix`/`format`/`format:check`/`type-check`/`test:unit` verbatim, stubs `test:integration` as `"true"` like `apps/web:20` does, serves dev on `:3002`, and outputs to `dist/` (already matching `turbo.json:5-12`). **`.astro` joins the formatting regime** (**confirmed**): `prettier-plugin-astro` lands as a devDependency, the lint-staged glob (`package.json:44-46`) extends to `.astro`, and the site's own `format`/`format:check` scripts cover it — Astro files are the site's primary source, and CI's turbo-wide `format:check` gates them from day one.
2. **Brand comes from a token bridge, not from MUI.** Import `@portalai/core/styles/fonts` and generate CSS custom properties from lines `2-187` of both theme JSONs at build time. React islands are permitted only where a specific interactive core component earns its bytes; none is expected. If any island lands, `astro.config.mjs` must mirror `packages/core/vite.config.ts:8-16`'s svgr options or the `core/ui` barrel breaks on `Icon.tsx`.
    **Fonts ship as WOFF2, converted in `core`'s asset build** (**confirmed** — the site must be fast, not merely Lighthouse-compliant). `fonts.scss:2-80` currently declares 10 `@font-face` blocks, all `format("truetype")`, several full variable TTFs — the largest byte cost on a cold-cache landing page. `core`'s `build:scss`/`build:assets` step (`packages/core/package.json:78-79`) gains a TTF→WOFF2 conversion and `fonts.scss` gains `format("woff2")` sources ahead of the TTF fallbacks, so there stays one font source of truth and `apps/web` gets the same byte win for free.
3. **Theme is a `data-theme` attribute set by a synchronous inline `<head>` script**, keyed on the same `"portalai-theme"` localStorage key *and the same JSON encoding* `apps/web` uses, with `prefers-color-scheme` as the first-visit fallback. Both token sets ship as CSS; the visible toggle is vanilla JS.
4. **One endpoint: `GET /api/public/site-config`**, returning `{ tiers, contact }` as a single atomic snapshot. Mounted as its own router in the `app.ts:46-59` band, after `express.json()` and before `app.use("/api", protectedRouter)` (`:60`), carrying no `security` block in its `@openapi`, with its response schema defined in `packages/core/src/contracts/` and registered as a `publicSiteSchemas` const near `swagger.config.ts:227` and spread at `:1648`. One endpoint, not two, so the build makes one fetch, gets one fail-loud check, and cannot bake pages that disagree.
5. **The tier catalog gains an explicit `public` boolean and a `displayOrder` integer.** Added to `TierCatalogEntrySchema` (`tier-catalog.ts:23-50`) + `TIER_CATALOG`, to `CONVERGED_POLICY_FIELDS` (`tier.ts:61-80`) so `tier apply` converges them, and to the Drizzle table + Zod mirror + `type-checks.ts` per the dual-schema rule. A new `tiersRepository` finder serves `public = true AND visibleToOrganizationId IS NULL` ordered by `displayOrder` — the org-scoping predicate is a hard requirement, not an optimization, since `findSelectable:37` demonstrably does not carry it.
6. **Amounts resolve from the persisted `stripePriceId` via the existing `StripeService.getPrice`.** A `null` `stripePriceId` is a legitimate amountless tier → contact card. A non-null `stripePriceId` whose price will not resolve is an **error** → the endpoint fails, so the site build fails rather than publishing a Stripe outage as a pricing change.
7. **The public endpoint reads contact addresses from SSM at runtime with a TTL cache**, falling back to `process.env` (all `environment.ts` knows today). New `ssm`-kind keys land in `packages/devops-cli/src/catalog.ts:40-62` and are documented in `COMMANDS.md`; `backend.yml`'s `TaskRole` (`:263-300`) gains the `ssm:GetParameters` grant the execution role already has at `:240-243`.
8. **Response headers set `Cache-Control: public, s-maxage=…` and the route is IP-rate-limited** by wrapping `incrementRateWindow` (`rate-limit.util.ts:21`) in middleware. Note honestly that **there is no CDN in front of the API today** — it is served via ALB from `backend.yml` — so `s-maxage` is correct-but-inert until an API distribution exists; the Redis-backed response cache and the rate limit are what protect the origin now.
9. **A new `infra/cloudformation/site.yml`**, a sibling of `frontend.yml` following the same OAC/private-bucket/access-log/Route 53 shape but with **discriminated export and physical resource names** (`frontend.yml`'s `${Environment}-FrontendBucketName`, `-CloudFrontDistributionId`, `portalai-${Environment}-frontend-oac`, and `-frontend-headers` all collide otherwise). It imports the existing `${Environment}-CertificateArn` and replaces the SPA 403/404→`index.html`+200 rewrite with a CloudFront Function for directory-index normalization plus a real `404.html` at status 404.
10. **CI is a reusable `deploy-static-site.yml` (`workflow_call`)** with thin `push: [main]` (dev) and `release: published` (prod) callers, taking the role ARN, environment, subdomain, and build ref as inputs. `s3 sync` gains the per-path `--cache-control` flags `deploy-dev.yml:165` lacks (long-immutable for hashed assets, short/`must-revalidate` for HTML). **The prod caller runs in a `prod` GitHub Environment** (**confirmed** — none exist today; every secret is a flat `DEV_`-prefixed repo secret) holding the `PROD_*` secrets, with required-reviewer protection so a mis-cut tag cannot reach production unreviewed — which is also the enforcement point for the legal-copy-before-prod criterion. **The prod API base URL is a workflow input that stays unset until the prod API exists** (**confirmed** — no prod stack has ever been instantiated, #83): the prod caller is wired and proven end-to-end against dev, but cutting a tag must not build against a nonexistent origin.
11. **Rebuilds fire from three sources into one `repository_dispatch` event type** — a `portalops` post-write hook, a Stripe `price.updated` webhook, and a nightly `schedule` safety net. The prod caller resolves the build ref to the latest release tag, never `main`.
12. **`robots.txt` is fully permissive, as an explicit allow-list** (**confirmed**): `GPTBot`, `ClaudeBot`, `PerplexityBot`, `Google-Extended`, `CCBot` and friends named explicitly rather than allowed by omission, with the sitemap referenced and `llms.txt` served alongside. The point of the AI-search deliverable is to be quotable; a marketing site has no content worth withholding, and the explicit list is the recorded decision the ticket requires.
13. **`glossary.util.ts` and `faq.util.ts` move into `@portalai/core`** (**confirmed**). The site cannot import from `apps/web`, and duplicating 35 term definitions would guarantee the drift the ticket's "one definition of each term" criterion forbids. `faq.util.ts` (27 entries, **no imports at all**) moves as-is and feeds the site's `FAQPage` JSON-LD. `glossary.util.ts` (35 entries) already types `pageRoute?: string` (`:29`) — the coupling is not the type but the 27 `ApplicationRoute` *values* assigned from `apps/web/src/utils/routes.util.ts`; those move to the `apps/web` call sites or a web-side augmentation so the core module imports nothing app-specific. `getting-started.util.ts` **stays in `apps/web`** — its `ctaRoute` is typed as the `ApplicationRoute` enum (`:9`), it is app-onboarding copy, and the site has no use for it. The existing pinning tests (`apps/web/src/__tests__/glossary.util.test.ts`, `faq.util.test.ts`) move with their modules.
14. **Doc-sync obligations in this PR:** the `@portalai/site` row in `CLAUDE.md` + `.github/copilot-instructions.md`, root `README.md`, `apps/site/README.md`, `COMMANDS.md` for the new config keys, `packages/core/README.md` for the relocated glossary/FAQ surface, and `CLAUDE.md`'s "Documentation surfaces (the inventory)" section — which currently lists `glossary.util.ts` and `faq.util.ts` at their `apps/web` paths — **plus the font correction** (Exo 2 / Fraunces / Space Grotesk / Space Mono, not Noto Sans / Playfair Display / Cutive Mono) in `CLAUDE.md` → Theming and its mirror.

## Open questions

None remaining. All six raised during discovery were resolved with the user and folded into the Recommendation as **confirmed** decisions: WOFF2 fonts in `core`'s build (Rec 2), `.astro` formatting (Rec 1), the `prod` GitHub Environment and the unset-until-#83 prod API URL (Rec 10), and the fully-permissive `robots.txt` allow-list (Rec 12). The one item resolved *out* of this ticket — adding `lint`/`type-check` to CI — is recorded under "What this doesn't decide."

## Enterprise-scale considerations

- **Concurrency & correctness.** The build is a pure read, so there are no write races. One real hazard: if each page fetched config independently, a `tier apply` landing mid-build could bake pages that disagree (Pricing showing a tier the Home comparison omits). **Lean:** the build fetches the snapshot **once** and threads it to every page — hence the single-endpoint choice in Recommendation 4. `tier apply` converges row-by-row, so a mid-apply snapshot is internally consistent per row and self-heals on the next dispatch-triggered rebuild.
- **Accuracy & auditability.** Stripe remains the record-of-truth for amounts; nothing is persisted, so there is no ledger to reconcile. The published HTML is an explicitly stale derivative. **Lean:** stamp the config-fetch timestamp and the build git SHA into a `<meta>` tag on every page, so "why does the live site say $X" is answerable in one `curl`. Contact-config changes are already audited by `portalops`' JSONL audit log; no new audit surface is needed.
- **Failure modes.** Deliberately **fail-closed at build time** (the ticket's rule, and the right call — publishing wrong prices is worse than publishing nothing, and the previously-published site stays up because a failed build never reaches `s3 sync`). The subtle case is Decision 4's: `getPrice`'s `null` must not conflate "no price" with "Stripe is down," or an outage silently republishes Pro as a contact-us tier. **Lean:** fail-closed there too. Runtime SSM reads (Decision 3) fail **soft** to `process.env` — a stale support email is strictly better than a 503 on the public endpoint.
- **Scale & unbounded growth.** Tier cardinality is single digits and page count is fixed, so there is no fan-out concern. The real exposure is that this is the **first unauthenticated, uncached, unthrottled endpoint on the API** — an anonymous surface anyone can hammer, sitting in front of Stripe and (per Decision 3) SSM. **Lean:** the TTL caches bound load regardless of request rate; the IP rate limit and a Redis response cache are what stand between an abusive client and the origin, since no CDN fronts the API today.
- **Multi-tenancy.** The strongest isolation story in the codebase — the endpoint is tenant-free by construction, takes no org context, and has no authenticated principal. The one way to break it is the tier finder: `visibleToOrganizationId` (`tiers.table.ts:70`) makes per-org private tiers real, and `findSelectable:37` already proves the mistake is easy to make. **Lean:** the public finder predicates on `public = true AND visibleToOrganizationId IS NULL`, and that is a named test — a private-tier row must be provably absent from the response.
- **Contract stability.** The response is a *presentation snapshot* keyed by tier slug, not a serialized `TierPolicy`. **Lean:** deliberately do **not** expose the charge grid, `perToolCaps`, `periodKind`/`periodAnchorDay`, or `overage` — billing internals whose shape #172/#214 will keep moving, and leaking them into a public contract would make internal billing changes breaking changes for a static site. Entitlement additions then land as additive fields.
- **Data lifecycle.** The site's staleness is bounded by **rebuild cadence, not cache TTL** — the 60s `getPrice` TTL is irrelevant once a value is baked into HTML. **Lean:** the nightly `schedule` safety net makes worst-case staleness ≤24h, and that number is the contract worth writing down in `apps/site/README.md`. Retention is a non-issue: no user data is collected (analytics and lead capture are both out of scope), so the site holds nothing with a lifecycle.

## What this doesn't decide

- **Blog / resources / changelog.** The largest organic-SEO lever, but a content surface with its own authoring workflow, collection schema, and pagination. Explicitly out of scope in the ticket; separate ticket.
- **Prod pipelines for `apps/web` and `apps/api`.** This establishes the reusable workflow and proves it on the site. Adopting it for web/api means resolving prod stacks, a prod database, prod Auth0, and prod Stripe — far beyond this ticket, and the reason Decision 6 leans reusable-now.
- **Legal copy.** Per the ticket, this PR ships page structure, routing, SEO tags, theming, and sitemap inclusion only; the business supplies reviewed Privacy/ToS text before the prod tag is cut. No agent-drafted or placeholder legal text ships.
- **Whether `core` should export a non-React token accessor as public API.** Recommendation 2 generates CSS variables at site build time by reading the theme JSON. Promoting that to a supported `@portalai/core` export (so `apps/web` could share it) is a nice consolidation and a scope increase; revisit if a second consumer appears.
- **Adding `lint` / `type-check` to CI.** `unit-test.yml:21-25` runs only `format:check` + `test:unit`, so the acceptance criterion "root `lint` and `type-check` pass" has no CI enforcement. Real gap, wrong PR — monorepo-wide gates could surface pre-existing failures in every package. **The user is filing this as its own ticket.**
- **Apex / `www.portalsai.io`,** analytics, cookie consent, conversion tracking, i18n, A/B testing, CMS, lead-capture forms, and a public docs site. All explicitly out of scope in the ticket. The "no unauthenticated write path" constraint is what keeps the new public surface read-only.

## Next step

`docs/MARKETING_SITE.spec.md` pins the contract: the `GET /api/public/site-config` response shape as a `packages/core/src/contracts/` Zod schema, the `public` + `displayOrder` tier columns and their `tier apply` convergence, the CSS-custom-property token contract and the `data-theme` protocol (including the JSON encoding of the shared localStorage key), the CloudFront Function's URL-normalization rules and trailing-slash convention, and the reusable workflow's input surface. Then `docs/MARKETING_SITE.plan.md` slices it.

The natural slicing runs **backend-first, so the site never blocks on a stub**: (1) tier `public` + `displayOrder` through model/table/type-checks/migration/`tier apply`; (2) the public endpoint with Stripe amount resolution, the fail-closed unresolvable-price rule, and the private-tier-exclusion test; (3) runtime SSM contact config + the new catalog keys + the task-role grant; (4) the `apps/site` skeleton wired into every root task, with the token bridge and the theme protocol; (5) the `core` slice — the glossary/FAQ move and the WOFF2 font pipeline in `build:scss`/`build:assets`; (6) pages, SEO/JSON-LD, and the build-time config fetch that fails loudly; (7) `site.yml` + the CloudFront Function; (8) the reusable workflow and its two callers; (9) the rebuild dispatch paths and doc sync. Slices 1–3 and 5 are independently testable against the existing suites; 4 and 6 are testable with a mocked config fetch; 7–8 are only fully provable on the dev stack, which is what the smoke doc is for.
