# Wire app-dev to Stripe sandbox + a Pro tier — Spec

**Issue:** [EnterpriseBT/portal-ai#239](https://github.com/EnterpriseBT/portal-ai/issues/239) · **Discovery:** `docs/STRIPE_SANDBOX_TIERS.discovery.md`

This spec pins the contract for turning the already-shipped Stripe billing stack **on in app-dev against a Stripe sandbox** and adding one purchasable tier (**Pro**). It fixes: the exact `TIER_CATALOG` rows (widened `standard` + new `pro`), the `STRIPE_WEBHOOK_SECRET` catalog entry, the two new `backend.yml` secret parameters/IAM grants/task bindings, the two `deploy-dev.yml` parameter overrides, and the operator runbook (Stripe sandbox provisioning + `vars set` + deploy + `tier apply`) that the smoke doc walks. **No application code changes** — `StripeService`, the billing/webhook routers, and convergence already exist; this ticket only feeds them secrets and a purchasable tier.

## Key decisions (flag for review)

1. **QA-generous grid, both tiers identical in policy.** app-dev is a QA sandbox; `pro` differs from `standard` only in being purchasable (`stripeLookupKey` non-null). Both get `metered` unlimited (`null`) and `expensive` finite (`1_000_000` units / `10_000`-per-min). (Discovery Decision 1 / Open Q1.)
2. **`expensive` stays finite even in QA** — `web_search`→Tavily is Portal-billed regardless of environment, so an unlimited expensive class is an uncapped vendor bill. (Discovery enterprise-scale.)
3. **`STRIPE_SECRET_KEY` is a writable `sk_test_…` sandbox key**, not the read-only `rk_` that `tier apply` alone would accept — the running app writes checkout sessions/customers/subscriptions off the same secret. (Discovery Decision 2.)
4. **Lookup key `pro_monthly`**; price amount lives only in the Stripe sandbox, never in the repo. (Discovery Decision 3 / Open Q3.)
5. **Secret→ARN→deploy bootstrap ordering is load-bearing** — a `ValueFrom` ARN that doesn't yet exist hard-fails ECS task startup. (Discovery Decision 4; enforced by the smoke runbook order.)
6. **Enterprise/Custom plan deferred to #241.**

## Scope

### In scope

1. **`TIER_CATALOG`** (`packages/core/src/registries/tier-catalog.ts`) — widen the `standard` row to the QA grid; add a `pro` row (`stripeLookupKey: "pro_monthly"`).
2. **Config catalog** (`packages/devops-cli/src/catalog.ts`) — add `secret("STRIPE_WEBHOOK_SECRET", "stripe-webhook-secret")`.
3. **`infra/cloudformation/backend.yml`** — two new `Parameters` (`SecretArnStripeSecretKey`, `SecretArnStripeWebhookSecret`), two `secretsmanager:GetSecretValue` IAM `!Ref`s, two task-def `Secrets` bindings (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`).
4. **`.github/workflows/deploy-dev.yml`** — two `--parameter-overrides` lines fed from GitHub secrets `DEV_SECRET_ARN_STRIPE_SECRET_KEY` / `DEV_SECRET_ARN_STRIPE_WEBHOOK_SECRET`.
5. **Docs sync** — `packages/devops-cli/COMMANDS.md` documents `STRIPE_WEBHOOK_SECRET`.
6. **Operator runbook** (executed live, captured in the smoke doc, not CI): create the Pro sandbox product/price (`lookup_key=pro_monthly`) + the sandbox webhook endpoint at `https://api-dev.portalsai.io/api/webhooks/stripe`; `portalops vars set` both secrets on env `dev`; set the two GitHub secrets; deploy; `portalops tier apply --env app-dev`.

### Out of scope

- **Enterprise / Custom plan** → #241. Any application-code change to `StripeService`/routers/convergence (already shipped). Live/prod Stripe + a prod env (#83). Renaming `standard` → `free`. New frontend pricing UI. Stripe Tax rollout (`STRIPE_AUTOMATIC_TAX` default unchanged). Production tier differentiation (every tier is QA-generous here).

## Surface

### 1. `TIER_CATALOG` rows — `packages/core/src/registries/tier-catalog.ts`

The `standard` entry (`tier-catalog.ts:58-75`) is edited in place; a `pro` entry is appended. Both conform to the existing `TierCatalogEntrySchema` (`:23-47`) — no schema change. Exact field values:

| field | `standard` (widened) | `pro` (new) |
|---|---|---|
| `slug` | `"standard"` | `"pro"` |
| `displayName` | `"Standard"` | `"Pro"` |
| `periodKind` | `"monthly"` | `"monthly"` |
| `periodAnchorDay` | `1` | `1` |
| `overage` | `"hard-deny"` | `"hard-deny"` |
| `freeUnitsPerPeriod` | `null` | `null` |
| `freeRatePerMin` | `null` | `null` |
| `meteredUnitsPerPeriod` | `null` | `null` |
| `meteredRatePerMin` | `null` | `null` |
| `expensiveUnitsPerPeriod` | `1_000_000` | `1_000_000` |
| `expensiveRatePerMin` | `10_000` | `10_000` |
| `perToolCaps` | `null` | `null` |
| `selectable` | `true` | `true` |
| `builtinToolpacks` | `[...BuiltinToolpackSlugSchema.options]` | `[...BuiltinToolpackSlugSchema.options]` |
| `customToolpacks` | `true` | `true` |
| `stripeLookupKey` | `null` | `"pro_monthly"` |

`TIER_CATALOG_BY_SLUG` (`:80-81`) picks the new row up automatically. Convergence resolves `pro_monthly` → the env-local sandbox price id and writes it to `tiers.stripePriceId` via `tier apply`; the webhook maps that price id → `pro` through `priceIndex()`.

### 2. Config catalog entry — `packages/devops-cli/src/catalog.ts`

Add to the Secrets Manager block (after the `STRIPE_SECRET_KEY` line, `catalog.ts:50`):

```ts
secret("STRIPE_WEBHOOK_SECRET", "stripe-webhook-secret"), // #239 webhook signature verification
```

No new fields on `CatalogEntry`; `pathFor` derives `portalai/dev/stripe-webhook-secret` for env `dev`.

### 3. CloudFormation — `infra/cloudformation/backend.yml`

Three additive edits, mirroring the eight existing secret ARNs verbatim:

- **`Parameters`** (after `SecretArnOauthStateSecret`, `:68-70`):
  ```yaml
  SecretArnStripeSecretKey:
    Type: String
    Description: Full ARN of portalai/{env}/stripe-secret-key secret
  SecretArnStripeWebhookSecret:
    Type: String
    Description: Full ARN of portalai/{env}/stripe-webhook-secret secret
  ```
- **IAM `Resource` list** (task-execution policy, after `:229`): `- !Ref SecretArnStripeSecretKey` and `- !Ref SecretArnStripeWebhookSecret`.
- **Task-def `Secrets` block** (after `:488`):
  ```yaml
  - Name: STRIPE_SECRET_KEY
    ValueFrom: !Ref SecretArnStripeSecretKey
  - Name: STRIPE_WEBHOOK_SECRET
    ValueFrom: !Ref SecretArnStripeWebhookSecret
  ```

### 4. Deploy workflow — `.github/workflows/deploy-dev.yml`

In the **"Deploy backend stack"** step's `--parameter-overrides` (after `:114`), two lines:

```yaml
SecretArnStripeSecretKey=${{ secrets.DEV_SECRET_ARN_STRIPE_SECRET_KEY }} \
SecretArnStripeWebhookSecret=${{ secrets.DEV_SECRET_ARN_STRIPE_WEBHOOK_SECRET }} \
```

The later "Update backend stack" step (`:294-304`) is unchanged — CloudFormation retains parameter values across the `BuildVersion`/`BuildSha`-only redeploy.

### 5. Docs — `packages/devops-cli/COMMANDS.md`

Under `vars` (the managed-key context) note `STRIPE_WEBHOOK_SECRET` (Secrets Manager, `stripe-webhook-secret`, webhook signature verification). Under `tier apply` (`:91`), clarify that on an env whose catalog carries a purchasable lookup key, `STRIPE_SECRET_KEY` must be a **writable** `sk_test_`/`sk_live_` key when the same env's running app performs checkout — the read-only `rk_` note applies to a `tier-apply`-only credential.

### 6. Operator runbook (live, smoke-captured — not code)

Fixed order (Decision 5): **(a)** create the Pro sandbox product + recurring price with `lookup_key=pro_monthly`; **(b)** create the sandbox webhook endpoint → `https://api-dev.portalsai.io/api/webhooks/stripe` selecting ⊇ `customer.subscription.{created,updated,deleted}`, capture `whsec_…`; **(c)** `portalops vars set STRIPE_SECRET_KEY sk_test_… --env app-dev --yes` and `… STRIPE_WEBHOOK_SECRET whsec_… --env app-dev --yes` (creates the secrets, prints ARNs); **(d)** set GitHub secrets `DEV_SECRET_ARN_STRIPE_SECRET_KEY` / `DEV_SECRET_ARN_STRIPE_WEBHOOK_SECRET` to those ARNs; **(e)** merge + deploy; **(f)** `portalops tier apply --env app-dev --dry-run` then `--yes`.

## Migration / Seed

**No DB schema change** — no migration. **Seed:** `SeedService.seedTiers` (`apps/api/src/services/seed.service.ts:329-350`) is bootstrap-only and reads `standard` from `TIER_CATALOG_BY_SLUG`, so a fresh DB seeds the widened `standard` automatically; it never inserts `pro` (not the default) and never re-writes an existing `standard`. The **existing app-dev DB** converges both rows via `portalops tier apply` (upsert-by-slug: `standard` = update, `pro` = insert) — the runbook step, not seed.

## TDD test plan

Run per package via `npm run test:unit` (never raw jest — missing `NODE_OPTIONS` breaks ESM).

### `@portalai/core` — `packages/core/src/__tests__/registries/tier-catalog.test.ts`

- **Update** the "standard matches the seed snapshot verbatim" case (`:28-51`) to the widened values (`metered*: null`, `expensive*: 1_000_000 / 10_000`).
- **Add** a "pro is a selectable purchasable tier" case: `pro` parses, `stripeLookupKey === "pro_monthly"`, `selectable === true`, all packs + `customToolpacks: true`, `expensive` finite.
- Existing cases (schema-parse, unique slugs, by-slug mirror, frozen, field-mirror) already cover `pro` by iteration — assert they still pass. **≈ 2 changed/new cases.**

### `@portalai/devops-cli` — `packages/devops-cli/src/__tests__/catalog.test.ts`

- **Update** the "carries the exact managed keys" pin (`:8-21`) to include `STRIPE_WEBHOOK_SECRET`.
- **Add** a case: `lookupKey("STRIPE_WEBHOOK_SECRET")` resolves to `{ kind: "secret", name: "stripe-webhook-secret" }` and `pathFor(dev, entry)` = `portalai/dev/stripe-webhook-secret`. **≈ 2 changed/new cases.**

### Infra / CI

`backend.yml` and `deploy-dev.yml` are declarative YAML with no unit harness — verified by CloudFormation validation on deploy and by the smoke walkthrough (task starts, `isConfigured()` true). No test file. **State explicitly: no automated test for the infra/CI edits.**

**Totals ≈ 4 changed/new unit cases + the manual smoke runbook.**

## Acceptance criteria

- In app-dev, `StripeService.isConfigured()` is `true`; `POST /api/billing/checkout` returns a real Stripe Checkout session (not `503`) for Pro.
- A completed sandbox checkout drives `customer.subscription.created` → `/api/webhooks/stripe`, passes signature verification, and converges the purchasing org onto **`pro`**.
- `portalops tier apply --env app-dev --dry-run` shows `pro` as an add with a **resolved** sandbox price id and `standard` as an update; a real apply upserts both and `pro` surfaces as selectable.
- `tier apply` **fails closed** (`TierApplyMissingPricesError`, no DB write) when `pro_monthly` has no active sandbox price.
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` reach the ECS task via Secrets Manager → ECS injection only — absent from the image, repo, and CI logs.
- Non-purchasing orgs stay on `standard` (now QA-generous, still `stripeLookupKey: null`); non-Stripe behavior unchanged.

## Risks & rollback

- **Dangling `ValueFrom` ARN → ECS task won't start** (fail-closed, the one hard-fail). Detected: task never reaches steady state / health check fails on deploy. Mitigation: runbook ordering (secret created before ARN referenced). Rollback: revert the `backend.yml` `Secrets`/`Parameters` edit and redeploy; the app returns to `503`-by-design.
- **Missing/incorrect sandbox price → `tier apply` fails closed** (`TierApplyMissingPricesError`, no partial write). Detected: non-zero exit + error envelope on `--dry-run`. Rollback: none needed (no DB write occurred); create the price and re-run.
- **Wrong-scope key (`rk_` instead of `sk_test_`) → checkout write fails at runtime.** Detected: `POST /api/billing/checkout` errors despite `isConfigured()` true. Rollback: `vars set STRIPE_SECRET_KEY` to a writable key + restart task.
- **Secret leakage** — mitigated structurally: values only ever pass Secrets Manager → ECS; `vars set` reads are masked; nothing enters the repo/image/CI logs.

## Files touched

- `packages/core/src/registries/tier-catalog.ts` (edit — widen `standard`, add `pro`)
- `packages/core/src/__tests__/registries/tier-catalog.test.ts` (edit — snapshot + `pro` case)
- `packages/devops-cli/src/catalog.ts` (edit — `STRIPE_WEBHOOK_SECRET` entry)
- `packages/devops-cli/src/__tests__/catalog.test.ts` (edit — key pin + resolve case)
- `infra/cloudformation/backend.yml` (edit — 2 params, 2 IAM refs, 2 secrets bindings)
- `.github/workflows/deploy-dev.yml` (edit — 2 parameter-overrides)
- `packages/devops-cli/COMMANDS.md` (edit — `STRIPE_WEBHOOK_SECRET` + writable-key note)
- `docs/STRIPE_SANDBOX_TIERS.smoke.md` (new — the operator runbook + acceptance walkthrough)

## Next step

`docs/STRIPE_SANDBOX_TIERS.plan.md` carves this into ~4 code slices, each a green-testable commit on this branch: (1) `TIER_CATALOG` rows + registry test; (2) `catalog.ts` `STRIPE_WEBHOOK_SECRET` + catalog test; (3) `backend.yml` Stripe parameters/IAM/Secrets; (4) `deploy-dev.yml` overrides + `COMMANDS.md`. The live operator runbook (Stripe provisioning, `vars set`, GitHub secrets, deploy, `tier apply`) lands as the `/smoke` checklist — the merge gate — since it runs against real infra, not CI.
