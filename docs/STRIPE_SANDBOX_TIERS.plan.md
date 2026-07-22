# Wire app-dev to Stripe sandbox + a Pro tier — Plan

**TDD-sequenced implementation of the two catalog changes (widened `standard` + new `pro` tier row; the `STRIPE_WEBHOOK_SECRET` config-catalog entry) and the declarative infra/CI wiring (backend.yml secret parameters/IAM/task bindings, deploy-dev.yml parameter overrides) that delivers the Stripe sandbox secrets to app-dev.**

Spec: `docs/STRIPE_SANDBOX_TIERS.spec.md`. Discovery: `docs/STRIPE_SANDBOX_TIERS.discovery.md`. Issue: #239. Builds on the **already-shipped** Stripe stack (#176/#217/#218 — `StripeService`, billing/webhook routers, tier convergence, `portalops tier apply`) — all live on `main`; **no application code changes here**.

Three slices, each leaving the repo compilable + tests green at its boundary. They land as **commits on `feat/stripe-sandbox-tiers`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR"). The live operator runbook (create the sandbox product/price + webhook endpoint, `vars set`, set GitHub secrets, deploy, `tier apply`) is **not** a code slice — it lands as the `/smoke` checklist (the merge gate), since it runs against real infra.

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd packages/devops-cli && npm run test:unit
```

Each code slice: (1) write/adjust failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — data rows first (unit-testable in isolation), then the config/infra plumbing that carries no unit harness:

- **Slice 1** — the `TIER_CATALOG` rows (`standard` widened, `pro` added). Pure data + the registry-pin test; nothing else depends on it to compile.
- **Slice 2** — the `STRIPE_WEBHOOK_SECRET` catalog entry. Independent of slice 1; its own pin test.
- **Slice 3** — backend.yml + deploy-dev.yml + COMMANDS.md. Declarative config with no unit harness; the parameter names must match across the two files, so they land together. Verified by CloudFormation template validation + the smoke walkthrough.

No DB migration (no schema change); `seedTiers` picks up the widened `standard` from the catalog automatically on fresh DBs, and `tier apply` converges the existing app-dev DB (smoke runbook).

---

## Slice 1 — `TIER_CATALOG`: widen `standard`, add `pro`

Edit the existing `standard` row to the QA-generous grid and append a `pro` row (`stripeLookupKey: "pro_monthly"`). Pure data against the unchanged `TierCatalogEntrySchema`.

**Files**

- Edit: `packages/core/src/registries/tier-catalog.ts` — widen `standard` (`:58-75`) to `metered*: null`, `expensive*: 1_000_000 / 10_000`; append the `pro` entry per the spec's field table.
- Edit: `packages/core/src/__tests__/registries/tier-catalog.test.ts` — update the `standard` snapshot; add the `pro` case.

**Steps**

1. **Tests (spec test-plan §`@portalai/core`, ≈2 cases).** Update "standard matches the seed snapshot verbatim" (`:28-51`) to the widened values. Add "pro is a selectable purchasable tier": `pro` parses, `stripeLookupKey === "pro_monthly"`, `selectable === true`, all packs + `customToolpacks: true`, `expensiveUnitsPerPeriod === 1_000_000`. The existing schema-parse / unique-slug / by-slug-mirror / frozen / field-mirror cases now also exercise `pro` by iteration. Run; the standard-snapshot case fails.
2. **Implement** the two-row edit in `tier-catalog.ts`. Green.
3. Lint + type-check (`packages/core`).

**Done when:** all `tier-catalog.test.ts` cases pass; `TIER_CATALOG_BY_SLUG.get("pro")` is defined; nothing outside core references `pro` yet.

**Risk:** low — a `SeedService.seedTiers` unit/integration test (`apps/api`) may snapshot `standard`'s values; grep for it and update in this slice if present (see cross-slice notes).

---

## Slice 2 — config catalog: `STRIPE_WEBHOOK_SECRET`

Add the one Secrets Manager entry so `portalops vars set/get STRIPE_WEBHOOK_SECRET` resolves.

**Files**

- Edit: `packages/devops-cli/src/catalog.ts` — add `secret("STRIPE_WEBHOOK_SECRET", "stripe-webhook-secret")` after the `STRIPE_SECRET_KEY` line (`:50`).
- Edit: `packages/devops-cli/src/__tests__/catalog.test.ts` — extend the key-pin; add the resolve case.

**Steps**

1. **Tests (spec test-plan §`@portalai/devops-cli`, ≈2 cases).** Add `"STRIPE_WEBHOOK_SECRET"` to the "carries the exact managed keys" pin (`:8-21`). Add a case: `lookupKey("STRIPE_WEBHOOK_SECRET")` → `{ kind: "secret", name: "stripe-webhook-secret" }` and `pathFor(devDef, entry)` ends `portalai/dev/stripe-webhook-secret`. Run; the key-pin fails.
2. **Implement** the one `secret(...)` line. Green.
3. Lint + type-check (`packages/devops-cli`).

**Done when:** the catalog pin includes `STRIPE_WEBHOOK_SECRET` and the resolve/path case passes.

**Risk:** none — one-line data addition.

---

## Slice 3 — infra + CI + docs: deliver the secrets to ECS

Declarative wiring, mirroring the eight existing secret ARNs verbatim. No unit-test harness for CloudFormation/Actions YAML (spec §Infra/CI); verified by template validation here and by the smoke walkthrough live. `backend.yml` and `deploy-dev.yml` land together because the parameter names must match.

**Files**

- Edit: `infra/cloudformation/backend.yml` — 2 `Parameters` (`SecretArnStripeSecretKey`, `SecretArnStripeWebhookSecret`), 2 IAM `!Ref`s in the task-execution policy `Resource` list (`:229`), 2 task-def `Secrets` bindings (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `:488`).
- Edit: `.github/workflows/deploy-dev.yml` — 2 `--parameter-overrides` lines in the "Deploy backend stack" step (`:114`), fed from `DEV_SECRET_ARN_STRIPE_SECRET_KEY` / `DEV_SECRET_ARN_STRIPE_WEBHOOK_SECRET`.
- Edit: `packages/devops-cli/COMMANDS.md` — document `STRIPE_WEBHOOK_SECRET`; clarify the writable-`sk_` requirement when the env's app performs checkout (vs. `tier apply`'s read-only `rk_`).

**Steps**

1. **Validate the template** — `aws cloudformation validate-template --template-body file://infra/cloudformation/backend.yml` (parses YAML + parameter shape; no deploy). If AWS creds aren't available in-session, at minimum confirm the two new `SecretArn*` names are referenced in all three places they must appear (Parameters, IAM `Resource`, `Secrets`) and the override names match `deploy-dev.yml` — a name mismatch is the failure mode.
2. **Implement** the three edits; keep the 2 new entries adjacent to the existing block in each file for reviewability.
3. **Doc-sync check** (`CLAUDE.md` → "Keeping Documentation in Sync") — COMMANDS.md reflects the new managed key + the writable-key nuance.
4. Lint (`npm run lint` catches YAML/prettier drift on the workflow; `backend.yml` is infra, `COMMANDS.md` is markdown — deliberately unformatted).

