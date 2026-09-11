# Deploy-mode config seam (saas vs residency) — Discovery

**Issue:** [EnterpriseBT/portal-ai#579](https://github.com/EnterpriseBT/portal-ai/issues/579) · Feature · `full` · Child of epic [#569](https://github.com/EnterpriseBT/portal-ai/issues/569) — branches off `epic/enterprise-deployment`.

**Why this exists.** The whole enterprise model rests on **one codebase, two deployment shapes**: multi-tenant + central for SaaS, single-tenant + self-contained for a residency install in the customer's own cloud. This ticket adds the boot-time seam that selects between them and the guard rails that keep each shape internally consistent — the guardrail against the enterprise tier forking into a second product. Per the [In-Environment Deployment](https://claude.ai/code/artifact/0c5d2d08-d9c0-42a9-8974-b07a19a11bc9) design (confirmed decisions), residency is **self-contained and same-origin** — there is no control/data-plane split. This is the `DEPLOY_MODE` seam that makes "SaaS is just another deployment."

## The current shape

### Config & boot

| Piece | Location | Note |
|---|---|---|
| Env object | `apps/api/src/environment.ts:1` | Plain object literal, `process.env.*` with inline defaults. **No zod parse, no fail-fast required-var guard.** Dominant pattern: *absent key ⇒ feature degrades*. |
| Boot invariant precedent | `apps/api/src/index.ts:45-55` | `wideTableReconcilerService.reconcileAll()` → `process.exit(1)` on failure. The one existing boot-time hard check — the natural home for a cross-field mode guard. |
| App build | `apps/api/src/app.ts` | Built at module load (routers/adapters), **no mode awareness** — so a guard belongs in `index.ts start()`, not `app.ts`. |
| Env-doc parity | `apps/api/src/__tests__/env-example-parity.test.ts:86` | Every read var must appear in `.env.example` — a new `DEPLOY_MODE` must too. |
| Flag precedents | `environment.ts:79-81` (`TOOLPACK_DISABLE_*` `=== "true"`), `:42` (`STRIPE_AUTOMATIC_TAX !== "false"`), `NODE_ENV` branches in `utils/url-safety.util.ts:69,118` | No existing multi-value mode enum — `DEPLOY_MODE` would be the first. |

### Entitlement, identity, tenancy (the three axes the mode selects)

| Axis | Today (saas) | Residency target | Key files |
|---|---|---|---|
| **Entitlement** | `organizations.tier` written only by `StripeGrantSource` via the webhook | marketplace grant → same `tier` column, via the same `TierGrantSource` seam (#565) | `tier-grant.service.ts:69,83,127`; read path `tier.service.ts:72` (zero commerce dep) |
| **Identity** | central Auth0: `jwtCheck` hard-wired to `AUTH0_AUDIENCE`/`AUTH0_DOMAIN` | customer's own OIDC (issuer/audience from residency config) + bundled issuer fallback | `auth.middleware.ts:12`; subject→org resolution `metadata.middleware.ts:23-41` (IdP-agnostic) |
| **Tenancy** | multi-tenant: active org = membership max `last_login`; switcher; org-per-signup | single-tenant: "current org" collapses to the one seeded org | `application.service.ts:25,58,94,279`; **everything is already org-scoped — no global single-org constant** |

### Phone-home surface (what "no outbound to vendor infra" must cover)

Most is **already gated by absent-key degradation** — the seam mostly asserts it, rather than building it:

| Call | Gating today | Residency |
|---|---|---|
| Stripe (billing/webhook) | `stripe.service.ts:43` `isConfigured()` → 503 when key absent | off (marketplace is the entitlement channel) — **already silent** |
| GitHub site-rebuild dispatch (#311) | `rebuild-dispatch.service.ts:40` no-op when `GITHUB_DISPATCH_TOKEN` unset | off — **already gated** |
| AWS Secrets Manager / RDS rotation (#500) | `credentials.util.ts:76` only when `DB_MASTER_SECRET_ARN` set | off — **already gated** |
| Tavily `web_search`, Mapbox geocode | tool throws when key absent (`web-search.tool.ts:21`, `geocode.tool.ts:40`) | opt-in per confirmed egress decision — **already gated** |
| **Anthropic (agent)** | `ai.service.ts:9` `createAnthropic(...)` — **unconditional at module load** | core/unavoidable; the customer's egress call (via `ANTHROPIC_BASE_URL`, #567), **not ours** — but the unconditional client is the one real gap |
| Telemetry | none exists (no posthog/segment/sentry) | none by default (confirmed) |

## The design space

### Decision 1 — How `DEPLOY_MODE` is represented and where the guard runs

**A. Env enum + a `deploy-mode` module + a boot guard in `index.ts start()`.** `DEPLOY_MODE` (`saas` default) parsed in `environment.ts`; a small `deploy-mode.ts` exposes `deployMode`, `isResidency()`, `isSaas()`, and `assertDeployModeConsistency()`; the assert is called in `index.ts start()` before `app.listen`, `process.exit(1)` on a contradiction (mirroring the reconcile check).
**B. Zod-parsed config module** replacing the plain env object. Correct long-term, but a large refactor touching every env read — disproportionate here.
**C. Scattered `process.env.DEPLOY_MODE` reads** at each branch point, no central module. Cheapest, but no single source for the mode and no place for the guard.

| | A | B | C |
|---|---|---|---|
| Follows existing precedent | Yes (`index.ts` guard, flag parsing) | No (new pattern) | Partly |
| Single source of truth | Yes | Yes | No |
| Scope | Small | Large | Smallest |

**Lean: A.** A dedicated `deploy-mode.ts` accessor + a fail-fast boot guard, matching the `index.ts` precedent. It is server-enforced (not prompt/doc), consistent with the standing "safety/consistency gates get server enforcement" rule.

### Decision 2 — How much of residency #579 implements vs. delegates (the scope boundary)

**A. Seam + guardrails + config indirection only; residency behaviors delegated to their owning tickets.** #579 adds the mode, the guard, and a *config-selection indirection* at each of the three axes, with residency arms that are either trivial-and-safe (gate the central-infra dependencies off) or a clean handoff: marketplace entitlement source → #568, OIDC provisioning + bundled issuer → #577, single-org seeding → #566/#583.
**B. A + implement residency's trivial arms now** — in residency, don't mount the Stripe webhook / don't register the GitHub-dispatch, and make the Anthropic client lazy so an agent-less install never instantiates it.
**C. Full residency** — build the marketplace source, OIDC path, and single-org provisioning here. That is the whole epic, not one ticket.

| | A | B | C |
|---|---|---|---|
| Ships a runnable residency mode | No (selectable + guarded) | Partly (central deps off) | Yes |
| Stays in #579's lane vs siblings | Yes | Mostly | No (absorbs #566/#568/#577) |
| Default saas unchanged | Yes | Yes | Yes |

**Lean: B.** Seam + guardrails + config indirection, **and** the trivial residency arms that are unambiguously #579's (turn off the central-infra couplings: Stripe webhook mount, GitHub dispatch; make the one unconditional vendor client lazy). The non-trivial arms (marketplace source, OIDC provisioning, single-org seed) stay documented handoffs. This delivers the acceptance criterion — "residency makes no outbound call to *our* vendor infra" — without absorbing sibling tickets.

### Decision 3 — Identity: introduce the config indirection now, or fully defer to #577?

**A. Introduce the auth-config indirection now.** Replace `jwtCheck`'s hard-wired `AUTH0_*` with `resolveAuthConfig(deployMode)` → `{ issuer, audience }` (saas: Auth0 env; residency: generic `OIDC_ISSUER`/`OIDC_AUDIENCE`). The subject→org chain is already IdP-agnostic. Provisioning (JIT-on-first-token) + bundled issuer stay #577.
**B. Fully defer to #577** — leave `jwtCheck` on Auth0; #579 only documents the branch point.

**Lean: A (narrow).** The token-verification config indirection is small, is squarely "the seam," and is what makes `jwtCheck` mode-selectable — the deliverable's "customer-IdP identity path" *selection*. The heavy lifting (provisioning, bundled issuer) is explicitly #577. This keeps #579 the seam without a half-built identity feature.

### Decision 4 — Guard-rail policy on a contradictory config

**Fail fast (throw/`exit(1)` before `listen`)** vs. **warn and continue**. A residency install that still carries `STRIPE_SECRET_KEY`, or a saas deploy configured with a marketplace entitlement source, is a misconfiguration that must not silently run. **Lean: fail fast**, mirroring `index.ts`'s reconcile `process.exit(1)`. The specific contradictions to assert are enumerated in the spec.

## Tradeoff comparison

| | D1: module + boot guard | D2: seam + trivial arms (B) | D3: auth-config indirection | D4: fail-fast guard |
|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes |
| Default saas unchanged | Yes | Yes | Yes | Yes |
| Stays in #579's lane | Yes | Yes | Yes (narrow) | Yes |

## Recommendation

1. Add `DEPLOY_MODE` (`saas` default | `residency`) to `environment.ts` and `.env.example`; parse like the existing flags.
2. New `apps/api/src/config/deploy-mode.ts`: `deployMode`, `isSaas()`, `isResidency()`, and `assertDeployModeConsistency()` (the enumerated cross-field guards).
3. Call the guard in `index.ts start()` before `app.listen`, `process.exit(1)` on contradiction (mirroring the reconcile check).
4. Gate the **central-infra couplings** on `isSaas()`: mount `/api/webhooks/stripe` and register the GitHub-dispatch only in saas; residency neither exposes nor depends on them.
5. Make the **Anthropic client lazy** (construct on first use, not module load) so an agent-less residency install instantiates no outbound vendor client at boot.
6. Introduce `resolveAuthConfig(deployMode)` so `jwtCheck` reads Auth0 config in saas and generic OIDC config in residency (provisioning + bundled issuer deferred to #577).
7. Tests: default saas path unchanged; each contradictory combo fails the boot guard; residency selects the OIDC auth config and does not mount the Stripe webhook.

## Open questions

1. **Does residency need an entitlement *writer* at all in #579?** No marketplace source exists until #568, so residency `organizations.tier` stays at its seeded value. **Lean:** yes-but-empty — #579 ships the guard ("residency must not use the Stripe source") and leaves the writer to #568; a seeded default tier is acceptable interim.
2. **`OIDC_ISSUER`/`OIDC_AUDIENCE` naming** vs. reusing `AUTH0_*` generically. **Lean:** introduce provider-neutral `OIDC_*` vars for residency and keep `AUTH0_*` for saas — the guard asserts the right set is present for the mode.
3. **Should the web app (`apps/web`) learn the mode?** Login UI differs (Auth0 vs customer OIDC). **Lean:** out of scope for #579 (API seam first); the web-side mode surfaces with #577's identity work and #566's chart config.
4. **Single-org seeding ownership.** Residency seeds exactly one org at install. **Lean:** the *flag* (`isSingleTenant` = residency) lands here; the seeding action lands in #566 (Helm install job) / #583 (provisioning), consuming the flag.

## Enterprise-scale considerations

- **Concurrency & correctness** — the mode is read-only boot config; no races. N/A beyond that.
- **Accuracy & auditability** — the boot guard is the audit surface: a contradictory config fails loudly at start, not silently at runtime. Log the resolved mode once at boot.
- **Failure modes** — **fail-closed on inconsistent config** (Decision 4): a mode mismatch must stop the process, because a residency install silently phoning home is a compliance breach, not a degraded feature. This is the one place the codebase's usual "absent key ⇒ degrade" gives way to "wrong mode ⇒ refuse to boot."
- **Scale & unbounded growth** — N/A (per-install constant).
- **Multi-tenancy** — the crux: saas stays multi-tenant unchanged; residency is single-tenant by *collapse* (one seeded org), not by deleting the org machinery. No per-tenant isolation regression because the default path is untouched.
- **Contract stability** — `DEPLOY_MODE` + `deploy-mode.ts` is the seam every future residency feature (marketplace, OIDC, fleet upgrade) plugs into; shaping it now as a central accessor + guard means those tickets add a branch, not re-plumb call sites.
- **Data lifecycle** — N/A (no windows/retention introduced).

## What this doesn't decide

- **The marketplace entitlement source** (`AwsMarketplaceGrantSource`) — #568, plugging into the #565 seam. #579 only guards that residency doesn't use Stripe.
- **The full customer-OIDC identity feature** — JIT provisioning, bundled issuer, web-side login — #577. #579 only makes `jwtCheck`'s verification config mode-selectable.
- **The Helm chart / single-org install seed** — #566 (+ #583 provisioning). #579 ships the `isSingleTenant` flag they consume.
- **Portability seams** (`ANTHROPIC_BASE_URL`, S3 endpoint) — #567. Referenced, not built here.
- **`ANTHROPIC_BASE_URL` self-hosting and the egress/tool-scoping policy** — the security-review task (#582) and #567.

## Next step

`docs/DEPLOY_MODE_SEAM.spec.md` fixes the contract: the `deploy-mode.ts` surface, the exact list of cross-field guard assertions and their error messages, the `resolveAuthConfig` shape, and the saas-unchanged / residency-selects test matrix. `docs/DEPLOY_MODE_SEAM.plan.md` then slices it: (1) `DEPLOY_MODE` + `deploy-mode.ts` + boot guard + tests; (2) gate central-infra couplings (Stripe webhook, GitHub dispatch) on `isSaas()` + lazy Anthropic; (3) `resolveAuthConfig` indirection for `jwtCheck`. Each slice is a testable commit; default-saas regression tests gate every one.
