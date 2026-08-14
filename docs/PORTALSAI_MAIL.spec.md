# portalsai.io mail — Spec

**Issue:** [EnterpriseBT/portal-ai#369](https://github.com/EnterpriseBT/portal-ai/issues/369) · **Discovery:** `docs/PORTALSAI_MAIL.discovery.md` · branch `feat/portalsai-mail`

This spec pins the three email keys and their env-var names, the exact deletion list that collapses four sources of truth into one, the `dns-email.yml` records, and the per-environment values (`qa@` outside prod).

## Key decisions (flag for review)

Discovery decisions D1–D7 and open questions Q1–Q6 are ratified as their leans, with two amendments:

- **D1 — one write path, three readers.** SSM is where a value is written (`portalops vars set`); the deploy pipeline resolves it once and injects env into the web build, the site build, and — as it turns out — nowhere else.
- **D2 — the `contact` block leaves the public contract.** A breaking change to a public endpoint, acceptable because its only consumer is this repo's marketing site, which stops reading it in the same commit.
- **Q1 resolved by inspection, and it goes further than discovery expected: `apps/api` stops knowing about emails entirely.** The only consumer chain was `environment` → `BusinessConfigService.getContact()` → `SiteConfigService` → the public endpoint. `getContact()` is the *whole* of `BusinessConfigService`, so **the entire service and its test file are deleted**, along with the two `environment.ts` entries and `SITE_CONFIG_CONTACT_UNRESOLVED`.
- **No new dispatch** (confirmed): the deploy is the dispatch. `siteConfig: true` stays on the email keys — it already exists, and a `vars set` that rebuilds the site is free value; the app catches up on its next deploy. **Nothing new is built for the app**, and the asymmetry is documented rather than engineered away.
- **D3 — same three keys in every environment**, differing only in value. `qa@portalsai.io` for all three outside prod. No `isProd` branch in rendering code.
- **D5 — DKIM as a stack parameter** behind a CFN `Condition`, so the template is authored complete in one pass.
- **D7 — app/site wiring is app-dev only** (prod blocked on #83); **`dns-email.yml` is domain-wide and deployed once**, not parameterized per environment.
- **Failure-mode shift, stated deliberately** (discovery → Enterprise → Failure modes): with the runtime read gone, an unset value can no longer 503. The gates become `verify-pages.mjs:151-157` (empty-`mailto:`) for the site and, for the app, a fallback to `qa@portalsai.io` — **an address we own** — so a misconfigured build still delivers mail to us rather than rendering a dead link.

## Scope

### In scope

1. `ADMIN_EMAIL` catalog key; `qa@` values for all three keys outside prod.
2. Deletion of the runtime contact path: `BusinessConfigService`, the `contact` block on the public contract, the fail-closed check, `SITE_CONFIG_CONTACT_UNRESOLVED`, the two `environment.ts` entries.
3. Env-var wiring for `apps/web` (`VITE_*`) and `apps/site` (`process.env.*`), resolved from SSM in the deploy workflows.
4. `apps/web` repoint off `mailto:ben.turner@btdev.io`, including visible link text.
5. `apps/site` terms/privacy showing `admin@`; footer/contact reading env.
6. `infra/cloudformation/dns-email.yml` + `deploy-infra` wiring.
7. A maintainer runbook; CLI-charter rows.
8. Adjacent: `.env.example` files, the stale README URL, the two `SUBSCRIPTION_TIER_CARDS` docs.

### Out of scope

- Any mail **sender** (SES, nodemailer, templates, bounce handling); Auth0's own verification sender; `noreply@`; a web rebuild dispatch; prod app/site values (#83); moving the hosted zone into IaC; the parked domains.

## Surface

### The env-var contract

Three business addresses, one key each, same key set in every environment:

| Role | SSM leaf (`/portalai/{env}/…`) | Catalog key | `apps/web` | `apps/site` |
|---|---|---|---|---|
| Support | `support-email` | `SUPPORT_EMAIL` | `VITE_SUPPORT_EMAIL` | `SUPPORT_EMAIL` |
| Sales | `sales-email` | `SALES_EMAIL` | `VITE_SALES_EMAIL` | `SALES_EMAIL` |
| Admin / legal | `admin-email` | `ADMIN_EMAIL` | — (not rendered in the app) | `ADMIN_EMAIL` |

**Values:** `qa@portalsai.io` for all three in local and app-dev; `support@` / `sales@` / `admin@portalsai.io` in prod.

### `packages/devops-cli/src/catalog.ts`

Added beside the two existing entries (`:73-74`):

```ts
{ ...ssm("ADMIN_EMAIL", "admin-email"), siteConfig: true },
```

`catalog.test.ts` — two pins move: `ADMIN_EMAIL` sorts into the `byKind("ssm")` list (`:26-37`), and the `siteConfig` assertion (`:87-89`) becomes `["SUPPORT_EMAIL", "SALES_EMAIL", "ADMIN_EMAIL"]` (declaration order).

### `packages/core/src/contracts/site-config.contract.ts` — removals

`PublicSiteContactSchema` (`:62-66`) is **deleted**, along with its export and the `.min(1)` commentary at `:53-61`. `PublicSiteConfigResponseSchema` loses one field:

```ts
export const PublicSiteConfigResponseSchema = z.strictObject({
  tiers: z.array(PublicSiteTierSchema),
  generatedAt: z.string(),
});
```

`site-config.contract.test.ts:83-98` (`describe("PublicSiteContactSchema")`) is deleted; the response-schema test drops `contact` from its fixture.

### `apps/api` — removals only

| File | Change |
|---|---|
| `services/business-config.service.ts` | **Deleted.** `getContact()` was its only member; `ContactConfig`, the two leaf constants, and the 5-minute cache go with it. |
| `__tests__/services/business-config.service.test.ts` | Deleted. |
| `services/site-config.service.ts:60-82` | `getSiteConfig()` stops awaiting contact and drops the fail-closed contact check; the tier price check at the same site is untouched. |
| `constants/api-codes.constants.ts:71` | `SITE_CONFIG_CONTACT_UNRESOLVED` removed (no remaining thrower). |
| `environment.ts:99-100` | `SUPPORT_EMAIL` / `SALES_EMAIL` removed. |
| `.env.example` | No email keys — the API no longer reads any. |

The API's public endpoint keeps serving tiers and `generatedAt`, unchanged in every other respect.

### `apps/web`

**New `src/utils/contact.util.ts`** — the single place the app knows an address:

```ts
/** Non-prod inbox, and the safe fallback: a misconfigured build still
 *  delivers to an address we own rather than rendering a dead mailto. */
const FALLBACK_EMAIL = "qa@portalsai.io";

export const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || FALLBACK_EMAIL;
export const SALES_EMAIL = import.meta.env.VITE_SALES_EMAIL || FALLBACK_EMAIL;
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;
export const SALES_MAILTO = `mailto:${SALES_EMAIL}`;
```

`src/vite-env.d.ts` gains `readonly VITE_SUPPORT_EMAIL: string;` and `readonly VITE_SALES_EMAIL: string;`. `.env.example` gains both, set to `qa@portalsai.io`.

Call sites:

| File | Change |
|---|---|
| `utils/tier-format.util.ts:16` | `SUPPORT_MAILTO` constant **removed** (moved to `contact.util.ts`) |
| `views/Help.view.tsx:34,233` | import from `contact.util`; render `{SUPPORT_EMAIL}` as the **visible link text**, not a hardcoded string |
| `components/TierCard.component.tsx:18,232` | import from `contact.util`; href unchanged in shape |
| `components/SubscriptionBilling.component.tsx:135` | "contact us to make changes" gains a `SALES_MAILTO` link — a managed-plan customer told to contact us with no address is a dead end |

### `apps/site`

Emails come from build env, not the API. `src/lib/site-context.ts` (which already exports `siteUrl`/`appUrl` from `process.env` at `:47-53`) gains:

```ts
const FALLBACK_EMAIL = "qa@portalsai.io";
export const supportEmail = process.env.SUPPORT_EMAIL || FALLBACK_EMAIL;
export const salesEmail = process.env.SALES_EMAIL || FALLBACK_EMAIL;
export const adminEmail = process.env.ADMIN_EMAIL || FALLBACK_EMAIL;
```

| File | Change |
|---|---|
| `lib/site-config.fixture.json:89-92` | `contact` block removed (the fixture is schema-validated) |
| `lib/site-config.ts` | stops parsing `contact` |
| `lib/jsonld.ts:16-29` | `organizationLd` takes the support address from `site-context`, not from the fetched config |
| `components/SiteFooter.astro:7,25-26`, `pages/contact.astro:9,37-51` | read `supportEmail`/`salesEmail` from `site-context` |
| `pages/terms.astro:10,78-79`, `pages/privacy.astro:12,81-82` | show **`adminEmail`** as the legal/data-controller contact |
| `scripts/preflight-site-config.mjs:55-66` | contact remediation lines removed; the check no longer asserts contact fields |
| `scripts/verify-pages.mjs:151-157` | **unchanged** — the empty-`mailto:` gate now catches an unset build env var |

### Workflows

**`deploy-dev.yml`** — the seed block (`:317-337`) gains `admin-email` and all three dev values become `qa@portalsai.io`:

```bash
seed "/portalai/dev/support-email" "qa@portalsai.io"
seed "/portalai/dev/sales-email"   "qa@portalsai.io"
seed "/portalai/dev/admin-email"   "qa@portalsai.io"
```

`seed()` is create-if-absent and **never overwrites**, so the two parameters that already hold `support@`/`sales@portalsai.io` in app-dev must be changed once by hand — `portalops vars set SUPPORT_EMAIL qa@portalsai.io --env app-dev --yes`. That is a runbook step, not an automated migration.

The `deploy-frontend` job resolves the two web values from SSM and adds them to the existing `VITE_*` build env (`:163-168`):

```yaml
VITE_SUPPORT_EMAIL: ${{ steps.contact.outputs.support }}
VITE_SALES_EMAIL:   ${{ steps.contact.outputs.sales }}
```

**`deploy-static-site.yml`** — already receives `PORTALOPS_ENV` and has AWS credentials for the S3 publish, so it resolves all three from SSM itself and adds them to the build env alongside `SITE_URL` / `SITE_APP_URL` / `SITE_CONFIG_URL` (`:126-132`). `deploy-site-prod.yml` is untouched; its early-exit (`:65-75`) still governs prod.

### `infra/cloudformation/dns-email.yml` (new)

Parameters: `HostedZoneId: AWS::Route53::HostedZone::Id`, `DomainName` (default `portalsai.io`), `DkimValue: String` (default `""`), `DkimSelector: String` (default `google`).

| Resource | Type | Value |
|---|---|---|
| `MxRecord` | `MX` on the apex | the five Google MX hosts with priorities `1, 5, 5, 10, 10` |
| `SpfRecord` | `TXT` on the apex | `"v=spf1 include:_spf.google.com ~all"` |
| `DmarcRecord` | `TXT` on `_dmarc.<domain>` | `"v=DMARC1; p=none; rua=mailto:admin@portalsai.io; fo=1"` |
| `DkimRecord` | `CNAME` on `<selector>._domainkey.<domain>` | `!Ref DkimValue`, wrapped in `Condition: HasDkim` (`!Not [!Equals [!Ref DkimValue, ""]]`) |

**Header comment must state two things** the next reader will otherwise get wrong: mail is a property of the *domain*, not an environment, so there is no `Environment` parameter and the stack is deployed once; and the DKIM value cannot exist until after Google verifies the domain, which is why it is a conditional parameter rather than a literal.

Wired into `deploy-infra` (`deploy-dev.yml:24-140`) after `dns-certs`, passing `HostedZoneId` like every sibling. Stack name `portalai-dns-email` — **no environment segment**, matching the domain-wide nature.

### Runbook + charter

`docs/PORTALSAI_MAIL.runbook.md` — the maintainer-executed half: Workspace tenant → paid seat `admin@` → `support@`, `sales@`, `qa@` as free aliases → domain verification → DKIM key → redeploy with `DkimValue` → external SPF/DKIM/DMARC validation → the one-time `portalops vars set` for the two pre-seeded dev values → a line on mail retention being a Workspace policy decision.

`docs/CLI_OPERATIONS_CHARTER.md` gains DNS/registrar/mailbox rows as an **out-of-band, runbook-driven** category, and the coverage figures at `:189-211` (today D=45 N=44 97.8%) are recomputed.

## Migration / Seed

No DB schema change, no migration. The only stateful change is SSM: one new parameter per environment (`admin-email`) plus the one-time manual correction of the two existing app-dev values, both covered in the runbook.

## TDD test plan

`cd packages/core && npm run test:unit`; `cd packages/devops-cli && npm run test:unit`; `cd apps/api && npm run test:unit`; `cd apps/web && npm run test:unit`. Never raw jest.

### Layer 1 — catalog (`packages/devops-cli/src/__tests__/catalog.test.ts`)

1. `ADMIN_EMAIL` is an SSM entry with leaf `admin-email` and appears in the sorted `byKind("ssm")` pin.
2. The `siteConfig` set is exactly `["SUPPORT_EMAIL", "SALES_EMAIL", "ADMIN_EMAIL"]`.
3. `pathFor("ADMIN_EMAIL", env)` resolves `/portalai/{env}/admin-email`.

### Layer 2 — the contract (`packages/core/src/__tests__/contracts/site-config.contract.test.ts`)

4. `PublicSiteConfigResponseSchema` parses `{tiers, generatedAt}` and **rejects** an extra `contact` key (`strictObject` is what makes the removal enforceable).
5. `PublicSiteContactSchema` is no longer exported from the contracts barrel.

### Layer 3 — the API (`apps/api/src/__tests__/`)

6. `SiteConfigService.getSiteConfig()` returns `{tiers, generatedAt}` with no `contact`.
7. It still fails closed on an unresolved tier **price** — the deletion touched only the contact branch.
8. `GET /api/public/site-config` responds 200 with the reduced payload and its existing cache headers.
9. No module imports `BusinessConfigService` (guard: the file is gone and nothing references it).
10. `SITE_CONFIG_CONTACT_UNRESOLVED` is absent from `ApiCode`.

### Layer 4 — `apps/web` (`apps/web/src/__tests__/`)

11. `contact.util` exposes `SUPPORT_EMAIL`/`SALES_EMAIL` from the `VITE_*` vars when set.
12. With the vars unset it falls back to `qa@portalsai.io` — **not** an empty string, so no surface can render `mailto:`.
13. `HelpView` renders the support address as both the `href` **and** the visible link name (the old test pinned a hardcoded literal at `:325-329`).
14. `TierCard` contact CTA uses `SUPPORT_MAILTO` (`:174` updated off the btdev.io literal).
15. `SubscriptionBilling` renders a `sales@` link for the managed-plan copy (`:175` updated).
16. **Guard:** no source file under `apps/web/src` contains `btdev.io`.

### Layer 5 — `apps/site`

17. `site-context` exports the three addresses from `process.env`, falling back to `qa@portalsai.io`.
18. The site-config fixture parses against the reduced schema (no `contact`).
19. `verify-pages.mjs` still fails a page containing `href="mailto:"` — unchanged behavior, re-pinned because it is now the primary gate.

### Layer 6 — not automatable

Mail delivery, SPF/DKIM/DMARC validation, and the CloudFormation deploy are **smoke-only**: no test can assert a mailbox receives mail or that Route53 holds a record. Recorded here rather than dropped; the runbook walkthrough is the gate.

**Totals:** ~3 catalog, ~2 contract, ~5 api, ~6 web, ~3 site ≈ **19 cases**, plus a smoke-only layer.

## Acceptance criteria

- [ ] All cases pass; `npm run test`, `type-check`, `lint`, `format:check` green at the root.
- [ ] `grep -rn "btdev.io" apps/ packages/ docs/` returns nothing.
- [ ] No app or site surface renders an address outside `portalsai.io`.
- [ ] Mail to `admin@`, `support@`, `sales@`, and `qa@portalsai.io` is delivered and readable.
- [ ] SPF, DKIM, and DMARC pass an external validator.
- [ ] The mail records exist as code in `infra/cloudformation/` and survive a stack re-deploy.
- [ ] In app-dev, every rendered address is `qa@portalsai.io` — no customer-facing inbox appears in a non-prod surface.
- [ ] The Help view and the contact-tier CTA both point at the support address, with matching visible text where it is shown.
- [ ] Site terms and privacy show the admin address as the legal contact.
- [ ] `GET /api/public/site-config` returns `{tiers, generatedAt}`; a request that would previously have 503'd on missing contact now succeeds.
- [ ] With the build env unset, the app and site render `qa@portalsai.io` rather than an empty `mailto:`, and `verify-pages.mjs` still fails an empty one.
- [ ] A fresh clone with both `.env.example` files copied renders working addresses.

## Risks & rollback

| Risk | Detection / mitigation |
|---|---|
| **A prod build with the env unset silently advertises `qa@`.** | The deliberate trade: an address we own beats a dead `mailto:`. Caught by the smoke step asserting prod renders `support@`, not by a runtime error. This is the design's weakest point and is stated rather than hidden. |
| Removing a public contract field breaks an unknown consumer. | The only consumer is `apps/site`, changed in the same PR; `strictObject` + case 4 make a stale reader fail loudly rather than silently. Called out in the PR body. |
| The two pre-seeded app-dev values still hold `support@`/`sales@` after deploy, so staging keeps showing customer addresses. | `seed()` never overwrites — a one-time `portalops vars set` is a runbook step and a smoke check, not an assumption. |
| DKIM record missing because the stack deployed before verification. | By design: the `Condition` omits it until `DkimValue` is supplied. The runbook's redeploy step and the external validator are the gate. |
| Deleting `BusinessConfigService` removes a service a future feature wanted. | It had exactly one member serving one consumer. Re-adding a runtime config read is a small, well-understood change if a genuinely dynamic business fact appears. |
| An email change now requires a deploy. | Accepted (D1). The site still rebuilds on `vars set` via `siteConfig: true`; the app waits for its next deploy, documented rather than engineered around. |

**Rollback:** `git revert` restores the runtime path and the contract field; the SSM parameters are additive and harmless if unread. The CloudFormation stack is deleted independently — dropping mail records stops mail but breaks nothing in the app.

## Files touched

**`packages/devops-cli`** — edit `src/catalog.ts`, `src/__tests__/catalog.test.ts`, `COMMANDS.md:60-75`.

**`packages/core`** — edit `src/contracts/site-config.contract.ts` (delete the contact schema + field), `src/__tests__/contracts/site-config.contract.test.ts`.

**`apps/api`** — **delete** `src/services/business-config.service.ts` and its test; edit `src/services/site-config.service.ts`, `src/constants/api-codes.constants.ts`, `src/environment.ts`, `.env.example`, and the site-config/router tests.

**`apps/web`** — new `src/utils/contact.util.ts` + its test; edit `src/utils/tier-format.util.ts`, `src/vite-env.d.ts`, `.env.example`, `src/views/Help.view.tsx`, `src/components/TierCard.component.tsx`, `src/components/SubscriptionBilling.component.tsx`, `README.md:33`, and the three tests pinning the old literal.

**`apps/site`** — edit `src/lib/site-context.ts`, `src/lib/site-config.ts`, `src/lib/site-config.fixture.json`, `src/lib/jsonld.ts`, `src/components/SiteFooter.astro`, `src/pages/{contact,terms,privacy}.astro`, `scripts/preflight-site-config.mjs`.

**Infra + docs** — new `infra/cloudformation/dns-email.yml`, new `docs/PORTALSAI_MAIL.runbook.md`; edit `.github/workflows/deploy-dev.yml`, `.github/workflows/deploy-static-site.yml`, `docs/CLI_OPERATIONS_CHARTER.md`, `docs/SUBSCRIPTION_TIER_CARDS.{spec,smoke}.md`.

## Next step

`docs/PORTALSAI_MAIL.plan.md` — six TDD slices: (1) the `ADMIN_EMAIL` catalog key and its two pins; (2) the contract + API deletions, which is the breaking change and wants its own reviewable commit; (3) `apps/site` reading env; (4) the `apps/web` repoint plus the doc corrections; (5) `dns-email.yml` and the workflow wiring; (6) the runbook and charter rows. Slices 1–4 are CI-verifiable; 5–6 are gated by the maintainer's runbook walkthrough at smoke time.
