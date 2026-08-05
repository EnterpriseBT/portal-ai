# Fresh-environment site-config provisioning — Discovery

**Issue:** [EnterpriseBT/portal-ai#319](https://github.com/EnterpriseBT/portal-ai/issues/319)

**Why this exists.** The public marketing site (`apps/site`) is a build-time snapshot of `GET /api/public/site-config` — prices and contact addresses are baked into the HTML at deploy time (#311). That endpoint fails **closed** when its inputs are missing, which is correct (an empty `mailto:` or a zero-tier pricing page is worse than not publishing). But nothing *provisions* those inputs when a new environment is stood up, so the first site deploy of a fresh environment fails with no automated path to green. This is the discovery for the seam that makes a new environment's site-config exist before its site deploys.

**A correction to the ticket up front.** The issue frames two co-equal hard blockers. The survey shows they are **not symmetric**, and one is milder than filed — see *Decision 3* and *Open questions Q1*. The contact gap is a universal hard blocker; the "no public tiers" hard block was largely an app-dev **stale-data artifact**, because a truly fresh DB *is* seeded one public tier.

## The current shape

### Contact config (Gap A — the real universal blocker)

| Piece | Location | Behavior |
|---|---|---|
| SSM resolve | `apps/api/src/services/business-config.service.ts:62` | Reads `${prefix}/support-email`, `${prefix}/sales-email`; TTL-cached 5 min; **fail-soft** per-key to `environment.SUPPORT_EMAIL`/`SALES_EMAIL` (`:69-103`) — never throws. |
| SSM prefix | `infra/cloudformation/backend.yml:514` | `/portalai/${Environment}`. TaskRole has `ssm:GetParameters` on `parameter/portalai/${Environment}/*` (`backend.yml:260-262`, `:306-314`) — **read only**. |
| The 503 | `apps/api/src/services/site-config.service.ts:69-83` | After `getContact()`, filters `supportEmail`/`salesEmail` for empty/whitespace → throws `ApiError(503, SITE_CONFIG_CONTACT_UNRESOLVED)`. Fresh env: SSM absent **and** env unset → `""` → 503. Message names the remediation (`portalops vars set`). |

### Public-tier query (Gap B — milder than filed)

| Piece | Location | Behavior |
|---|---|---|
| Route | `apps/api/src/routes/public-site.router.ts:89` | Anonymous, per-IP rate-limited, mounted ahead of `jwtCheck`. |
| Service | `apps/api/src/services/site-config.service.ts:53` | Parallel `tiers.findPublic()` + `getContact()` (`:60-63`); price per row via `StripeService.getPrice` (`:85-103`): `stripePriceId===null` → `price:null` (contact card); set-but-unresolvable → `503 SITE_CONFIG_PRICE_UNRESOLVED`. |
| Query | `apps/api/src/db/repositories/tiers.repository.ts:74` | `findPublic` = `public=true AND visibleToOrganizationId IS NULL AND notDeleted`, by `displayOrder`. **No public row → `[]` → 200** (the silent case). |

### Tier seeding vs. catalog convergence

| Piece | Location | Behavior |
|---|---|---|
| Seed | `apps/api/src/services/seed.service.ts:329` (`seedTiers`) | Bootstrap-**INSERTs only `standard`** when absent, `stripePriceId:null`; never updates existing rows. |
| Catalog | `packages/core/src/registries/tier-catalog.ts:71` | Four tiers, all `public:true`: `standard` (free, no key), `plus`/`pro` (`stripeLookupKey` set → need a Stripe price), `enterprise` (contact, no price). |
| Convergence | `packages/devops-cli/src/commands/tier.ts:306` (`tier apply`) | Resolves lookup keys read-only (**fail-closed** if missing, `:319-327`); diffs `TIER_CATALOG` vs live rows (`computeTierChanges` `:132`); upserts `public`/`displayOrder`/price in one txn; audits; fires `fireSiteRebuild` (`:358`). |

**Consequence:** a *truly fresh* DB → `seedTiers` inserts `standard` (`public:true`) → `findPublic` returns `[standard]` → pricing renders one Free card → `verify-pages` passes. Paid tiers (`plus`/`pro`/`enterprise`) never appear until `tier apply` runs — which is itself gated on the env's Stripe having `plus_monthly`/`pro_monthly`. app-dev returned `tiers:[]` because its pre-existing rows were all `public:false` (stale), which `seedTiers`' insert-if-absent will not correct.

### Provisioning & deploy today

| Piece | Location | Behavior |
|---|---|---|
| Env bootstrap | `.github/workflows/deploy-dev.yml:274,295` | Deploys stacks, then one-off ECS `db:migrate:ci` + `db:seed:ci`. **No step writes SSM contact params or runs `tier apply`.** |
| `vars set` | `packages/devops-cli/src/commands/vars.ts:170` | Guarded (`--yes`), audited, and for `siteConfig`-marked keys (`catalog.ts:73-74`) fires `fireSiteRebuild` after the write. |
| Site build | `.github/workflows/deploy-static-site.yml:106-112` | Always sets `SITE_CONFIG_URL`; a 503/parse failure fails the build. Fixture-stamp guard `:116-122`. |
| Ordering | `deploy-dev.yml` + `deploy-site-dev.yml` | **Both fire on push-to-main with no ordering** — the site build can hit a not-yet-redeployed API (the `401` we saw). |
| Self-check | `apps/site/scripts/verify-pages.mjs:216-230` | Counts `.card` on `/pricing/`; fails "no tier cards rendered" on `tiers:[]`; dead-`mailto:` check `:155-159`. |

## The design space

### Decision 1 — How contact config is provisioned on a fresh env

| | A. CFN `AWS::SSM::Parameter` default | B. Bootstrap create-if-absent (deploy step) | C. Fail-soft default in code | D. Preflight-only, no seeding |
|---|---|---|---|---|
| Mechanism | Declare the two params in `backend.yml` with a placeholder | A deploy step (deploy creds) writes the params only if absent, never overwriting operator values | `site-config.service` falls back to a hardcoded default instead of 503 | Leave unset; a deploy preflight emits the exact `vars set` command |
| Drift | **CFN reverts operator `vars set` on next deploy** ✗ | None (mirrors `seedTiers` insert-if-absent) | None | None |
| Prod safety | Placeholder could go live | Placeholder could go live unless prod is excluded | Wrong address ships silently — undermines #311's deliberate fail-closed | Stays fail-closed; forces a conscious set |
| Code/infra cost | Infra only | A step + `ssm:PutParameter` for the deploy role | Small code | Workflow only |

**Lean: B for non-prod, D for prod.** A create-if-absent bootstrap (using the deploy role's creds, not the app TaskRole) gives dev/staging a green-by-default deploy without CFN drift; prod stays fail-closed with an actionable preflight so no placeholder support address is ever published. Reject A (drift against `portalops`) and C (silently shipping a wrong address is exactly what the 503 exists to prevent).

### Decision 2 — How paid tiers reach a fresh env

| | A. Bootstrap runs `tier apply` | B. Extend `seedTiers` to insert all four | C. Operator-run + documented runbook |
|---|---|---|---|
| Prices | Correct (`tier apply` sees the env's Stripe) | **Seed cannot see Stripe** (by design) → `plus`/`pro` seeded `null` → render as *contact*, not `$19` ✗ | Correct |
| Coupling | Env bootstrap now depends on Stripe prices existing first (ordering) | None, but wrong | Bootstrap stays simple |
| Fresh-env deploy | Green with full pricing | Green but mispriced | Green with **Standard-only** until operator runs it |

**Lean: A, ordered after Stripe price provisioning — with C as the honest interim.** `tier apply` is the only component that resolves per-env Stripe prices, so full pricing genuinely belongs to it. Because it fail-closes on missing lookup keys, the env's Stripe prices (`plus_monthly`, `pro_monthly`) must exist first — so this is a *sequenced* bootstrap step, not a drop-in. Until that sequencing is built, a fresh env deploys Standard-only, which is acceptable (not broken) and just needs the runbook + preflight from Decision 3.

### Decision 3 — Turn opaque deploy failures into actionable ones (+ ordering)

Regardless of seeding, `deploy-static-site.yml` should **preflight the endpoint** before building: on `SITE_CONFIG_CONTACT_UNRESOLVED` emit the exact `portalops vars set` commands for this env; on an empty/degraded `tiers` array emit the `portalops tier apply` command. And the **site deploy should not race the API deploy** — gate `deploy-site-dev` on `deploy-dev` completion (or tolerate-and-retry a not-yet-deployed endpoint), which removes the `401` failure mode entirely.

**Lean: do this regardless.** It is cheap, strictly improves operability, and is the whole fix for prod (Decision 1-D) and the interim for tiers (Decision 2-C).

## Tradeoff comparison

|  | 1B/1D contacts | 2A tiers (sequenced) | 3 preflight + ordering |
|---|---|---|---|
| Removes the universal blocker | **Yes** | No (milder) | Softens both |
| New infra/permission | `ssm:PutParameter` for deploy role | Stripe-price sequencing | None |
| Safe for prod launch | Yes (stays fail-closed) | Yes | Yes |
| Spread to spec | Yes | Partly (may split) | Yes |

## Recommendation

1. Add a **create-if-absent contact-config provisioning step** to the environment bootstrap (deploy workflow, deploy-role creds), seeding `${prefix}/support-email` and `${prefix}/sales-email` with a documented placeholder on **non-prod only**; never overwrite an operator value. Mirrors `seedTiers`' insert-if-absent idempotency.
2. Keep `site-config.service` **fail-closed** for truly-empty contacts (do not add a code default); prod relies on this plus the preflight.
3. Add an **endpoint preflight** to `deploy-static-site.yml` that, on `SITE_CONFIG_CONTACT_UNRESOLVED` or an empty `tiers` array, prints the exact `portalops vars set` / `tier apply` commands for the environment instead of a raw thrown fetch / generic self-check failure.
4. **Order the site deploy after the API deploy** on push-to-main (or make the preflight tolerate-and-retry) to eliminate the `401` race.
5. Treat **full paid-tier provisioning via `tier apply`** as a sequenced bootstrap step gated on the env's Stripe prices; until built, document the two-command runbook and let a fresh env deploy Standard-only.
6. **Reconcile issue #319's body** to reflect that Gap B is a stale-data / paid-tier-completeness issue, not a hard fresh-env deploy blocker.

## Open questions

1. **Is Gap B a real fresh-env blocker or an app-dev artifact?** Survey says `seedTiers` gives a fresh DB one public tier, so `verify-pages` passes. **Lean: artifact** — reframe the ticket to "paid tiers absent until `tier apply`" + "app-dev had stale `public:false` rows", and keep the hard-block framing only for the stale-data case.
2. **Does the deploy IAM role have `ssm:PutParameter`?** The app TaskRole is read-only (`backend.yml:260-262`); the deploy `aws-role-arn` scope is unconfirmed. **Lean: grant `ssm:PutParameter` on `parameter/portalai/${Environment}/*` to the deploy role** (not the app role) so provisioning uses deploy-time creds.
3. **Placeholder vs required-input for non-prod contacts?** A placeholder (`support@portalsai.io`) unblocks the deploy but is a real-looking address. **Lean: placeholder on non-prod, and make it visibly a placeholder** (e.g. the operator email) so it is obviously not customer-facing.
4. **Sequencing tier apply behind Stripe prices** — does a fresh env's Stripe already have `plus_monthly`/`pro_monthly`, or is price creation itself a separate provisioning gap (#83 business-verification is live-only)? **Lean: out of scope here; name it as the dependency that makes Decision 2-A a sequenced step, not a drop-in.**

## Enterprise-scale considerations

- **Concurrency & correctness** — provisioning is create-if-absent and idempotent; re-running the bootstrap is safe. `vars set`/`tier apply` are already single-txn + guarded. **Lean: idempotent create-if-absent, no overwrite.**
- **Accuracy & auditability** — `portalops` mutations already append to the audit log; a CFN/placeholder seed does not. **Lean: prefer the `vars`/`tier` code paths (audited) over raw `aws ssm put-parameter` where practical.**
- **Failure modes** — the design keeps **fail-closed for prod** (no wrong address ships) and **fail-soft-to-placeholder for non-prod** (green deploy). The preflight converts opaque failures to actionable ones. **Lean: split fail policy by env `kind`, matching the CLI guard convention.**
- **Multi-tenancy** — N/A: contact config and public tiers are per-*environment*, not per-org (`visibleToOrganizationId IS NULL`). Org-private tiers are already excluded from the public snapshot.
- **Contract stability** — the site-config contract is unchanged; this is provisioning around it. Prod's future real-contact requirement plugs in via the same `vars set` path. **Lean: no contract change.**
- **Data lifecycle** — placeholder contacts are a bootstrap default an operator overrides; no retention concern. **Lean: N/A.**

## What this doesn't decide

- **Creating the Stripe prices** for a new environment (`plus_monthly`/`pro_monthly`). That is the dependency Decision 2-A sequences behind, tracked separately (see #83 for business-verification constraints) — not solved here.
- **The full "provision a new environment" runbook/automation** beyond site-config (Auth0 tenant, DB, buckets). This ticket is scoped to the site-config inputs only.
- **Changing `verify-pages`' strictness** — 0 cards is genuinely broken and should stay a hard fail; we only improve the *message* via the preflight.

## Next step

`docs/SITE_CONFIG_PROVISIONING.spec.md` pins the contract: the bootstrap provisioning step (create-if-absent, non-prod, deploy-role creds), the deploy preflight's exact detection + messages, and the deploy-ordering change. `docs/SITE_CONFIG_PROVISIONING.plan.md` then slices it — likely (1) preflight + ordering (pure workflow, no new perms, immediately shippable), (2) contact create-if-absent bootstrap + the `ssm:PutParameter` grant, (3) the sequenced `tier apply` bootstrap once Stripe-price provisioning is settled. Slice 1 is the highest-value, lowest-risk commit and could stand alone.