**Done when:** `backend.yml` references both `SecretArn*` parameters in Parameters + IAM + Secrets; `deploy-dev.yml` passes both overrides; the parameter names are identical across the two files; COMMANDS.md documents the key. (Live confirmation — task starts, `isConfigured()` true — is the smoke gate.)

**Risk:** the bootstrap-ordering hazard (spec §Risks) — a `ValueFrom` ARN referencing a not-yet-created secret hard-fails ECS startup. This slice only writes the *template*; the actual secret creation + GitHub-secret population happens in the smoke runbook, in the correct order. Nothing here deploys.

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | `standard` widened + `pro` row in `TIER_CATALOG` | `packages/core` unit green (snapshot + `pro` case) |
| 2 | `STRIPE_WEBHOOK_SECRET` catalog entry | `packages/devops-cli` unit green (key-pin + resolve) |
| 3 | backend.yml + deploy-dev.yml + COMMANDS.md | template validates; param names match; lint clean |
| smoke | sandbox product/price + webhook endpoint, `vars set`, GitHub secrets, deploy, `tier apply` | walked live against app-dev (merge gate) |

## Cross-slice notes

- **Seed test drift (slice 1).** `SeedService.seedTiers` reads `standard` from the catalog; grep `apps/api` for a seed test that snapshots `standard`'s allocation numbers and update it in slice 1 if it exists — otherwise `apps/api` unit/integration goes red on a change confined to core.
- **Doc-sync (slice 3).** Per `CLAUDE.md` → "Keeping Documentation in Sync": the only user/dev-facing surface this touches is `COMMANDS.md` (new managed key + writable-key note). No glossary/FAQ/tool-description surface is affected (no new tool, no workflow-step change).
- **No forward deps.** Slices 1 and 2 are mutually independent; slice 3 depends on neither for compilation (it references secret *paths*, not the catalog module). Order is by testability, not dependency.
- **The smoke doc is where the contract is truly proven** — `isConfigured()` true, non-503 checkout, signature-verified `customer.subscription.created` → `pro` convergence, `tier apply --dry-run` resolved add. Those acceptance criteria can't be asserted in CI (they need the live sandbox + deployed task); `/smoke` maps each one to a manual step.

## Next step

After discovery + spec + plan are reviewed and confirmed, implementation starts on `feat/stripe-sandbox-tiers` — slice 1 first, tests-first, one commit per slice; then `/smoke 239` scaffolds the operator runbook that gates the merge.
