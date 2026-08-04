# Public marketing site (`apps/site`) — Plan

**TDD-sequenced implementation of #311: the `public`/`displayOrder` tier columns, the anonymous `GET /api/public/site-config` endpoint (SSM contact + fail-closed Stripe amounts), the rebuild-dispatch triad, the `@portalai/core/content` move + WOFF2 pipeline, the Astro site with its token bridge and theme protocol, and `site.yml` + the reusable static-site deploy workflow.**

Spec: `docs/MARKETING_SITE.spec.md`. Discovery: `docs/MARKETING_SITE.discovery.md`. Issue: #311. Builds on shipped #172/#214/#241 (tiers table + policy + cta/visibility) and #218 (`tier apply`) — all on `main`.

Nine slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/marketing-site`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd packages/devops-cli && npm run test:unit
cd apps/api && npm run test:unit && npm run test:integration
cd apps/web && npm run test:unit
cd apps/site && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — backend-first so the site never builds against a stub, with one deliberate swap from the spec's sketch (**business config lands before the endpoint** — `SiteConfigService` composes `BusinessConfigService`, so the spec's order would have been a forward dep):

- **Slice 1** — the tier data contract (columns, catalog, convergence, finder). Everything downstream reads it.
- **Slice 2** — `BusinessConfigService` + the `portalops` catalog keys. Standalone, env-fallback testable with no AWS.
- **Slice 3** — the public endpoint, composing 1 + 2. The site's only upstream is live after this slice.
- **Slice 4** — rebuild dispatch (API webhook path + `portalops` hook). Pure addition; needs nothing from 5–9.
- **Slice 5** — the `core` package slice: glossary/FAQ → `./content`, WOFF2 fonts. Site content + bytes prerequisites.
- **Slice 6** — `apps/site` skeleton: package, tooling gates, token bridge, theme protocol, config fetch (fixture fallback). Root `build`/`lint`/`type-check`/`test:unit` pass with the site included from here on.
- **Slice 7** — pages, SEO/JSON-LD, static SEO files, and the build self-check.
- **Slice 8** — infra + CI (`site.yml`, CloudFront Function, the three workflows). Only provable on the dev stack → smoke.
- **Slice 9** — doc sync (a bug in this PR if skipped, per `CLAUDE.md`).

One migration (slice 1). Per-env ordering after merge: `db:migrate` → `portalops tier apply --env <e>` (rows go public via apply, never by backfill).

---

## Slice 1 — tier `public` + `displayOrder` through the dual-schema chain

The data contract: columns, CHECK, migration, catalog fields + values, `tier apply` convergence, and the anonymous-safe finder.

**Files**

- Edit: `packages/core/src/models/tier.model.ts` — `TierSchema` + `public: z.boolean()`, `displayOrder: z.number().int()` (spec §1).
- Edit: `apps/api/src/db/schema/tiers.table.ts` — `public: boolean("is_public")`, `displayOrder: integer("display_order")`, `tiers_public_org_check` (spec §1).
- Edit: `apps/api/src/db/schema/zod.ts`, `apps/api/src/db/schema/type-checks.ts` — regenerate/extend the dual-schema guards.
- Edit: `packages/core/src/registries/tier-catalog.ts` — schema fields + all four entries `public: true`, `displayOrder` 1–4 (spec §2).
- Edit: `packages/devops-cli/src/commands/tier.ts` — `CONVERGED_POLICY_FIELDS` + `"public", "displayOrder"` (spec §2).
- Edit: `apps/api/src/db/repositories/tiers.repository.ts` — `findPublic()` (spec §3).
- New: migration via `npm run db:generate -- --name tier-public-display-order`.
- Extend tests: `packages/core/src/__tests__/registries/tier-catalog.test.ts`, `packages/devops-cli/src/__tests__/tier.test.ts`, the api tiers-repository suite.

**Steps**

1. **Tests (spec: core catalog 3 cases; devops-cli tier 3; api repo 3).** Catalog: every entry carries `public`/`displayOrder`, orders unique + ascending, schema rejects negative order. Devops: `CONVERGED_POLICY_FIELDS` includes both; diff flips a live `is_public=false` row; catalog↔`TierSchema` mirror still pins. Repo: `findPublic` excludes non-public, excludes org-scoped, orders by `displayOrder`. Run; fail.
2. **Implement** model → table → zod → type-checks (build enforces the pair) → catalog → converged fields → finder. Generate the migration; `npm run db:migrate` locally.
3. Green; lint + type-check.

**Done when:** all nine cases pass, the migration applies cleanly, and `seedTiers` needs no edit (new fields ride `...policy` — assert by running the existing seed test).

**Risk:** the reserved-word column. `is_public` sidesteps it; verify the generated SQL quotes nothing odd before committing the migration.

---

## Slice 2 — `BusinessConfigService` + `portalops` config keys

The runtime SSM reader with env fallback, and the operator-side catalog entries. No consumer yet.

**Files**

- New: `apps/api/src/services/business-config.service.ts` — `getContact()`, `clearCache()` (spec §5).
- Edit: `apps/api/src/environment.ts` — `SUPPORT_EMAIL`, `SALES_EMAIL`, `BUSINESS_CONFIG_SSM_PREFIX` (spec §5).
- Edit: `apps/api/package.json` — `@aws-sdk/client-ssm`.
- Edit: `packages/devops-cli/src/catalog.ts` — `siteConfig?: boolean` on `CatalogEntry`; `ssm("SUPPORT_EMAIL", …)`, `ssm("SALES_EMAIL", …)` (spec §8).
- Edit: `infra/cloudformation/backend.yml` — TaskRole `ssm:GetParameters` on `parameter/portalai/${Environment}/*` (copy the execution role's grant shape, `:240-243`).
- Edit: `packages/devops-cli/COMMANDS.md` — the two new keys.
- New/extend tests: `apps/api/src/__tests__/services/business-config.service.test.ts`; `packages/devops-cli/src/__tests__/catalog.test.ts`.

**Steps**

1. **Tests (spec: business-config 4; devops catalog 2).** SSM values win; SSM error → env fallback, no throw; unset prefix → SSM never constructed; TTL cache respected. Catalog: paths resolve; `siteConfig` marker present. Run; fail.
2. **Implement** the service (mock the SSM client in tests — no AWS in CI), env keys, catalog entries, the `backend.yml` grant, COMMANDS.md rows.
3. Green; lint + type-check.

**Done when:** the six cases pass; nothing imports `BusinessConfigService` yet; local dev provably needs no AWS (unset-prefix test).

**Risk:** none in code — the `backend.yml` grant is only provable at deploy (smoke).

---

## Slice 3 — `GET /api/public/site-config`

The endpoint: contract schema, snapshot service with the fail-closed price rule, rate limit, router, mount, codes, swagger.

**Files**

- New: `packages/core/src/contracts/site-config.contract.ts` (+ barrel export) — spec §4 verbatim.
- New: `apps/api/src/services/site-config.service.ts` — spec §6.
- New: `apps/api/src/middleware/public-rate-limit.middleware.ts` — spec §7.
- New: `apps/api/src/routes/public-site.router.ts` — spec §7, full `@openapi`, no `security`.
- Edit: `apps/api/src/app.ts` — mount `/api/public` in the `:46-59` band.
- Edit: `apps/api/src/constants/api-codes.constants.ts` — `SITE_CONFIG_PRICE_UNRESOLVED`, `SITE_CONFIG_RATE_LIMITED`.
- Edit: `apps/api/src/config/swagger.config.ts` — `publicSiteSchemas` + spread.
- New tests: `packages/core/src/__tests__/contracts/site-config.contract.test.ts`; `apps/api/src/__tests__/services/site-config.service.test.ts`; `apps/api/src/__tests__/middleware/public-rate-limit.test.ts`; `apps/api/src/__tests__/__integration__/routes/public-site.router.integration.test.ts`.

**Steps**

1. **Unit tests first (spec: contract 3; service 6; middleware 3).** The service's six: happy snapshot; `stripePriceId: null` → `price: null`; resolvable price mapped; **unresolvable non-null → 503 `SITE_CONFIG_PRICE_UNRESOLVED`**; cache hit; error never cached. Run; fail. Implement contract → service → middleware. Green.
2. **Integration tests (spec: router 5).** 200 with no `Authorization`; contract-valid + no org/user/usage keys; a seeded org-private tier absent; `Cache-Control` present; 429 on exhaustion. Implement router + mount + codes + swagger. Green.
3. Lint + type-check.

**Done when:** all 17 cases pass and `curl -s localhost:3001/api/public/site-config` (no header) returns the snapshot against the local dev stack.

**Risk:** the private-tier integration fixture needs `visibleToOrganizationId` set with `is_public=false` (the CHECK forbids the public+private combination — the *finder* test for that combination stays unit-level with mock rows, as the spec notes).

---

## Slice 4 — rebuild dispatch (API + `portalops`)

The three-trigger funnel's two active sources; the schedule arrives with the workflows (slice 8).

**Files**

- New: `apps/api/src/services/rebuild-dispatch.service.ts` — spec §8; never throws.
- Edit: `apps/api/src/services/billing.service.ts` — `price.created|updated|deleted` → recorded `ignored` + `fireSiteRebuild` (spec §8).
- Edit: `apps/api/src/environment.ts` — `GITHUB_DISPATCH_TOKEN`, `GITHUB_DISPATCH_REPO`.
- New: `packages/devops-cli/src/github-dispatch.ts` — operator-side `fireSiteRebuild` (spec §8).
- Edit: `packages/devops-cli/src/commands/vars.ts` (post-`setVar` hook on `siteConfig` keys), `packages/devops-cli/src/commands/tier.ts` (post-apply hook on ≥1 change).
- Edit: `packages/devops-cli/src/catalog.ts` — `secret("GITHUB_DISPATCH_TOKEN", …)`; `infra/cloudformation/backend.yml` — the secret's `ValueFrom` wiring.
- New/extend tests: `packages/devops-cli/src/__tests__/github-dispatch.test.ts`; extend `apps/api/src/__tests__/services/billing.service.test.ts`.

**Steps**

1. **Tests (spec: devops dispatch 3; billing 2).** Dispatch fires with token; unset token → no-op notice, exit 0; HTTP 4xx → warning not error. Webhook: `price.updated` → `ignored` + dispatch called; dispatch failure doesn't fail the webhook. Run; fail.
2. **Implement** both services + hooks + catalog/infra wiring.
3. Green; lint + type-check.

**Done when:** the five cases pass; a `vars set SUPPORT_EMAIL` dry-path logs the dispatch attempt; no webhook semantics changed (events still record `ignored`).

**Risk:** double-fire (a `tier apply` after a Stripe price change fires twice). Harmless — rebuilds are idempotent and `concurrency` groups serialize them (slice 8); note in the service JSDoc.

---

## Slice 5 — the `core` package slice: `./content` move + WOFF2 fonts

Site prerequisites that live in `core`: the canonical vocabulary and the fast fonts.

**Files**

- New: `packages/core/src/content/{glossary.util,faq.util,index}.ts` — moved per spec §9 (`faq` verbatim; `glossary` with `pageRoute` values stripped).
- Edit: `packages/core/package.json` — `./content` subpath; `build:fonts` script; `ttf2woff2` devDependency.
- Edit: `packages/core/src/assets/scss/fonts.scss` — woff2-first `src` lists (spec §10).
- New: `apps/web/src/utils/glossary-routes.util.ts` — `GLOSSARY_PAGE_ROUTES` + `withPageRoutes` (spec §9).
- Edit: `apps/web` repoints — `Help.view.tsx`, glossary/FAQ components.
- Moved tests: `glossary.util.test.ts`, `faq.util.test.ts` → `packages/core/src/__tests__/content/`; new `apps/web/src/__tests__/glossary-routes.util.test.ts`.
- Delete: `apps/web/src/utils/{glossary.util,faq.util}.ts` + old test files (clean cut, no aliases).

**Steps**

1. **Tests (spec: moved suites + 2 new core cases; web 2).** Move the pinning suites; add: core glossary data carries no `pageRoute` values; content module imports nothing from `apps/web`. Web: every mapped term exists in core's glossary; `withPageRoutes` drops nothing. Run; fail (module doesn't exist yet).
2. **Implement** the move + subpath + repoints. Full `apps/web` suite must stay green (Help view regression is the moved-import proof).
3. **WOFF2**: add `build:fonts` + `fonts.scss` sources; **verify** `npm run build` in `packages/core` emits `dist/fonts/*.woff2` and `dist/styles/fonts.css` references `format("woff2")` before `truetype` (build-output check — the spec pins no jest case here).
4. Green; lint + type-check (`core`, `web`).

**Done when:** core + web suites green; `apps/web` renders Help from `@portalai/core/content`; woff2 files exist in `dist` with the CSS preferring them.

**Risk:** the 80% coverage threshold in `packages/core/jest.config.js` — pure-data modules can drag branch coverage; the moved pinning tests should hold the line, but check the coverage report at the boundary.

---

## Slice 6 — `apps/site` skeleton: package, tooling, token bridge, theme, config fetch

The site exists, is gated by every root task, and can build offline (fixture) or against the live endpoint. One placeholder page; real pages are slice 7.

**Files**

- New: `apps/site/package.json`, `astro.config.mjs`, `tsconfig.json`, `eslint.config.js`, `jest.config.js` — spec §11 (scripts verbatim; dev `:3002`; `trailingSlash: "always"`; sitemap integration).
- New: `apps/site/scripts/generate-tokens.mjs` + gitignored `src/styles/tokens.css` output.
- New: `apps/site/src/lib/site-config.ts` + `src/lib/site-config.fixture.json` (schema-valid fixture; fixture mode when `SITE_CONFIG_URL` unset — spec §11 as amended).
- New: base layout with the inline theme script + toggle (spec §11 theme protocol), minimal `index.astro`.
- Edit: root `package.json` — lint-staged glob gains `.astro`; `.prettierrc.json` — `prettier-plugin-astro`.
- New tests: `apps/site/src/lib/__tests__/site-config.test.ts`; `apps/site/scripts/__tests__/generate-tokens.test.ts`.

**Steps**

1. **Tests (spec: site-config 3; tokens 3).** Config: valid payload parses; non-200 throws; shape-mismatch throws (fail-loud, URL set). Tokens: both `data-theme` blocks from the real theme JSONs; palette + font values present; deterministic. Run; fail.
2. **Implement** the package + scripts + fixture fallback + theme script.
3. **Root-gate proof:** from the repo root, `npm run build && npm run lint && npm run type-check && npm run format:check && npm run test:unit` all pass with `apps/site` participating (build in fixture mode). Commit a deliberately unformatted `.astro` file and confirm lint-staged formats it on commit.
4. Lint + type-check.

**Done when:** six cases pass, every root task includes the site, `npm run dev` serves `:3002` beside web/api, and toggling theme persists across reload with no flash (manual check now, smoke later).

**Risk:** the tsconfig deviation (extends `astro/tsconfigs/strict`, not the root) — confirm `turbo run type-check` still picks the package up via its own script; and Astro's `.astro/` type-gen dir must join `.gitignore`/`clean`.

---

## Slice 7 — pages, SEO/JSON-LD, static SEO files, build self-check

All public pages rendered from the single snapshot, plus the machine surfaces (sitemap/robots/llms) and a post-build verifier that makes SEO regressions build failures.

**Files**

- New: `apps/site/src/pages/` — `index`, `features/`, `use-cases/<personas>/`, `pricing/`, `contact/`, `privacy/`, `terms/`, `404` (spec §11 pages: unique title/description/canonical, OG/Twitter, one `<h1>`, JSON-LD per page, `portal:build` meta stamp).
- New: `public/robots.txt` (explicit allow-list + `Sitemap:`), `public/llms.txt`.
- New: `apps/site/scripts/verify-pages.mjs` — post-build self-check wired into the `build` script: every emitted page has a unique `<title>`, a self-referencing canonical, parseable JSON-LD; `sitemap-index.xml` covers every route; pricing HTML contains a price figure (or the contact card) per snapshot tier; the fixture stamp is absent when `SITE_CONFIG_URL` was set.
- Content: vocabulary copy imports `@portalai/core/content`; FAQ entries → `FAQPage` JSON-LD; pricing cards map `builtinToolpacks` slugs → display copy via `@portalai/core/registries`.

**Steps**

1. **Tests first, build-shaped:** extend `verify-pages.mjs` with the assertions above and wire `build` to run it — against the slice-6 skeleton it **fails** (missing pages/titles). This is the slice's failing suite.
2. **Implement** the pages until `npm run build` (fixture mode) goes green, then once against the live local endpoint (`SITE_CONFIG_URL=http://localhost:3001/api/public/site-config npm run build`) to prove the live path.
3. **Manual spot-check:** `curl` a built page from `dist/` — copy, JSON-LD, prices present with no JS.
4. Lint + type-check + `format:check`.

**Done when:** the self-check passes in both modes; privacy/terms render structure with an explicit `<!-- business copy pending: blocks prod tag -->` marker; killing the API mid-build (URL set) fails the build.

**Risk:** page copy quality is not testable — the self-check pins structure, not prose. Lighthouse/Rich-Results numbers are smoke-gated, not CI-gated; treat a local Lighthouse run as advisory here.

---

## Slice 8 — infra + CI: `site.yml`, CloudFront Function, three workflows

The deploy path. No jest surface — the gates are template/workflow validity, `format:check`, and the smoke walk (this is the slice the smoke doc exists for).

**Files**

- New: `infra/cloudformation/site.yml` — spec §12 (discriminated names/exports, `SiteIndexRewrite` function, 403/404 → `/404.html` @ 404).
- New: `.github/workflows/deploy-static-site.yml` (reusable; inputs/secrets per spec §13; two-pass `--cache-control` sync; fixture-stamp grep), `deploy-site-dev.yml` (push/dispatch/schedule/manual), `deploy-site-prod.yml` (`release: published`, `environment: prod`, resolve-ref → latest tag, early-exit while the prod API input is unset).
- Edit: `.github/workflows/deploy-dev.yml` — `deploy-infra` gains the site stack step.

**Steps**

1. **Validate-first:** `aws cloudformation validate-template` on `site.yml` where credentials allow (else lint the YAML), and a dry review of the CloudFront Function against the URL matrix (`/`, `/features/`, `/features`, `/x.css`, `/missing/`).
2. **Implement** template + workflows per spec §13 verbatim; wire the site stack into `deploy-dev.yml`.
3. **Prove on the dev stack** (post-merge/smoke): push → dev deploy → `curl https://site-dev.portalsai.io/features/` 200, `/nope/` → branded 404 with HTTP 404, `repository_dispatch` → rebuild.
4. `format:check` at the boundary.

**Done when:** templates validate, workflows parse (a `workflow_dispatch` dry run on the branch is the pre-merge check), and the smoke doc's infra section maps to these behaviors. Manual settings steps recorded, not automated: the `prod` GitHub Environment + required reviewers, `PROD_*` secrets, the fine-grained `GITHUB_DISPATCH_TOKEN` minted and set via `portalops vars set`.

**Risk:** highest-uncertainty slice — CloudFront Function behavior and OIDC role permissions for the new stack only surface on a real deploy. Contained: nothing here touches `frontend.yml`/`backend.yml` behavior beyond the additive grant + secret from slices 2/4.

---

## Slice 9 — doc sync

The standing rule: stale docs are a bug in this PR.

**Files**

- Edit: `CLAUDE.md` + `.github/copilot-instructions.md` — `@portalai/site` row; **font correction** (Exo 2 / Fraunces / Space Grotesk / Space Mono); doc-surfaces inventory rows for `glossary`/`faq` moved to `@portalai/core/content`; site URL table row (`:3002`).
- Edit: root `README.md` (new app + dev script + URLs), `packages/core/README.md` (content subpath, WOFF2 build).
- New: `apps/site/README.md` — local dev, authoring, SEO conventions, config-fetch/rebuild loop (staleness contract: nightly net ⇒ ≤24h), deploy pipeline.
- Verify: `packages/devops-cli/COMMANDS.md` rows from slices 2/4 are complete.

**Steps**

1. **Failing check first:** grep the doc surfaces for the stale claims (Noto Sans, `apps/web/src/utils/glossary.util.ts` paths, missing site row) — enumerate hits.
2. **Implement** the edits; re-grep to zero.
3. `format:check` (docs are unformatted by convention — the gate is the grep, plus the existing pinning tests from slice 5 staying green).

**Done when:** the grep finds no stale surface; CLAUDE.md's tables mention `apps/site` everywhere web/api appear.

**Risk:** none.

---

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | Tier `public`/`displayOrder`: model→table→zod→checks→migration→catalog→apply→`findPublic` | 9 cases across core/devops/api; migration applies |
| 2 | `BusinessConfigService` + env keys + `vars` catalog + TaskRole grant | 6 cases; no-AWS local path proven |
| 3 | Contract + `SiteConfigService` + rate limit + router + codes + swagger | 17 cases incl. private-tier-absent integration |
| 4 | `RebuildDispatchService` + webhook `price.*` + `portalops` hooks + token plumbing | 5 cases; webhook semantics unchanged |
| 5 | `@portalai/core/content` move + web repoint + WOFF2 | Moved suites + 4 cases; woff2 in `dist` |
| 6 | `apps/site` skeleton + tooling gates + tokens + theme + config fetch/fixture | 6 cases; all root tasks pass with the site |
| 7 | Pages + SEO + robots/llms/sitemap + build self-check | `verify-pages.mjs` green in fixture + live modes |
| 8 | `site.yml` + CF Function + reusable workflow + dev/prod callers | Template validation; dev-stack proof → smoke |
| 9 | Doc sync (CLAUDE.md+mirror, READMEs, COMMANDS.md, font fix) | Stale-claim grep → zero |

## Cross-slice notes

- **Spec amendment (this planning pass):** unset `SITE_CONFIG_URL` ⇒ fixture-mode build (schema-valid committed fixture, stamped in the meta tag, grep-blocked from publish) — required so root `npm run build` passes offline. The spec's build-time-config paragraph was updated; re-review it with this plan.
- **Migration/apply ordering per env:** `db:migrate` (rows default non-public) → `portalops tier apply` (catalog flips them public). The dev pricing page is intentionally empty between those two steps.
- **Operator/manual actions (not commits):** mint the fine-grained `GITHUB_DISPATCH_TOKEN` + `portalops vars set` it and the two contact emails; create the `prod` GitHub Environment + `PROD_*` secrets; both recorded in slice 8's Done-when and the smoke doc.
- **Coverage thresholds:** `packages/core` (80%) and `apps/web` (60%) both change file inventories in slice 5 — check the coverage summary at that boundary, not at the end.
- **`.astro` formatting lands in slice 6** (plugin + glob) — earlier slices touch no `.astro` files, so the gate arrives with the file type.
- **Legal pages** ship structure-only from slice 7 with an explicit blocking marker; the business-supplied copy replaces it on this branch before any prod tag (acceptance criterion).
- **Doc-sync is slice 9** but COMMANDS.md rows land with their features (slices 2/4) — slice 9 verifies rather than writes them.

## Next step

Implementation begins on this branch — slice 1, tests-first, one commit per slice — once you've confirmed discovery, spec (including the fixture-mode amendment), and this plan.
