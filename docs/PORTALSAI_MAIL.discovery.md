# portalsai.io mail — Discovery

**Issue:** [EnterpriseBT/portal-ai#369](https://github.com/EnterpriseBT/portal-ai/issues/369) · branch `feat/portalsai-mail`

> **Design amended during this discovery.** Every business email in the app and site is now **derived from an environment variable**, with SSM remaining the single place a value is *written*; and addresses are **per-environment**, with `qa@portalsai.io` serving all three roles outside prod. Both are recorded on the ticket. The practical effect is that this ticket **removes** parallel paths rather than adding a fourth — see Decision 1.

**Why this exists.** The marketing site advertises `support@portalsai.io` and `sales@portalsai.io` on six pages — including as schema.org `contactPoint` structured data that search engines and AI summarizers ingest (`lib/jsonld.ts:16-29`) — and both would bounce. The zone has no MX, no SPF, no DKIM, no DMARC. Meanwhile the authenticated app never got wired to the contact config at all: it hardcodes `mailto:ben.turner@btdev.io` (`tier-format.util.ts:16`) and renders it to paying customers in two places, one of which prints the raw personal address as visible link text (`Help.view.tsx:233`). `docs/MARKETING_SITE.spec.md:48` recorded that drift as "noted, separate change" and it was never filed.

This is the ticket that makes the advertised addresses real, gives non-prod its own `qa@` inbox so no staging surface can leak a customer-facing one, and collapses four ways of knowing an email address down to one.

## The current shape

### Four sources of truth for one address

| Source | Where | Consumed by |
|---|---|---|
| SSM `/portalai/{env}/{support,sales}-email` | seeded create-if-absent at `deploy-dev.yml:336-337` | the API at runtime |
| `environment.SUPPORT_EMAIL` / `SALES_EMAIL` | `environment.ts:99-100`, `""` default | the API's per-key fallback |
| a hardcoded constant | `tier-format.util.ts:16` | **`apps/web`** — never wired to any of the above |
| the public site-config endpoint | `public-site.router.ts:89-134` | `apps/site` |

That fourth row is the bug: `#311` built the config path and `apps/web` was left behind, so a personal address on an unrelated domain grew beside it. Grepping `apps/web/src` for `site-config` / `PublicSiteConfig` returns **nothing** — there is no pathway to repoint, only a constant to correct.

### The runtime path being retired

`business-config.service.ts:38-39` declares leaf names that "MUST match the portalops catalog exactly"; `getContact()` (`:62-110`) reads both params in one `GetParametersCommand`, TTL-caches 5 minutes, falls back per key to `environment.*`, and never throws. Its header (`:1-17`) explains the design: env is baked at ECS task start, so reading SSM at runtime lets `portalops vars set` reach the endpoint without a task recycle.

`site-config.service.ts:69-82` fails closed — any empty contact field throws `503 SITE_CONFIG_CONTACT_UNRESOLVED` (`api-codes.constants.ts:71`). `site-config.contract.ts:62-66` is the wire contract:

```ts
export const PublicSiteContactSchema = z.strictObject({
  supportEmail: z.string().min(1),
  salesEmail: z.string().min(1),
});
```

`:53-61` records the incident behind `.min(1)`: an unset env var resolving to `""` shipped `<a href="mailto:"></a>` in production, found while smoke-walking #311. Pinned at `site-config.contract.test.ts:83-98`.

### The env-var grooves that already exist

Both consumers already read build-time env; nothing new has to be invented.

| App | Mechanism | Injected at |
|---|---|---|
| `apps/web` | `import.meta.env.VITE_*` (`api.util.ts:30`, `Application.provider.tsx:42-46`) | `deploy-dev.yml:163-168` — `VITE_AUTH0_*`, `VITE_API_BASE_URL`, … |
| `apps/site` | `process.env.*` at build (`site-context.ts:47-53`, `site-config.ts:61`) | `deploy-static-site.yml:126-132` — `SITE_URL`, `SITE_APP_URL`, `SITE_CONFIG_URL` |

### Infrastructure — eight templates, zero mail records

`dns-certs.yml:37-40` states the convention: "DNS records … live in their respective stacks so each stack owns its own record". The three `AWS::Route53::RecordSet`s (`frontend.yml:193-201`, `site.yml:237-244`, `backend.yml:603-609`) are all A/alias. A search for `MX|TXT|CAA|SPF|DKIM` across `infra/cloudformation/` returns **nothing** — mail records would be the first of their kind, and under that convention they have no existing owner. All stacks take `HostedZoneId: AWS::Route53::HostedZone::Id` and are named `portalai-{env}-{template}`.

### What pins the old literal

`TierCard.component.test.tsx:174`, `SubscriptionBilling.component.test.tsx:175`, and `HelpView.test.tsx:325-329` — the last asserting the address as the accessible link *name*, not just the href. (The issue cites `:236,238,240`; #365/#366 shifted those lines.) Docs: `SUBSCRIPTION_TIER_CARDS.smoke.md:61` **instructs a human to verify the btdev.io address on hover** — a checklist that passes only while the bug exists — and `SUBSCRIPTION_TIER_CARDS.spec.md:199`.

## The design space

### Decision 1 — One write path, three readers

**A. Env vars everywhere, SSM as the single store.** The pipeline reads SSM once per deploy and injects env into the API task, the web build, and the site build. `getContact`, the `contact` block on the public contract, the fail-closed check, and `SUPPORT_MAILTO` are all deleted.
**B. Keep the runtime path and additionally wire `apps/web` to it.** **C. Env vars, GitHub `vars` as the store** (no SSM for emails).

| | A — SSM → env at deploy | B — keep runtime fetch | C — GitHub vars |
|---|---|---|---|
| Sources of truth | **1** | 2 (SSM + whatever web reads) | 1 |
| Change without a deploy | no | yes | no |
| Code deleted | `getContact`, contract block, fail-closed check, fixture block, preflight lines | none — more added | also the catalog entries + seed |
| Operator interface | `portalops vars set` (charter-aligned) | same | **repo settings**, outside the CLI charter |
| Local dev story | `.env` seeded from `.env.example` | fixture + endpoint | nothing to read |

**Lean: A** (confirmed on the ticket). The bug was never the mechanism — it was that one consumer was never connected, so a second way of knowing the address appeared. Any option that leaves two mechanisms alive re-opens that. The cost is real and accepted: an address change becomes a deploy. That is the correct trade for a value that is static per environment; runtime mutability was justified by *pricing*, which changes on a business cadence, not by a support address.

### Decision 2 — What happens to the public `contact` block

With the site reading env at build time, nothing consumes `PublicSiteContactSchema` any more.

**A. Delete the `contact` block** from the contract, the service, the fixture, and the fail-closed list.
**B. Leave it in place** and let it go unread.

**Lean: A.** A contract field nobody reads is a maintenance liability that will be re-plumbed by someone who assumes it matters. Deleting it is a **breaking change to a public endpoint**, which deserves saying out loud — but the only consumer is `apps/site` in this repo, and it stops needing it in the same change. `SITE_CONFIG_CONTACT_UNRESOLVED` becomes unused and goes with it; the price fail-closed check is untouched.

### Decision 3 — How `qa@` is expressed

Non-prod resolves all three roles to `qa@portalsai.io`.

**A. Same three keys everywhere**, with all three set to `qa@` in the non-prod stores.
**B. One `CONTACT_EMAIL` key in non-prod** and three in prod.
**C. A code-level `isProd ? … : QA_EMAIL` branch.**

**Lean: A.** The consuming code stays identical in every environment — three keys, three readers, no branch — and the difference lives entirely in the values, which is where environment differences belong. C puts environment awareness into rendering code, which is how a staging address eventually ships to production. B makes the key set itself environment-dependent, so a config check can no longer be uniform.

### Decision 4 — Which `vars set` triggers a rebuild

`siteConfig: true` (`catalog.ts:26-28`) fires the site-rebuild dispatch on a successful `vars set`. Under Decision 1 that becomes **more** important, not less: a rebuild is now the only way a new value reaches the built site. But `apps/web` has no equivalent dispatch, so `vars set SUPPORT_EMAIL` would update the site and leave the app on the old address until its next deploy.

**A. Keep `siteConfig: true`, accept the app lags.** **B. Add a web-rebuild dispatch too.** **C. Drop the flag; both wait for deploy.**

**Lean: A, and name the asymmetry in the docs.** B is real work for a value that changes ~never, and C makes the site *worse* than today for no gain. The honest framing is that an email change is a deploy-completing operation: the site catches up on dispatch, the app on its next deploy. If that gap ever bites, B is the fix.

### Decision 5 — Sequencing the DKIM key

Google generates the DKIM public key only after domain verification, so the value cannot exist when the template is first authored.

**A. DKIM as a stack parameter** with an empty default and a CFN `Condition` creating the record only when non-empty. **B. Two templates / two deploys.** **C. Author it in the console.**

**Lean: A** (confirmed on the ticket). The condition is what keeps this a single one-pass template: the stack deploys before verification with MX/SPF/DMARC live and gains DKIM on the next deploy. C puts a record outside IaC, which is the thing being fixed.

### Decision 6 — Email validation on the way in

With the contract field gone, the remaining validation surface is whatever the apps read from env.

**Lean: validate at the edge that still exists** — the API's env parsing and the site's preflight — rather than dropping validation entirely with the contract. A malformed address is now baked into published HTML *and* JSON-LD with no runtime check to catch it, so the build-time gate matters more than before. `verify-pages.mjs:151-157` (the empty-`mailto:` gate) survives untouched and now catches an unset build env var, which is exactly the failure it was written for.

### Decision 7 — How far into prod

`deploy-site-prod.yml:65-75` early-exits whenever `vars.PROD_SITE_CONFIG_URL` is unset, and the prod API does not exist until #83.

**Lean: app-dev only for the app/site wiring**, with prod values recorded as a follow-up on #83. **The DNS records are the exception** — mail is a property of the domain, not of an environment, so `dns-email.yml` is deployed once and is not parameterized per environment. Worth stating in the template header so nobody adds an `Environment` discriminator to an MX record.

## Tradeoff comparison

|  | D1 env vars | D2 delete contract block | D3 same keys everywhere | D5 DKIM param | D7 dev-only |
|---|---|---|---|---|---|
| Breaking public change | no | **yes** | no | no | no |
| Net code deleted | **yes** | **yes** | neutral | neutral | neutral |
| Reversible | yes | yes (re-add additively) | yes | yes | yes |
| Spread to spec | yes | yes | yes | yes | yes |

## Recommendation

1. **One write path:** SSM `/portalai/{env}/{support,sales,admin}-email`, set via `portalops vars set`. Add `ADMIN_EMAIL` to the catalog with `siteConfig: true`; update both `catalog.test.ts` pins (`:26-37`, `:87-89`).
2. **Three readers, all env:** the API task (existing env), the web build (`VITE_SUPPORT_EMAIL` / `VITE_SALES_EMAIL`, alongside `VITE_*` at `deploy-dev.yml:163-168`), and the site build (`SUPPORT_EMAIL` / `SALES_EMAIL` / `ADMIN_EMAIL`, alongside `SITE_*` in `deploy-static-site.yml:126-132`). The workflow resolves them from SSM once.
3. **Delete the parallel paths:** `getContact()` and its cache, `PublicSiteContactSchema` and the `contact` block on the response, the fail-closed contact check, `SITE_CONFIG_CONTACT_UNRESOLVED`, the fixture's contact block, the preflight remediation lines, and `SUPPORT_MAILTO`.
4. **Per-environment values:** `qa@portalsai.io` for all three keys in local and app-dev; role-split in prod. Same key set everywhere.
5. **`apps/web`:** read the env vars; fix the **visible link text** at `Help.view.tsx:233`, the CTA at `TierCard.component.tsx:232`, and give `SubscriptionBilling.component.tsx:135` a `sales@` destination instead of "contact us" with no address.
6. **`apps/site`:** terms and privacy show `admin@` as the legal contact; footer and contact page read from env.
7. **`infra/cloudformation/dns-email.yml`:** MX (Google), SPF TXT, DMARC TXT with `rua=mailto:admin@portalsai.io`, DKIM CNAME behind a `Condition`. Wired into `deploy-infra`, deployed once for the domain.
8. **A runbook** the maintainer executes: Workspace tenant → paid seat for `admin@` → `support@`, `sales@`, **`qa@`** as free aliases → verification → DKIM key → re-deploy with the parameter → external SPF/DKIM/DMARC validation.
9. **Adjacent fixes:** all three keys in `apps/api/.env.example`, the stale `https://api.portalai.dev` in `apps/web/README.md:33`, and the two `SUBSCRIPTION_TIER_CARDS` docs — including the smoke step that currently instructs verifying the wrong address.
10. **CLI charter:** add the DNS/mailbox rows and recompute coverage (`:189-211`, today D=45 N=44 97.8%).

## Open questions

1. **Does the API still need the email values at all?** After Decision 2 nothing in the API renders or serves them. **Lean: keep them in `environment.ts` but stop wiring them anywhere** — actually, verify first: if no API surface reads them post-deletion, drop them from the API entirely and let the two front ends own their own env. That check is cheap and the answer changes the spec's file list.
2. **Does `qa@` need to exist before this can merge?** **Lean: no.** The code path is environment-agnostic; a non-prod value that doesn't yet route just bounces, exactly as today. The runbook's alias step is what makes it real, and that is smoke-gated.
3. **What does local development use?** **Lean: `qa@portalsai.io` in `.env.example`**, so a fresh clone renders a real (if non-monitored) address rather than an empty `mailto:` — and the `verify-pages` gate stays meaningful locally.
4. **Do the site's terms/privacy pages need `admin@` before the mailbox exists?** **Lean: yes, ship the address.** A legal contact page naming an address that is about to work is better than one naming nothing; the runbook closes the gap within the same change.
5. **Is deleting a public contract field acceptable without a deprecation window?** **Lean: yes here.** The endpoint's only consumer is this repo's own marketing site, which stops reading it in the same commit. Worth stating explicitly in the PR body rather than leaving a reader to infer it.
6. **Do DMARC reports go to `admin@` from day one?** **Lean: yes, with `p=none`.** Aggregate reports are noisy and the mailbox is new, but pointing `rua=` at something real from the start is what makes a later move to `p=quarantine` evidence-based.

## Enterprise-scale considerations

- **Concurrency & correctness** — N/A because the config path becomes a build-time read with no shared mutable state. The one ordering constraint (DKIM after verification) is handled by a CFN `Condition`, not by timing.
- **Accuracy & auditability** — **Lean: DNS as code is the audit trail.** Mail records in CloudFormation survive a re-deploy and show their history in git; console-authored records do not. The runbook is the audit record for the vendor half, which leaves no trace in the repo. DMARC `rua=` gives a durable channel for detecting spoofing.
- **Failure modes** — **Lean: fail closed at build, and keep the gate that already works.** With the runtime read gone, an unset value can no longer 503 — it would silently render an empty `mailto:`. `verify-pages.mjs:151-157` is exactly that gate and must stay; the site preflight is the second. This is a *shift* in where the failure is caught (build rather than request), and it must be a conscious one — it is the one place this design is weaker than what it replaces.
- **Scale & unbounded growth** — mostly N/A at four addresses on one seat. Two ceilings worth naming: aliases deliver to a single mailbox and do not fan out to a team, and DMARC aggregate reports accumulate in `admin@` with no retention policy in code.
- **Multi-tenancy** — **Lean: these are company addresses and must stay that way.** Every org sees the same support address; nothing here may become per-tenant. Stating it because the contact fields previously rode the same endpoint as pricing, which *is* tier-shaped — and after Decision 2 that coupling is gone, which is a side benefit.
- **Contract stability** — the ticket originally planned an *additive* field; the amended design instead **removes** one. Removal is the less common direction and deserves the explicit note in Decision 2. What remains stable is the write path: one catalog key per address, so a fourth contact fact follows the same groove rather than inventing one.
- **Data lifecycle** — mail retention is a Workspace policy set in the vendor console, not in code; out of scope here, but worth one line in the runbook so it is a decision rather than a default.

## What this doesn't decide

- **Transactional or application email.** No sender is introduced: no SES identity, no mail library, no templates, no bounce handling.
- Auth0's own verification/reset sender, which uses Auth0's shared default and is configured nowhere in the repo.
- `noreply@` — meaningless without a sender.
- Whether `apps/web` should get a rebuild dispatch on `vars set` (Decision 4's option B) — deferred until the lag actually bites.
- Moving the apex to serve web content, and the parked `portalai.io` / `portals.ai` domains.
- Moving the hosted zone into IaC; it stays console-created and passed in as a parameter.
- Prod wiring for the app and site (Decision 7) — blocked on #83.

## Next step

`docs/PORTALSAI_MAIL.spec.md` pins the contract: the exact `dns-email.yml` resources and parameters (MX priorities, SPF string, DMARC policy string, the DKIM `Condition`), the catalog entry and both test pins, the env-var names for each of the three consumers and where the workflow resolves them, the precise deletion list, and the exact `apps/web` copy changes. Then `.plan.md` slices it — roughly: (1) the catalog key + SSM/env plumbing; (2) the deletions (contract block, `getContact`, fail-closed check, fixture, preflight); (3) the site reading env; (4) the `apps/web` repoint plus the doc corrections; (5) the CFN template + workflow wiring; (6) the runbook and charter rows. Slices 1–4 are verifiable in CI; slice 5 is only fully verifiable once the maintainer has run the runbook, which is what the smoke walkthrough gates.
