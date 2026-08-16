# Production marketing site — Condensed design (#386)

**Issue:** [EnterpriseBT/portal-ai#386](https://github.com/EnterpriseBT/portal-ai/issues/386) · child of epic [#83](https://github.com/EnterpriseBT/portal-ai/issues/83) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The prod marketing-site pipeline already exists and is deliberately gated off: `deploy-site-prod.yml`'s `resolve` job exits with a notice while the `PROD_SITE_CONFIG_URL` repository variable is unset, so a fixture build can never reach the public site. This ticket is **provisioning and activation, not building** — except for one thing the survey turned up, which is a genuine conflict rather than a switch to flip.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Prod caller | `.github/workflows/deploy-site-prod.yml` | release / dispatch / manual; `subdomain: www`; `prod` GH Environment; gated on `vars.PROD_SITE_CONFIG_URL` |
| Reusable deploy | `.github/workflows/deploy-static-site.yml` | deploys the site stack, preflights, builds, refuses a fixture stamp, syncs, invalidates |
| **Prod-only cert step** | `deploy-static-site.yml:83-93` | **creates `portalai-prod-dns-certs`** — see the Decision |
| Cert resolution | `:97-100` | reads `${env}-CertificateArn` from `portalai-${env}-dns-certs` |
| Preflight | `apps/site/scripts/preflight-site-config.mjs` | fail-closed on unresolved contacts / empty tiers; `IS_PROD` tightens it |
| Contacts | `:131-140` | resolved from `/portalai/prod/{support,sales,admin}-email` at build time |
| Fixture guard | `:158-164` | greps the built HTML for the fixture stamp and refuses to publish |

Everything except the cert step is already prod-correct. The preflight, the contact prefix, and the fixture refusal were all written with prod in mind.

## Decision — prod does not get a second certificate stack

`deploy-static-site.yml:83-93` runs a **prod-only** step creating `portalai-prod-dns-certs`, a second ACM certificate for `portalsai.io` + `*.portalsai.io` in the same hosted zone. Its comment explains why it exists:

> *"Prod has no network/database/backend stack of its own yet, so it needs dns-certs deployed here."*

**That premise is now false.** #383 gave prod all of those stacks — and, more importantly, decided prod gets **no** certificate stack at all: the apex and the wildcard share one DNS validation CNAME, so a second stack for the same names collides in Route 53. `dns-certs.yml`'s own comment records that exact collision biting one level down, at `DomainValidationOptions`. #383's merged prod workflow therefore threads the **existing** wildcard ARN into every prod stack.

So as it stands the first prod site deploy would try to create a certificate #383 deliberately decided not to create, and app/api/www would disagree about which certificate fronts `portalsai.io`.

**Decision: delete the prod-only step and resolve the certificate from the stack that owns it.** The cert stack name becomes a workflow input (`cert-stack`, defaulting to `portalai-${environment}-dns-certs` so dev is unchanged); `deploy-site-prod.yml` passes `portalai-dev-dns-certs`. One certificate, one owner, consistent with #383.

*Not chosen:* giving prod its own cert stack and reversing #383 (re-introduces the collision this avoids), or moving the certificate to a domain-level stack as `portalai-dns-email` already is. The latter is still the correct end state — and this is now the **second** child that wants the cert, which strengthens the case — but it means migrating a live certificate between stacks, which is its own ticket, not a line item inside an activation.

A guard test pins the decision, because the step being removed was written before the decision existed and nothing would stop it coming back.

## Plan — 2 slices

**Slice 1 — the cert fix, behind a guard.**

- **Tests** (`packages/devops-cli/src/__tests__/deploy-parity.test.ts`, extend): no workflow creates a `portalai-prod-dns-certs` stack — asserted on the comment-stripped text, per the existing convention in that file; and `deploy-site-prod.yml` passes a `cert-stack` naming the dev-owned stack. Run; fail.
- **Files**: `deploy-static-site.yml` — drop `:83-93`, add the `cert-stack` input, use it at `:98`. `deploy-site-prod.yml` — pass `cert-stack: portalai-dev-dns-certs`. `deploy-site-dev.yml` — unchanged (rides the default).
- Green, then `npm run lint && npm run type-check`.

**Slice 2 — the activation runbook.**

- **No unit tests** — prose plus repository configuration.
- **Files**: `docs/PROD_DEPLOY.runbook.md` — a section covering the site: the ordered prerequisites (prod API answering `/api/public/site-config`, contacts set, `tier apply` run), setting the `PROD_SITE_CONFIG_URL` repository variable **last**, and the rebuild-dispatch loop.
- Record that `PROD_SITE_CONFIG_URL` is the switch: unset, the pipeline no-ops with a notice; set before the prod API is live, the preflight fails the deploy rather than publishing something wrong.

## Ordering (this ticket cannot go first)

```
#383 deploy-prod.yml  →  prod API answers /api/public/site-config
#384 vars set {SUPPORT,SALES,ADMIN}_EMAIL --env prod   (preflight fail-closes without them)
#385 products exist  →  #325 tier apply --env prod     (preflight fail-closes on empty tiers)
                     →  set PROD_SITE_CONFIG_URL       ← the switch
                     →  publish a release
```

The preflight is what makes this strict: it refuses to publish on unresolved contacts or empty tiers, and prod is deliberately not auto-seeded (#319). Setting the variable early doesn't accelerate anything — it converts a clean no-op into a failing deploy.

## Smoke (manual)

Rolls into the epic-level walk (#83) rather than gating this PR on its own, since none of it is exercisable until prod exists.

1. **Before the switch:** publish a release with `PROD_SITE_CONFIG_URL` unset → `deploy-site-prod` exits cleanly with the notice, publishes nothing.
2. `curl https://api.portalsai.io/api/public/site-config` returns 200 with the live tiers.
3. Set the variable, publish a release → `deploy-site-prod` runs green, the preflight passes, and **no fixture stamp** is in the built HTML.
4. `https://www.portalsai.io` serves over the wildcard cert; `/pricing/` shows live amounts; the footer and contact page show `support@` / `sales@` / `admin@portalsai.io` — **no `qa@` anywhere**.
5. Confirm **one** certificate: no `portalai-prod-dns-certs` stack exists, and app / api / www all present the same ACM cert.
6. Dev is unaffected — `site-dev` still deploys and still resolves its own cert stack.
7. `portalops vars set SUPPORT_EMAIL … --env prod` fires the `site-config-changed` dispatch and republishes with no code change.

## Out of scope

- **Building** the pipeline — #311/#319 shipped it; this activates it.
- Moving the certificate to a domain-level stack (see the Decision) — the right end state, its own ticket.
- The prod API (#383), the contact values (#384), the tier amounts (#325).
- Apex / bare-`portalsai.io` redirect — out of scope for the whole epic.
