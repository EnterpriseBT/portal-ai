# Demo tier + prod provisioning — Condensed design (#511)

**Issue:** [EnterpriseBT/portal-ai#511](https://github.com/EnterpriseBT/portal-ai/issues/511) · Feature (epic child of #507) · **small / condensed**. Branch `feat/demo-tier-provisioning`, base `epic/demo-org`.

**Why.** The demo org must run **free with unlimited entitlements** in every env, and the dataset/script rehearsable in local + app-dev exactly as in prod. `portalops tier create` (#241) already produces that posture (all allocations `null`, all built-in + custom toolpacks, `cta contact`, `overage hard-deny`, no Stripe price) as a **custom tier outside the catalog** so `tier apply` never converges it away. This child adds a **`demo` tier to local** (code, since local resets constantly), documents creating it in **app-dev + prod** (ops), and owns the **prod org provisioning runbook** for admin@portalsai.io. Touches `packages/devops-cli` + docs only; no contract change.

## Current shape

| Piece | Location | Note |
|---|---|---|
| `local provision` step sequence | `packages/devops-cli/src/commands/local.ts:63` (`run(name, fn)` + `&&` chain) | Steps: migrate → seed → tier-apply → e2e-org. `tier-apply` calls `tier.js` in-process — a new `demo-tier` step is the same seam. |
| `tier create` service | `packages/devops-cli/src/commands/tier.ts:466` (`tierCreate`), `buildTierCreateValues` `:395` | Default posture already: allocations `null`, all toolpacks, `cta contact`, `overage hard-deny`, `stripePriceId null`, **`public=false`**, `visibleToOrganizationId = input ?? null`. Throws `TierAlreadyExistsError` (exit 9) if the slug exists. |
| Tier visibility | `apps/api/src/db/schema/tiers.table.ts:72,81,113` | `is_public` (default false) + `visible_to_organization_id` (nullable FK); `tiers_public_org_check`: public ⇒ not org-scoped. |
| Site-config exclusion | `tiers.repository.ts:74` `findPublic` = `public=true AND visibleToOrganizationId IS NULL`; `site-config.service.ts:59` | Anything not both-public-and-unscoped is already excluded from `GET /api/public/site-config`. |
| `set-tier` guard + Stripe refusal | `packages/admin-cli/src/commands/org.ts` (#259 refuses under a live `stripe_subscription_id`) | The prod runbook's Stripe-cancel step exists because of this. |

## Decision — the `demo` tier is unscoped but **not** public

The ticket says "public — every local org may pick it," and (acceptance) it must **not** appear on `site-config`. These reconcile only if "public" means *unscoped*, not *marketing-listed*. The tier is created **`public=false, visibleToOrganizationId=null`** — exactly what `tierCreate` produces with no `--visible-to-org`. That keeps it **off `site-config`** (findPublic requires `public=true`) while leaving **any org `set-tier`-able onto it** (set-tier is an operator command, unaffected by `is_public`). App-dev/prod additionally pass `--visible-to-org <orgId>` (org-scoped → also excluded from site-config, and only that org's) per the ops runbook.

## Decision — local is code, app-dev/prod are ops

- **Local:** a new idempotent `demo-tier` step in `local provision` calls `tierCreate(def, { slug:"demo", displayName:"Demo", cta:"contact", description })` and swallows `TierAlreadyExistsError` → `{action:"exists"}`. Runs after `tier-apply`; a second `local provision` is a no-op.
- **App-dev / prod:** `portalops tier create --env <env> --slug demo --display-name "Demo" --visible-to-org <demo orgId> [--description …] --yes [--confirm-prod]` — one-time, documented in the runbook (can't run from here; no live AWS).

## Plan — 2 slices

1. **`local provision` demo-tier step** (`local.ts`): add `"demo-tier"` to `ProvisionStepName`, an exported `ensureDemoTier(def, opts)` wrapper (calls `tierCreate`, catches `TierAlreadyExistsError`), a `demoTier?` dep for injection, and the step in the `&&` chain after `tier-apply`. **Tests** (`src/__tests__/`): the step runs `tierCreate` with the demo posture and reports `insert`; a second run (error thrown) reports `exists` (no-op), not `failed`; `--env` non-local still rejects.
2. **Runbook + docs**: `docs/DEMO_ORG.runbook.md` gains a **Provisioning** section (first login → Stripe cancel-check → `set-tier demo` → OAuth Google Sheets connect → `demo seed`, per env, with the app-dev/prod `tier create` commands); `docs/TIER_PRICING_MODEL.md` + `packages/devops-cli/COMMANDS.md` note `demo` as a standing custom tier; `docs/LOCAL_DEVELOPMENT.md` notes it exists locally; `docs/CLI_OPERATIONS_CHARTER.md` adds/extends a demo-org-provisioning row.

## Smoke (manual + ops)

1. `npm run --workspace @portalai/devops-cli test:unit` — the demo-tier step tests pass. (**Agent-runnable.**)
2. **Local (human):** `portalops local provision --env local --yes` on a fresh reset → a `demo` tier row (unlimited, all toolpacks, `cta contact`, no price, `is_public=false`, unscoped); a second run reports `demo-tier: exists`; `portalai org set-tier <localOrg> demo --env local` succeeds; `GET /api/public/site-config` locally does **not** list `demo`; `portalops tier apply --env local --dry-run` shows `demo` under `unmanaged`.
3. **App-dev / prod (human, ops):** create the org-scoped `demo` tier; walk the prod runbook end to end (first login → Stripe check → `set-tier demo` → Google Sheets connect → `demo seed --confirm-prod`); confirm Settings shows the "Demo" card (unlimited, no checkout CTA), `stripe_subscription_id` null, Google Sheets `active`, and `demo` absent from `site-config` on both.

## Out of scope

- Adding `demo` to the declarative tier catalog — deliberately a custom tier (#241), not a sellable plan.
- Comping arbitrary customer orgs; populating the org (#509), data (#508), toolpack hosting (#510).
- Executing the app-dev/prod `tier create` + the prod walk from here — ops (no live AWS in this environment).
