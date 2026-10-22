# Customer-facing trust & security posture — Spec

**Issue:** [EnterpriseBT/portal-ai#613](https://github.com/EnterpriseBT/portal-ai/issues/613) · **Epic:** #578 · **Discovery:** `docs/TRUST_SECURITY_POSTURE.discovery.md`

This spec pins what #613 adds:
- a public `/security/` page on `apps/site`, describing only the controls that have shipped;
- one shared subprocessor list, checked by a CI test against the API's env vars;
- an RFC 9116 `/.well-known/security.txt` served from a build-time endpoint;
- a fourth contact role, `SECURITY_EMAIL`;
- corrections to the existing copy that contradicts the code today.

## Key decisions (flag for review)

1. **One subprocessor list** lives in `@portalai/core/content`. `/security/` and the privacy policy's "Third parties" section both render it, replacing privacy's hand-written list (discovery D1).
2. **Every `process.env` key the API reads is classified** in a test, either as a subprocessor id or as internal with a reason. An unclassified key, or a subprocessor no key claims, fails CI (D2).
3. **One page, `/security/`**, with anchored sections: `#controls`, `#data-and-ai`, `#subprocessors`, `#disclosure` (D3).
4. **`security.txt` is an Astro endpoint** rendering a pure function. `Expires` is the build time plus 180 days. `verify-pages.mjs` checks the emitted file (D4).
5. **Claims only what holds.** The page says nothing about Redis encryption, DR or multi-AZ, and shows no compliance badge or status. There is no zero-retention claim: Anthropic retains under its standard commercial API terms (D5 and the PRD gate).
6. **Each control carries hidden `evidence` repo paths**, and a test asserts they exist. A forbidden-claims test blocks the specific overclaims found in discovery (D6).
7. **Disclosure commitment:** good-faith safe harbor, acknowledgement within **5 business days**, remediation on the published patch SLA (**Critical 7 days / High 30 days**), no bug bounty (discovery Q5, confirmed).
8. **Copy corrections ship in this PR:**
   - `privacy.astro`: the encryption sentence is made precise, and the effective date is bumped.
   - `terms.astro`: the identity-provider sentence is corrected, and the effective date is bumped (Q1, confirmed; flag it for legal in the PR body).
   - `DEPLOYMENT_SECURITY_REVIEW.md`: the full subprocessor set, no "zero-retention", non-root marked shipped.
   - The unused `@ai-sdk/groq` dependency is removed (Q4).
9. **Fail mode is fail-closed at build.** A broken `security.txt`, a dead evidence path or an unclassified egress var fails `build` or the tests. An unset `SECURITY_EMAIL` falls back to `QA_EMAIL` like the other roles, never to an empty `mailto:`.

## Scope

### In scope
- The `packages/core/src/content/subprocessors.util.ts` data module and its tests.
- The `apps/api` subprocessor/egress parity test.
- The `apps/site` additions: `/security/` page, `security-controls.ts`, `security-txt.ts`, the `.well-known/security.txt` endpoint, `verify-pages.mjs` checks, footer link, `llms.txt` entry, and privacy + terms edits.
- `SECURITY_EMAIL` wiring end to end: site, turbo, the deploy workflows, the devops-cli catalog and its tests, and the durable docs.
- `docs/DEPLOYMENT_SECURITY_REVIEW.md` corrections, and removing `@ai-sdk/groq`.
- A follow-up issue under #578 for ElastiCache encryption, filed (not implemented) in this PR.

### Out of scope
- Redis/ElastiCache encryption, DR and multi-AZ (the follow-up issue).
- A DPA, a gated report portal, subprocessor-change subscriptions, a security surface in `apps/web`.
- Per-residency subprocessor lists. Each residency deployment's review record owns its own.

## Surface

### `packages/core/src/content/subprocessors.util.ts` (new)

The module must be pure data with zero imports (`content-purity.test.ts` enforces this). Export it from `packages/core/src/content/index.ts`.

```ts
export const SUBPROCESSOR_IDS = [
  "aws", "auth0", "stripe", "google", "microsoft", "anthropic", "tavily", "mapbox",
] as const;
export type SubprocessorId = (typeof SUBPROCESSOR_IDS)[number];

export interface Subprocessor {
  id: SubprocessorId;
  name: string;      // "Amazon Web Services (AWS)"
  purpose: string;   // one sentence, rendered verbatim
  /** null = always in use; otherwise the user action that brings it into play. */
  usedWhen: string | null; // e.g. "when a portal question uses the web-search tool"
}

export const SUBPROCESSORS: readonly Subprocessor[];
/** "Residency deployments use the providers the customer configures…" */
export const RESIDENCY_SUBPROCESSOR_NOTE: string;
/** The single sentence on webhook endpoints not being subprocessors (moved from privacy). */
export const WEBHOOK_NOT_SUBPROCESSOR_NOTE: string;
```

- **Order and wording** carry over from `privacy.astro:47-58`. Google and Microsoft split into two entries, both used "only for the sources you explicitly connect".
- **No processing-location field.** The repo can evidence only AWS's region (us-east-1, `deploy-prod.yml:37`), and that appears in AWS's `purpose`.

### `apps/api/src/__tests__/subprocessor-egress-parity.test.ts` (new)

The test reuses the `env-example-parity.test.ts` source walk: every `process.env.X` under `src/`, skipping `__tests__` and `__integration__`. Two maps, each entry keyed by the env var:

```ts
const EGRESS: Record<string, SubprocessorId> = {
  ANTHROPIC_API_KEY: "anthropic", ANTHROPIC_BASE_URL: "anthropic",
  INTERPRET_AXIS_NAME_MODEL: "anthropic", INTERPRET_CLASSIFIER_MODEL: "anthropic",
  TAVILY_API_KEY: "tavily", GEOCODING_API_KEY: "mapbox",
  AUTH0_DOMAIN: "auth0", AUTH0_AUDIENCE: "auth0",
  STRIPE_SECRET_KEY: "stripe", STRIPE_WEBHOOK_SECRET: "stripe", STRIPE_AUTOMATIC_TAX: "stripe",
  GOOGLE_OAUTH_CLIENT_ID: "google", /* …all GOOGLE_* */ MICROSOFT_OAUTH_CLIENT_ID: "microsoft", /* …all MICROSOFT_* */
  DATABASE_URL: "aws", REDIS_URL: "aws", UPLOAD_S3_BUCKET: "aws", /* …UPLOAD_S3_*, DB_MASTER_SECRET_ARN,
  MIGRATE_DATABASE_*, AWS_MARKETPLACE_* */
};
/** Read, but sends no customer data to a third party. Each entry carries a reason. */
const INTERNAL: Record<string, string> = {
  GITHUB_DISPATCH_TOKEN: "site-rebuild dispatch; carries no customer data",
  SSO_ISSUERS: "the customer's own IdP, not a Portals subprocessor",
  LOG_LEVEL: TUNING, /* … */
};
```

Shared reason constants (`TUNING`, `RETENTION`, `SELF`, `DEV_ONLY`) keep the roughly 60 internal entries one line each.

Four assertions:
1. Every key read is in exactly one of `EGRESS` or `INTERNAL`.
2. Neither map names a key that's no longer read, so a stale entry is caught.
3. Every `SUBPROCESSORS` id is claimed by at least one `EGRESS` value.
4. Every `EGRESS` value is a member of `SUBPROCESSOR_IDS`.

### `apps/site/src/lib/security-controls.ts` (new)

```ts
export interface SecurityControl {
  id: string;            // stable anchor-safe slug
  title: string;         // "Encryption in transit"
  claim: string;         // rendered sentence(s)
  /** Repo-root-relative paths the claim rests on. Never rendered. */
  evidence: readonly string[];
}
export const SECURITY_CONTROLS: readonly SecurityControl[];
/** Phrases no rendered claim may contain (case-insensitive). */
export const FORBIDDEN_CLAIMS: readonly string[];
```

The controls, all evidenced in discovery's "Evidence" table:

| id | Claim (substance) | evidence |
|---|---|---|
| `encryption-in-transit` | All traffic uses HTTPS with TLS 1.2+; HSTS | `infra/cloudformation/site.yml`, `infra/cloudformation/frontend.yml`, `apps/api/src/app.ts` |
| `encryption-at-rest` | The database, file storage and logs are encrypted at rest; connector credentials are additionally encrypted by the application | `infra/cloudformation/database.yml`, `infra/cloudformation/backend.yml`, `apps/api/src/utils/crypto.util.ts` |
| `hosting` | Hosted on AWS in us-east-1; the database is not publicly reachable | `infra/cloudformation/database.yml`, `.github/workflows/deploy-prod.yml` |
| `backups` | Automated daily database backups kept 14 days; deletion protection on | `.github/workflows/deploy-prod.yml` |
| `sso` | Sign-in through Auth0; enterprise single sign-on with your own OIDC identity provider | `apps/api/src/middleware/auth.middleware.ts`, `docs/ENTERPRISE_SSO.runbook.md` |
| `access-control` | Role- and policy-based permissions, checked server-side on every request, with per-object sharing | `apps/api/src/middleware/require-permission.middleware.ts`, `apps/api/src/__tests__/config/route-authorization.map.ts` |
| `tenant-isolation` | Every request is scoped to your organization; agent SQL runs under a restricted database role | `apps/api/src/services/portal-sql-reader-role.service.ts` |
| `audit-log` | Security-relevant actions are recorded in an organization audit log | `apps/api/src/services/audit.service.ts` |
| `rate-limiting` | Authenticated API requests are rate-limited per user (per-user only: the middleware has no per-org bucket, so the page makes no per-org claim) | `apps/api/src/middleware/authenticated-rate-limit.middleware.ts` |
| `vulnerability-management` | Every release image is scanned and blocked on fixable critical/high findings; signed, with an SBOM | `docs/SUPPLY_CHAIN.md`, `apps/api/Dockerfile` |

`FORBIDDEN_CLAIMS` = `["zero retention", "zero-retention", "zero data retention", "SOC 2", "ISO 27001", "disaster recovery", "multi-AZ", "multi-region", "Redis", "certified", "military-grade"]`. The forbidden-claims test checks the rendered `claim` strings and the page's prose constants in `security-page.ts` (below).

### `apps/site/src/lib/security-page.ts` (new)

The rendered prose for the sections that aren't the controls list, kept in `src/lib` so jest can check it:
- `DATA_AND_AI_PARAGRAPHS: string[]`:
  - customer content is never used to train models;
  - prompts and the context needed to answer are sent to Anthropic, processed under its commercial API terms (no training; retained per Anthropic's standard API data-retention policy);
  - custom webhook tools send data only to endpoints the customer hosts;
  - retention windows are in the privacy policy.
- `DISCLOSURE_PARAGRAPHS(securityEmail: string): string[]`:
  - where to report;
  - acknowledgement within 5 business days;
  - remediation on a severity basis: Critical 7 days, High 30 days;
  - good-faith safe harbor: no legal action for good-faith research that avoids privacy violations and service disruption and doesn't access other customers' data;
  - no bug bounty.

### `apps/site/src/pages/security.astro` (new)

- Follows privacy's pattern: `EFFECTIVE_DATE_ISO`/`_LABEL`, `<Page title="Security — Portals AI" description=… path="/security/" jsonLd={[breadcrumbLd(siteUrl, [Home, Security])]}>`, and one `<h1>Security</h1>`.
- The section anchors are `#controls`, `#data-and-ai`, `#subprocessors` and `#disclosure`. Each control's `<h3 id={control.id}>`.
- `#subprocessors` renders `SUBPROCESSORS` (name, purpose, `usedWhen`), then `WEBHOOK_NOT_SUBPROCESSOR_NOTE` and `RESIDENCY_SUBPROCESSOR_NOTE`.
- `#disclosure` renders a `mailto:` link to `securityEmail` and links to `/.well-known/security.txt`.
- No client JS and no new layout; styles copy privacy's.

### `apps/site/src/lib/security-txt.ts` (new) and `src/pages/.well-known/security.txt.ts` (new)

```ts
export interface SecurityTxtInput { contactEmail: string; siteUrl: string; now: Date; }
export const SECURITY_TXT_TTL_DAYS = 180;
/** RFC 9116 body, LF line endings, trailing newline. */
export function renderSecurityTxt(input: SecurityTxtInput): string;
```

The output, in this field order:

```
Contact: mailto:<contactEmail>
Expires: <now + 180d, ISO 8601 UTC, seconds precision, "Z">
Preferred-Languages: en
Canonical: <siteUrl>/.well-known/security.txt
Policy: <siteUrl>/security/#disclosure
```

The endpoint is `export const GET: APIRoute = () => new Response(renderSecurityTxt({ contactEmail: securityEmail, siteUrl, now: new Date() }), { headers: { "Content-Type": "text/plain; charset=utf-8" } })`, and static output prerenders it to `dist/.well-known/security.txt`. `siteUrl` has its trailing slash stripped before joining.

### `apps/site/scripts/verify-pages.mjs` (edit)

Add a `security.txt` block after "static SEO files". It fails the build when `dist/.well-known/security.txt`:
- is missing;
- lacks exactly one `Contact:` that is a `mailto:` with a non-empty address, or lacks exactly one `Expires:`;
- has an `Expires` that doesn't parse or isn't in the future;
- has a `Canonical` or `Policy` that isn't under the build's `SITE_URL` origin.

The parsing goes in an exported pure helper, `checkSecurityTxt(text, { now, origin }): string[]`, which returns failure messages so a jest test can drive it.

### `SECURITY_EMAIL` contact role

| File | Change |
|---|---|
| `apps/site/src/lib/contact.ts` | `/** Security disclosure contact — security.txt and /security/. */ export const securityEmail = email(process.env.SECURITY_EMAIL);` |
| `apps/site/src/lib/site-context.ts:65` | Add `securityEmail` to the re-export |
| `apps/site/turbo.json` | Add `"SECURITY_EMAIL"` to `passThroughEnv` |
| `.github/workflows/deploy-static-site.yml` | Resolve `$prefix/security-email` alongside the others; pass `SECURITY_EMAIL` to "Build site" |
| `.github/workflows/deploy-dev.yml:596-598` | `seed /portalai/dev/security-email qa@portalsai.io` |
| `packages/devops-cli/src/catalog.ts:97-101` | `{ ...ssm("SECURITY_EMAIL", "security-email"), siteConfig: true }` with a `#613` comment |
| `packages/devops-cli/src/__tests__/catalog.test.ts`, `__tests__/deploy-parity.test.ts:133-137` | Add `SECURITY_EMAIL` to the expected SSM list and the catalog-only list |
| Docs | `packages/devops-cli/COMMANDS.md`, `docs/DEPLOYED_ENV_CONFIG.md` (four keys → five), `docs/PROD_PROVISIONING.runbook.md`, `docs/PORTALSAI_MAIL.runbook.md` (`security@` Workspace alias on admin; the `Expires`/180-day rebuild note) |

The web app does not get the variable, because it never shows the address.

### Copy corrections (edits)

- **`apps/site/src/pages/privacy.astro`:**
  - The "Third parties" list renders from `SUBPROCESSORS`, plus `WEBHOOK_NOT_SUBPROCESSOR_NOTE`.
  - The Security paragraph becomes: "Traffic to the Service is encrypted in transit with TLS, and our database, file storage, and logs are encrypted at rest; connector credentials are additionally encrypted by the application…", plus a link to `/security/`.
  - `EFFECTIVE_DATE` → the merge date.
- **`apps/site/src/pages/terms.astro:33`:** "You sign in through our identity provider, Auth0 — with Google, or with your organization's own single sign-on where it has been set up — and must keep…". `EFFECTIVE_DATE` → the merge date.
- **`apps/site/src/components/SiteFooter.astro`:** add `<li><a href="/security/">Security</a></li>` after Terms.
- **`apps/site/public/llms.txt`:** add Security (plus Privacy and Terms) to "Canonical pages".
- **`docs/DEPLOYMENT_SECURITY_REVIEW.md`:**
  - §1/§2 (`:17-34`) and the baseline (`:77`) list the full set from `SUBPROCESSORS`, plus a line pointing at the parity test.
  - Remove "zero-retention" (`:31`, `:77`) in favour of "no training; standard commercial API retention".
  - `:88` non-root becomes shipped.
- **`apps/api/package.json`:** remove `@ai-sdk/groq`, and update the lockfile through `npm install`.

## Migration
## Seed

None: there's no schema or seed change.

## TDD test plan

Run from each package with `npm run test:unit` (never raw jest).

### `packages/core`: `src/__tests__/content/subprocessors.util.test.ts` (new)
- Ids are unique and every `SUBPROCESSOR_IDS` member has exactly one entry.
- Every `name` and `purpose` is non-empty and ends with sentence punctuation.
- AWS's `usedWhen` is null; Tavily's and Mapbox's are non-null.
- The notes are non-empty.
- `content-purity.test.ts` passes unchanged with the module added.

### `apps/api`: `src/__tests__/subprocessor-egress-parity.test.ts` (new)
- Every env key read is classified, with exactly one classification.
- No stale `EGRESS` or `INTERNAL` keys.
- Every subprocessor is claimed; every `EGRESS` value is a known id.
- A fixture case: a synthetic unclassified key fails with a message naming it.

### `apps/site`
- **`src/lib/__tests__/security-txt.test.ts` (new):**
  - field order;
  - `Expires` = now + 180 days, in `Z` form;
  - the trailing slash in `siteUrl` is normalized;
  - LF endings and a trailing newline;
  - the `Contact` is a `mailto:`.
- **`src/lib/__tests__/security-controls.test.ts` (new):**
  - ids are unique and anchor-safe;
  - every `evidence` path exists relative to the repo root;
  - no claim or `security-page.ts` paragraph contains a `FORBIDDEN_CLAIMS` phrase;
  - the disclosure paragraphs contain the passed email, "5 business days", "7 days" and "30 days".
- **`scripts/__tests__/verify-security-txt.test.ts` (new):** `checkSecurityTxt` passes a rendered file and fails on each of these:
  - a missing `Contact`;
  - an empty `mailto:`;
  - a past `Expires`;
  - an unparseable `Expires`;
  - a foreign-origin `Canonical`;
  - a duplicate `Expires`.
- **`src/lib/__tests__/contact.test.ts` (edit):** the role lists include `securityEmail`/`SECURITY_EMAIL`, with the QA fallback when it's unset. The turbo guard covers it automatically.

### `packages/devops-cli`
`catalog.test.ts` and `deploy-parity.test.ts` are edited as listed in the Surface table.

### Build
`npm run build --workspace @portalai/site` succeeds, and `verify-pages` passes with `/security/` in the sitemap and `dist/.well-known/security.txt` emitted.

**Totals ≈ 30 cases** across core 5, api 5, site 17 and devops-cli 3.

## Acceptance criteria

- [ ] `/security/` renders the controls, data & AI, subprocessors and disclosure sections. It has no compliance badge or status, and no claim about zero retention, DR, multi-AZ or Redis.
- [ ] `/security/` is linked from the footer on every page, is listed in the sitemap and `llms.txt`, renders at 375px with no horizontal scroll, and follows the light/dark theme toggle.
- [ ] Privacy's "Third parties" section and `/security/#subprocessors` show the same eight entries, from one source.
- [ ] Adding a `process.env` read to `apps/api/src` without classifying it fails `npm run test:unit` in `apps/api`.
- [ ] `GET /.well-known/security.txt` on the deployed site returns `200 text/plain` with `Contact: mailto:<security email>` and an `Expires` about 180 days after the build. On app-dev the contact is `qa@portalsai.io`.
- [ ] Builds that leave out `SECURITY_EMAIL` still emit a valid file with the QA contact. A build whose file would be invalid fails.
- [ ] `DEPLOYMENT_SECURITY_REVIEW.md`, privacy and terms make no claim the page contradicts. `@ai-sdk/groq` is gone from `apps/api/package.json`.
- [ ] `portalops vars describe --env app-dev` lists `SECURITY_EMAIL` as a site-config key.
- [ ] The ElastiCache-encryption follow-up issue is filed under #578.

## Risks & rollback

- **Astro may not route `src/pages/.well-known/`** (a dot-directory). The build would just omit the file, and `verify-pages` would fail loudly. Fallback within this PR: a post-build step in the site's `build` script writes `dist/.well-known/security.txt` from the same `renderSecurityTxt`. The contract is unchanged.
- **Unset prod `SECURITY_EMAIL`:** prod is never seeded, so the first prod deploy publishes `qa@` unless an operator runs `portalops vars set SECURITY_EMAIL --env prod` first. Mitigation: `PROD_PROVISIONING.runbook.md` adds that step, and the PR body lists it as a pre-release step. The failure is a wrong-but-working inbox, never a dead one.
- **`Expires` lapse:** if the site isn't rebuilt for 180 days, scanners report the file as expired. A rebuild clears it. The runbook records this.
- **Public over-claim:** the main safety risk of a trust page. The evidence and forbidden-claims tests cover deletions and the known overclaims; wording stays a review concern. Rollback is reverting the commit and redeploying the site. The site is static, so no state is involved.
- **Removing groq:** if anything loads it dynamically, the API fails at runtime, not at build. The discovery found no import, and the full build plus unit suite confirm it.

## Files touched

- **New:**
  - `packages/core/src/content/subprocessors.util.ts`
  - `packages/core/src/__tests__/content/subprocessors.util.test.ts`
  - `apps/api/src/__tests__/subprocessor-egress-parity.test.ts`
  - `apps/site/src/lib/{security-controls,security-page,security-txt}.ts`
  - `apps/site/src/lib/__tests__/{security-controls,security-txt}.test.ts`
  - `apps/site/scripts/__tests__/verify-security-txt.test.ts`
  - `apps/site/src/pages/security.astro`
  - `apps/site/src/pages/.well-known/security.txt.ts`
- **Edit:**
  - `packages/core/src/content/index.ts`
  - `apps/site/src/lib/{contact,site-context}.ts`
  - `apps/site/src/lib/__tests__/contact.test.ts`
  - `apps/site/turbo.json`
  - `apps/site/scripts/verify-pages.mjs`
  - `apps/site/src/pages/{privacy,terms}.astro`
  - `apps/site/src/components/SiteFooter.astro`
  - `apps/site/public/llms.txt`
  - `.github/workflows/{deploy-static-site,deploy-dev}.yml`
  - `packages/devops-cli/src/catalog.ts`
  - `packages/devops-cli/src/__tests__/{catalog,deploy-parity}.test.ts`
  - `packages/devops-cli/COMMANDS.md`
  - `docs/{DEPLOYED_ENV_CONFIG,PORTALSAI_MAIL.runbook,PROD_PROVISIONING.runbook,DEPLOYMENT_SECURITY_REVIEW}.md`
  - `apps/api/package.json` and `package-lock.json`

## Next step

`/plan 613` writes `docs/TRUST_SECURITY_POSTURE.plan.md`, likely in five TDD slices on this branch:
1. the `SECURITY_EMAIL` role wiring;
2. the core subprocessor module, the API parity test, privacy rendering from it, and the groq removal;
3. `security-controls` / `security-page` with their tests, and the `/security/` page, footer and `llms.txt`;
4. `security-txt.ts`, the endpoint and the `verify-pages` check;
5. the copy corrections in the review doc and terms, and filing the ElastiCache follow-up.
