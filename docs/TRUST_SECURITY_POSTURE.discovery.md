# Customer-facing trust & security posture — Discovery

**Issue:** [EnterpriseBT/portal-ai#613](https://github.com/EnterpriseBT/portal-ai/issues/613)

**Why this exists.** Enterprise buyers check a vendor's public security posture during procurement, and AI buyers specifically want to know whether their data trains a model and how long it is kept. `apps/site` has a privacy policy and terms, but no security page, no `security.txt`, and no AI data-handling statement. The controls exist now: epic #578 shipped SSO, RBAC, the audit log, rate limiting, image hardening and the supply-chain gate. Nothing public says so.

The ticket's acceptance bar is **accuracy over aspiration**: the page may only describe what is true today. The survey found three places where the existing public and internal copy already gets this wrong (below), so this is the public statement of the security posture and the ticket that makes every surface describing it agree.

## The current shape

### The marketing site (`apps/site`)

| Piece | Location | Note |
|---|---|---|
| Page shell | `apps/site/src/layouts/Page.astro:12-18` | `title`, `description`, `path`, `jsonLd[]`, `noindex` → `Base.astro`; no page builds its own SEO tags |
| Long-form page pattern | `apps/site/src/pages/privacy.astro:9-22` | `EFFECTIVE_DATE` + typed `SECTIONS: {heading, blocks: (string \| {list})[]}`; `terms.astro` the same |
| Footer | `apps/site/src/components/SiteFooter.astro:12-24` | Six hard-coded links (incl. Privacy, Terms); renders Support + Sales addresses |
| Header | `apps/site/src/components/SiteHeader.astro:6-11` | Features, Use cases, Pricing, Contact + the theme toggle (the only client JS) |
| Build | `apps/site/astro.config.mjs:14-26` | Static, `trailingSlash: "always"`, directory format, `@astrojs/sitemap`. No `.ts` endpoint pages exist yet |
| `.well-known/` | `apps/site/public/.well-known/` | Exists; holds `microsoft-identity-association.json`, whose placeholder `deploy-static-site.yml` refuses to publish |
| Serving dotted paths | `infra/cloudformation/site.yml` (~177-181) | The CloudFront rewrite leaves a URI whose last segment has a dot untouched, so `/.well-known/security.txt` serves as-is |
| Build checks | `apps/site/scripts/verify-pages.mjs` | Runs in `npm run build` over `dist/`: titles, descriptions ≥40 chars (`:87`), JSON-LD (`:124-143`), no empty `mailto:` (`:155-159`), sitemap/noindex (`:173-202`). Never reads `.well-known` or text files |
| Tests | `apps/site/jest.config.js` | Covers `src/lib` + `scripts` only; maps `@portalai/core/content` to source |
| `llms.txt` | `apps/site/public/llms.txt` (~30-35) | "Canonical pages" omits Privacy, Terms (and will omit Security) |

### Contact roles (where `SECURITY_EMAIL` has to go)

Today there are three roles, each **SSM → deploy build env → baked into the HTML**, falling back to `QA_EMAIL` outside prod (`apps/site/src/lib/contact.ts:25-33`). A fourth role touches:

| Place | Location |
|---|---|
| Role export | `apps/site/src/lib/contact.ts:30-33`, re-exported from `site-context.ts:65` |
| Turbo pass-through | `apps/site/turbo.json:30-32` (`contact.test.ts` ~81-110 derives the required names from `contact.ts`, so it fails until added) |
| Site deploy | `.github/workflows/deploy-static-site.yml` "Resolve contact addresses" (~149-158) + build env (~171-173) |
| Dev seed | `.github/workflows/deploy-dev.yml:596-598` (prod is never seeded, by design: `deploy-prod.yml:13`) |
| Config catalog | `packages/devops-cli/src/catalog.ts:97-101` (`siteConfig: true` makes `vars set` trigger a rebuild); tests `__tests__/catalog.test.ts:28-43`, `__tests__/deploy-parity.test.ts:133-137` |
| Durable docs | `packages/devops-cli/COMMANDS.md:63`, `docs/DEPLOYED_ENV_CONFIG.md:30` ("four keys"), `docs/PROD_PROVISIONING.runbook.md:248,283-285,391-393`, `docs/PORTALSAI_MAIL.runbook.md:17-20,61-66,133-150` (a `security@` alias on the admin Workspace user; no DNS change) |

### Third parties that actually receive customer data

From `apps/api/src/environment.ts` and the services that use it:

| Third party | Env / call site | Data |
|---|---|---|
| AWS | hosting, RDS, S3 (`environment.ts:288-298`), Secrets Manager, Marketplace (`:70`) | everything at rest |
| Anthropic | `ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL` (`:80-96`), `services/ai.service.ts:23` | prompts + tool context |
| Tavily | `TAVILY_API_KEY`, `tools/web-search.tool.ts:21-23` | search queries |
| Mapbox | `GEOCODING_API_KEY`, `services/geocoding/mapbox.ts`, used by `geocode`, `reverse-geocode` and `bulk-geocode.processor.ts:210` | addresses / coordinates |
| Auth0 | `:9-28` | identity |
| Stripe | `:64-76`, `services/stripe.service.ts` | billing |
| Google / Microsoft | `:130-141`, `:147-151` | only the sources a customer connects |

There is no email provider and no third-party telemetry: logs go from Pino to CloudWatch. GitHub API dispatch (`:158`) carries no customer data. `@ai-sdk/groq` is a dependency of `apps/api` but nothing in `src` imports it. Customer webhook tools send to endpoints the customer hosts, so they are not subprocessors.

### Where the existing copy disagrees

1. **There are already two subprocessor lists, and they differ.** `privacy.astro:47-58` publishes the full seven above. `docs/DEPLOYMENT_SECURITY_REVIEW.md` §1/§2 (`:17-34`, baseline `:77`) lists only Anthropic, Tavily, "the geocoding provider" and AWS. The issue copied the shorter, wrong list.
2. **The review doc claims "zero-retention"** for Anthropic (`:31`, `:77`). There is no zero-retention agreement (confirmed in the PRD gate).
3. **"Encrypted at rest and in transit" is overstated.** RDS is `StorageEncrypted` (`infra/cloudformation/database.yml:86`) and every S3 bucket is AES256, but `infra/cloudformation/cache.yml` sets no `AtRestEncryptionEnabled` / `TransitEncryptionEnabled`, and `REDIS_URL` is `redis://`. `privacy.astro:85-88` makes the blanket claim anyway.
4. **Stale details:** the review doc says non-root is "in progress" (`:88`), but it shipped (`apps/api/Dockerfile:96`). `terms.astro:33` says sign-in is "through our identity provider (Google)", which predates Auth0 and enterprise SSO.

### Evidence for the controls the page may claim

| Control | Evidence |
|---|---|
| TLS 1.2+, HTTPS-only, HSTS 1y | `infra/cloudformation/site.yml:158-161,303,315`, `frontend.yml:175,184`, ALB `backend.yml:500,517`, `helmet()` `apps/api/src/app.ts:63` |
| Encryption at rest (DB, object storage, logs) | `database.yml:86` (not public: `:96`), S3 AES256 (`site.yml:70,92`, `frontend.yml:40,65`, `backend.yml:208,230`), log-group KMS `backend.yml:303`, connector credentials app-encrypted `apps/api/src/utils/crypto.util.ts:32` |
| Backups | prod RDS 14-day automated backups + `DeletionProtection` (`deploy-prod.yml:137-158`); Redis 7-day snapshots (`:178`). **`MultiAZ=false`, single region: no DR claim** |
| SSO | `environment.ts:21-28`, `middleware/auth.middleware.ts`, `docs/ENTERPRISE_SSO.runbook.md` |
| RBAC + object sharing | `services/permission*.ts`, `middleware/require-permission.middleware.ts` |
| Audit log | `services/audit.service.ts`, `AUDIT_LOG_RETENTION_MONTHS` (`environment.ts:202`) |
| Rate limiting | `middleware/{public,authenticated}-rate-limit.middleware.ts` |
| Tenant isolation | org-scoped loaders + route-authorization guard; restricted SQL reader role (`services/portal-sql-reader-role.service.ts`) |
| Supply chain | `docs/SUPPLY_CHAIN.md:5-33`: Trivy gate, SBOM, SLSA provenance, cosign, patch SLA (Critical 7d / High 30d). API image only |
| Hosting region | us-east-1 (`deploy-prod.yml:37`) |

### Existing doc-to-code parity guards to copy

`apps/api/src/__tests__/env-example-parity.test.ts` scans every `process.env.X` against `.env.example` in both directions, with an allow-list where each entry carries a reason. That is the closest model for "the subprocessor list matches the egress". Siblings: `packages/devops-cli/__tests__/deploy-parity.test.ts`, the site's `contact.test.ts` turbo guard, `builtin-toolpacks.test.ts`. Structured content shared by the site and the web app lives in `packages/core/src/content/` (pure data, no imports); the site already imports it (`apps/site/src/lib/jsonld.ts:12`).

## The design space

### Decision 1 — One subprocessor list, or two

- **A. Hand-write a second list on the security page.** That makes three copies, and the two that exist already disagree.
- **B. Structured data in `packages/core/src/content/subprocessors.util.ts`**, rendered by both `/security/` and the privacy policy's "Third parties" section, and checked against the API's egress by a parity test.
- **C. The security page links to the privacy section.** One list, but procurement reviewers look for it on the trust page, and nothing checks it against the code.

| | A | B | C |
|---|---|---|---|
| Copies to drift | 3 | 1 | 1 (prose) |
| Mechanically checked against egress | No | Yes | No |
| Change to privacy.astro | None | Renders from data | None |

**Lean: B.** The issue's own sync obligation can only be enforced against structured data, and the list it quotes is wrong because it came from a copy that drifted.

### Decision 2 — How the parity guard knows what is egress

- **A. Exhaustive classification of `environment.ts`**, in the style of `env-example-parity`. An API test maps every env var to either a subprocessor id or `internal` with a reason. A new var fails CI until someone classifies it, and every subprocessor id must be claimed by at least one var (or by an explicit hosting entry, for AWS).
- **B. A hand-listed set of egress vars.** Smaller, but a new provider's var never enters the list, which is the drift being prevented.
- **C. Scan for outbound hosts** (`fetch` URLs, SDK imports). Brittle across SDKs and `BASE_URL` overrides.

**Lean: A.** A new var has to be classified before CI passes, the same mechanism `env-example-parity` already relies on. The test lives in `apps/api`, the package that owns `environment.ts`, and imports the list from core.

### Decision 3 — Page shape

- **A. One `/security/` page with anchored sections:** Controls · Data & AI · Subprocessors · Reporting a vulnerability.
- **B. Three pages** (`/security/`, `/subprocessors/`, `/ai/`).

**Lean: A.** One page is what reviewers bookmark and send around. Anchors (`/security/#subprocessors`) give each section its own link, and `security.txt`'s `Policy:` points at `#disclosure`. The page uses the `SECTIONS` + `EFFECTIVE_DATE` pattern from privacy, so it needs no new layout primitive.

### Decision 4 — How `security.txt` is produced

- **A. A static `public/.well-known/security.txt`.** It cannot carry the build-injected `SECURITY_EMAIL`, and its `Expires` would be a hand-edited date that lapses.
- **B. An Astro endpoint `src/pages/.well-known/security.txt.ts`** that renders from a pure `src/lib/security-txt.ts` (unit-testable under the existing jest root). It fills in `Contact: mailto:<securityEmail>`, `Expires` = build time + 180 days, `Policy`, `Canonical` and `Preferred-Languages: en`. `verify-pages.mjs` then checks that the file exists, has the required fields and has a future `Expires`.

**Lean: B.** The RFC requires `Expires`, and computing it at build means the file stays valid while the site deploys at least twice a year. A lapse past 180 days without a deploy is the remaining risk (see the open questions).

### Decision 5 — Wording a control that is only partly true

- **A. Claim exactly what holds:** "databases, object storage and logs are encrypted at rest; all traffic to the service uses TLS 1.2+." Redis isn't mentioned (it holds caches and the job queue in a private subnet). File a follow-up under #578 to enable ElastiCache encryption, then widen the claim.
- **B. Enable Redis encryption in this ticket.** In-place enablement isn't supported; the cluster must be replaced and clients moved to `rediss://`. That's an infra change with a cutover, well outside a content ticket.

**Lean: A.** The page goes public now and the claim widens when the follow-up ships. The same pass corrects `privacy.astro:85-88`, whose blanket claim is the overstatement.

### Decision 6 — Keeping control claims honest over time

- **A. Prose only;** reviewers catch drift.
- **B. Each control is a structured entry with an `evidence` field** (repo paths, never rendered). A test asserts each path still exists, like `lint:doc-pointers`, so deleting the thing a claim rests on fails CI.

**Lean: B.** It costs little and covers the one failure prose can't, a control removed while its claim stays. It doesn't check what a claim means, which stays a review concern.

## Tradeoff comparison

| | D1 shared list | D2 exhaustive env classification | D3 one page | D4 endpoint | D5 claim what holds | D6 evidence pointers |
|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes | Yes |
| New pattern | Content module (existing kind) | Parity test (existing kind) | No | First `.ts` endpoint in `apps/site` | No | Small |

## Recommendation

1. Add `packages/core/src/content/subprocessors.util.ts` (id, name, purpose, data categories, condition-of-use) holding the seven verified third parties. Render it on `/security/#subprocessors` **and** in `privacy.astro`'s "Third parties" section, replacing that hand-written list.
2. Add an `apps/api` parity test that classifies every `process.env` key in `environment.ts` as a subprocessor id or `internal: <reason>`, fails on an unclassified key, and fails on a subprocessor no key or hosting entry claims.
3. Build one `/security/` page (`SECTIONS` + `EFFECTIVE_DATE` pattern) with anchored sections: Controls, Data & AI, Subprocessors (with the one-line note that residency deployments use the customer's configured providers), Reporting a vulnerability. Add it to the footer, `llms.txt` and the sitemap.
4. The AI section says: customer content is not used to train models; Anthropic processes prompts under its standard commercial API terms (no training, retained under Anthropic's standard API data-retention policy). It makes **no** zero-retention claim and shows **no** compliance badge or status.
5. Model each control as a structured entry with a non-rendered `evidence` list; a site test asserts every evidence path exists. Claim only the evidenced set above. No DR claim and no Redis claim. File a #578 follow-up for ElastiCache encryption.
6. Serve `/.well-known/security.txt` from an Astro endpoint rendering a pure `security-txt.ts`: `Contact` (new `SECURITY_EMAIL`), `Expires` (build + 180d), `Policy` (`/security/#disclosure`), `Canonical`, `Preferred-Languages`. Extend `verify-pages.mjs` to validate it.
7. Wire `SECURITY_EMAIL` through every place in the contact-roles table, including the catalog/parity tests and the four durable docs.
8. Make the copy agree in the same PR: `DEPLOYMENT_SECURITY_REVIEW.md` (full subprocessor set, drop "zero-retention", non-root shipped) and `privacy.astro:85-88` (precise encryption claim).

## Open questions

1. **`terms.astro:33` says sign-in is "through our identity provider (Google)."** It's stale since Auth0 + enterprise SSO, but Terms is legal-owned. **Lean: fix the factual identity-provider sentence here** (a description of how sign-in works, not a legal term), bump `EFFECTIVE_DATE`, and call it out in the PR for legal review.
2. **Does changing `privacy.astro` require notice?** Moving the list to shared data changes no substance, but correcting the encryption sentence does change a public statement. **Lean: bump privacy's `EFFECTIVE_DATE`.** The correction narrows a claim, so no new processing needs consent.
3. **`Expires` lapse.** If the site goes 180 days without a deploy, `security.txt` expires. **Lean: accept it and record it in `docs/PORTALSAI_MAIL.runbook.md`** next to the contact roles. Prod releases have been far more frequent, and a scheduled rebuild is infrastructure without a caller.
4. **Unused `@ai-sdk/groq` dependency.** **Lean: remove it in this PR.** A dependency for an AI provider in the shipped API makes the subprocessor list harder to defend in procurement review, and nothing imports it.
5. **Disclosure terms.** There's no bug bounty. **Lean: state good-faith safe harbor, a response target of 5 business days to acknowledge, and no bounty**, mirroring the patch SLA already in `docs/SUPPLY_CHAIN.md`. Confirm the response target with the user at spec.
6. **Does `/security/` mention SOC 2 work at all?** The PRD gate decided no status line. **Lean: no mention.** The page describes controls, and procurement reviewers will ask about SOC 2 directly.

## Enterprise-scale considerations

- **Concurrency & correctness** — N/A because the output is static content built once per deploy; there is no runtime state.
- **Accuracy & auditability** — Lean: this ticket's central dimension. One structured subprocessor source, a CI parity test against egress, evidence pointers on every control claim, and an `EFFECTIVE_DATE` on the page. Git history is the record of when each public claim changed.
- **Failure modes** — Lean: fail closed at build. An unset `SECURITY_EMAIL` falls back to the QA inbox like the other roles, never an empty `mailto:`; `verify-pages` fails a malformed or expired `security.txt`; the parity tests fail an unclassified egress var.
- **Scale & unbounded growth** — N/A because there is one static page and a list of seven.
- **Multi-tenancy** — Lean: the page names no customer and no org data. The residency note covers deployments whose subprocessors differ, without publishing any customer's configuration.
- **Contract stability** — Lean: the subprocessor ids and the `/security/#subprocessors` anchor become the stable reference that a future DPA or "subscribe to changes" feed (both out of scope) can point at.
- **Data lifecycle** — Lean: `security.txt` `Expires` is tied to the build (open question 3); the page states retention by reference to the privacy policy rather than restating windows, so there's one source.

## What this doesn't decide

- **Redis/ElastiCache encryption.** It needs a cluster replacement and a `rediss://` cutover, so it gets its own #578 follow-up; the page claim widens when it ships.
- **DR (multi-AZ, cross-region backups).** Not built (`MultiAZ=false` is deliberate), and the page doesn't claim it.
- **A DPA, a gated report portal, subprocessor-change subscriptions, an in-app (`apps/web`) security link:** all out of scope per the issue.
- **Per-residency subprocessor lists:** each deployment's review record carries its own.

## Next step

`/spec 613` writes `docs/TRUST_SECURITY_POSTURE.spec.md`: the content-module shape, the `/security/` section copy, the `security.txt` field contract and the two parity tests. `/plan 613` then slices it roughly as:
1. the `SECURITY_EMAIL` role wiring;
2. the core subprocessor module, the API parity test and privacy rendering from it;
3. the `/security/` page with its evidence test;
4. the `security.txt` endpoint and `verify-pages` checks;
5. the copy corrections across the review doc, privacy, terms and `llms.txt`.
