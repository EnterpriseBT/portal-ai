# Enrich subscription tier cards with full policy details + Custom plan — Plan

**TDD-sequenced implementation of the enriched, org-scoped billing tier cards: the `cta`/`description`/`visibleToOrganizationId` row columns, the enriched org-scoped `GET /api/billing/tiers` contract, the portalops `tier create`/`update`/`description` commands, and the rebuilt policy-rich cards with a Contact-support path.**

Spec: `docs/SUBSCRIPTION_TIER_CARDS.spec.md`. Discovery: `docs/SUBSCRIPTION_TIER_CARDS.discovery.md`. Issue: #241. Builds on the shipped tier policy (#172), tier catalog + `tier apply` (#218), toolpack entitlements (#214), and Stripe billing (#176/#239).

Four slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/subscription-tier-cards`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit && npm run test:integration
cd packages/devops-cli && npm run test:unit
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale:

- **Slice 1** adds the three `tiers` columns + the org-scoped finder — purely additive DB/core work that touches **no** consumer of the billing contract, so the whole repo keeps compiling.
- **Slice 2** enriches `BillingTierSchema` and rewires `listBillingTiers`/route to the org-scoped, full-policy projection. Because this is the only slice that changes the contract, it also carries the one-line web bridge so `apps/web` still type-checks; slice 4 supersedes it.
- **Slice 3** teaches `tier apply` about `cta` and adds the portalops create/update/description commands. Depends only on slice 1's columns.
- **Slice 4** is the visible end — the rebuilt cards — depending on slice 2's contract.

---

## Slice 1 — `tiers` columns (`cta`/`description`/`visibleToOrganizationId`) + org-scoped finder

Additive foundation: the CTA enum, three new columns on the row + core model, one migration, and the isolation-safe `findSelectableForOrg`. Nothing that reads the billing contract changes, so the tree stays green.

**Files**

- Edit: `packages/core/src/models/tier.model.ts` — add `TierCtaSchema` (`z.enum(["subscribe","contact","none"])`, exported); add to `TierSchema` `cta: z.string()` **(flat text column — narrowed to the enum on the contract, mirroring `overage`/`periodKind`; see Cross-slice notes)**, `description: z.string().nullable()`, `visibleToOrganizationId: z.string().nullable()`.
- Edit: `apps/api/src/db/schema/tiers.table.ts` — `cta text NOT NULL DEFAULT 'none'`, `description text`, `visible_to_organization_id text REFERENCES organizations(id)`; `tiers_cta_check` + `tiers_cta_price_check`; import `organizations`.
- Edit: `apps/api/src/db/repositories/tiers.repository.ts` — add `findSelectableForOrg(organizationId, client?)` (`selectable = true AND deleted IS NULL AND (visible_to_organization_id IS NULL OR = :org)`); import `or`, `isNull`.
- New (migration): `<ts>_add_tier_cta_description_visibility` — `ALTER TABLE tiers ADD COLUMN` ×3 + the two `ADD CONSTRAINT` checks.
- Verify (no edit expected): `apps/api/src/db/schema/zod.ts` (`createSelectSchema`/`createInsertSchema` regenerate), `type-checks.ts` (existing `Tier`↔`TierSelect` pair now covers the new columns).
- New/updated tests: `packages/core/src/__tests__/models/tier.model.test.ts` (cases 1–2); `apps/api/src/__tests__/__integration__/db/repositories/tiers.repository.integration.test.ts` (cases 6–7); `apps/api/src/__tests__/__integration__/db/schema/tiers.constraints.integration.test.ts` (cases 8–9); migration probe (case 10 / type-check).

**Steps**

1. **Core tests (spec cases 1–2).** `TierCtaSchema` accepts the three values, rejects others; `TierSchema` round-trips with `cta`/`description: null`/`visibleToOrganizationId: null` and populated. Run; fail.
2. **Add `TierCtaSchema` + the three fields** to `tier.model.ts`. Green 1–2.
3. **DB tests (spec cases 6–9).** insert with each `cta` round-trips; `findSelectableForOrg` returns public rows (`visible_to_organization_id IS NULL`); **isolation** — a row scoped to org A is returned for A and excluded for B (case 7); `tiers_cta_check` rejects a bad `cta`; `tiers_cta_price_check` rejects `cta='subscribe'` + null price and accepts it with a price (case 8); the FK rejects a nonexistent org (case 9). Run; fail (no columns).
4. **Add the columns + CHECKs + FK** to `tiers.table.ts`; add `findSelectableForOrg` to the repo. Generate + apply the migration. Green 6–9.
5. **Verify dual-schema (spec case 10).** `npm run type-check` green (the existing `IsAssignable` pair covers the new columns — no new assertion). A deliberate scratch mismatch fails it.
6. **Lint + type-check.** Clean.

**Done when:** cases 1–2, 6–10 pass; the three columns + isolation-safe finder exist; no billing-contract consumer changed.

**Risk:** the cyclic FK (`tiers.visible_to_organization_id → organizations.id` vs `organizations.tier → tiers.slug`) blocks the migration. Mitigation — both sides nullable/defaulted; the `ADD COLUMN` is nullable so no ordering issue; the constraints test runs on a fresh DB.

---

## Slice 2 — enriched contract + org-scoped `listBillingTiers` + route + web bridge

The contract cut: embed the whole policy, add `cta`/`description`, drop `purchasable` + top-level `allocations`; project it org-scoped. The only slice that touches the contract, so it carries the minimal web compile-fix.

**Files**

- Edit: `packages/core/src/contracts/billing.contract.ts` — `BillingTierSchema` gains `policy: TierPolicySchema`, `description: z.string().nullable()`, `cta: TierCtaSchema`; drop `allocations` + `purchasable`; import `TierPolicySchema`, `TierCtaSchema`.
- Edit: `apps/api/src/services/billing.service.ts` — `listBillingTiers(organizationId)` uses `findSelectableForOrg`, projects `policy: TierService.tierPolicyFromRow(row)`, `description`, `cta: row.cta as BillingTier["cta"]`, `price`.
- Edit: `apps/api/src/routes/billing.router.ts` — pass `organization.id`; update the `@openapi` `description` (full policy + blurb + `cta`, org-scoped).
- Edit (bridge, superseded in slice 4): `apps/web/src/components/SubscriptionBilling.component.tsx` — replace the two `tier.purchasable` reads with `tier.cta === "subscribe"` so `apps/web` type-checks; no other web change here.
- Edit tests: `packages/core` billing contract test (cases 3–4); `apps/api` billing service integration (11–13) + billing route integration (14–15); adjust any `swagger` snapshot that pins `BillingTiersGetResponse`.

**Steps**

1. **Contract tests (spec cases 3–4).** `BillingTierSchema` parses a full enriched tier (embedded `policy`, `description`, `cta`, `price`); rejects a missing `policy`; accepts `description: null`/`price: null`; rejects an unknown `cta`. Run; fail.
2. **Enrich `BillingTierSchema`** (embed policy; drop `purchasable`/`allocations`). Green 3–4. `apps/api` + `apps/web` now fail type-check until steps 3–4 (same-slice close).
3. **Service + route tests (spec cases 11–15).** `listBillingTiers(orgId)` projects the full `policy` (all three allocation classes, both dimensions), `description`, `cta`; a custom tier scoped to the caller appears, one scoped to another org does not (12); `price` null for `contact`/`none`, fetched for `subscribe`, `getPrice → null` leaves `cta` intact (13); `GET /api/billing/tiers` returns the enriched org-scoped list (14) and is auth-guarded / 404-on-no-org (15). Run; fail.
4. **Rewire `listBillingTiers(orgId)` + the route + the web bridge.** Green 11–15. Adjust the swagger snapshot if present.
5. **Lint + type-check.** Clean — api + web compile against the new contract.

**Done when:** cases 3–4, 11–15 pass; the endpoint returns the enriched, org-scoped payload; `apps/web` compiles (old card, bridged).

**Risk:** a lingering consumer of `purchasable`/`allocations` breaks type-check. Mitigation — only the contract test, `billing.service`, and `SubscriptionBilling` read them; all touched here; `type-check` catches any straggler.

---

## Slice 3 — `cta` convergence + portalops `tier create`/`update`/`description`

Teach `tier apply` to converge `cta` (catalog `standard→none`/`pro→subscribe`) and add the three guarded, audited operator commands over the tier-row store. Depends only on slice 1's columns.

**Files**

- Edit: `packages/core/src/registries/tier-catalog.ts` — `cta: TierCtaSchema` on `TierCatalogEntrySchema`; `standard.cta = "none"`, `pro.cta = "subscribe"`.
- Edit: `packages/devops-cli/src/tables.ts` — mirror columns `cta`, `description`, `visible_to_organization_id`.
- Edit: `packages/devops-cli/src/commands/tier.ts` — add `cta` to `CONVERGED_POLICY_FIELDS`; add pure value-builders + store methods `createTier`/`updateTier`/`setDescription` (extend the `TierStore` seam + `createTierStore`/`openEnvTierStore`); command fns `tierCreate`/`tierUpdate`/`tierDescription` (guard via `guard()`, audit via `recordAudit`; conflict → exit 9, not-found → exit 8).
- Edit: `packages/devops-cli/src/bin.ts` — wire `tier create`/`tier update`/`tier description` subcommands under the existing `tier` command (`:226`).
- Edit: `packages/devops-cli/COMMANDS.md` — document the three commands + the custom-tier runbook (create → describe → `portalai org set-tier`).
- New/updated tests: `packages/core` catalog test (case 5); `packages/devops-cli` command tests with an injectable fake store (16–21).

**Steps**

1. **Catalog test (spec case 5).** `standard.cta === "none"`, `pro.cta === "subscribe"`; `TierCatalogEntrySchema` requires `cta`. Run; fail → add `cta` to the schema + entries → green.
2. **CLI tests (spec cases 16–21).** `tier create` builds correct insert values (defaults `cta=contact`, `selectable=true`, `overage=hard-deny`, omitted allocations → `null`), calls the store once, audits (16); create on an existing slug → exit 9, no write (17); `tier update` changes only passed fields, missing slug → exit 8 (18); `tier description --set`/`--clear` sets/nulls `description`, missing slug → exit 8 (19); an `app-dev` mutation without `--yes` → exit 5, `local` needs none (20); `CONVERGED_POLICY_FIELDS` includes `cta`, excludes `description`/`visibleToOrganizationId`, mirror-parity test green (21). Run; fail.
3. **Implement** the value-builders, store methods, command fns, and `bin.ts` wiring. Green 16–21.
4. **Update `COMMANDS.md`** (the three commands + runbook — doc-sync in the same PR).
5. **Lint + type-check.** Clean.

**Done when:** cases 5, 16–21 pass; `tier apply` converges `cta`; the three commands work against a fake store; `COMMANDS.md` documents them.

**Risk:** the mirror table / catalog / `CONVERGED_POLICY_FIELDS` drift and the parity test fails. Mitigation — case 21 pins the set; all three surfaces edited together in this slice.

---

## Slice 4 — rebuilt policy-rich cards + Contact-support path

The visible end: pure formatters, a pure `TierCardUI`, the `SubscriptionBilling` rebuild (replacing the slice-2 bridge), and the shared support mailto. Depends on slice 2's contract.

**Files**

- New: `apps/web/src/utils/tier-format.util.ts` — `formatAllocation`, `formatPeriod`, `formatOverage`, `formatPerToolCaps`, `entitlementPackNames` (via `BUILTIN_TOOLPACK_BY_SLUG`), `formatPrice` (moved here), `SUPPORT_MAILTO`.
- New: `apps/web/src/components/TierCard.component.tsx` — pure `TierCardUI` (props-only) per spec (grid gated on `cta !== "contact" || isCurrentPlan`; CTA per `cta` + `isCurrentPlan`).
- Edit: `apps/web/src/components/SubscriptionBilling.component.tsx` — `SubscriptionBillingUI` maps tiers → `<TierCardUI>` (`isCurrentPlan = tier.slug === organization.tier`); container derivation: subscribed → Manage; current tier in list → cards; else → `managed` banner (fallback preserved).
- Edit: `apps/web/src/views/Help.view.tsx` — use `SUPPORT_MAILTO` (extract the address to the one constant).
- New tests: `apps/web/src/__tests__/tier-format.util.test.ts` (case 22); `TierCard` tests (23–26); `SubscriptionBilling` tests (27–28).

**Steps**

1. **Formatter tests (spec case 22).** `formatAllocation` renders units + rate, `null` → "Unlimited"; `entitlementPackNames` maps slugs → display names, unknown slug falls through; `formatOverage`/`formatPeriod`/`formatPerToolCaps` cases. Run; fail → author `tier-format.util.ts` → green.
2. **`TierCardUI` tests (spec cases 23–26).** `subscribe` → grid + owner-gated Subscribe (non-owner disabled+tooltip); `contact` non-current → title + blurb + "Contact support", **no grid** (24); `contact` current → grid + "Contact support to manage/update your plan" (25); `none` current → "Current plan" chip, no CTA; `description: null` → no blurb (26). Run; fail → author `TierCard.component.tsx` → green.
3. **`SubscriptionBilling` tests (spec cases 27–28).** `SubscriptionBillingUI` maps a mixed list to cards, current flagged, unlimited → "Unlimited" (27); container shows Manage when subscribed and the `managed` fallback when the current tier is absent from the list (28). Run; fail.
4. **Rebuild `SubscriptionBilling`** (map to `TierCardUI`, new derivation) — replacing the slice-2 bridge; extract `SUPPORT_MAILTO` in `Help.view.tsx`. Green 27–28.
5. **Manual check.** `npm run dev`; Settings → Subscription & Billing shows full policy per public tier; a custom tier (created via slice-3 CLI, scoped to the dev org) shows blurb + "Contact support".
6. **Lint + type-check.** Clean.

**Done when:** cases 22–28 pass; the cards render the full policy + blurbs + the two Contact-support variants in the dev app.

**Risk:** the component-file policy (≤2 components/file, no inline helper components). Mitigation — `TierCardUI` is its own file (pure UI); formatters are plain functions in `tier-format.util.ts`, not components.

---

## Sequence summary

| Slice | What lands | Spec cases | Test commands |
|---|---|---|---|
| 1 | `tiers` columns (`cta`/`description`/`visibleToOrganizationId`) + `findSelectableForOrg` + migration | 1, 2, 6–10 | `packages/core` unit; `apps/api` integration |
| 2 | enriched `BillingTierSchema` + org-scoped `listBillingTiers` + route + web bridge | 3, 4, 11–15 | `packages/core` unit; `apps/api` integration |
| 3 | `cta` convergence + portalops `tier create`/`update`/`description` + `COMMANDS.md` | 5, 16–21 | `packages/core` unit; `packages/devops-cli` unit |
| 4 | `tier-format.util` + `TierCardUI` + `SubscriptionBilling` rebuild + support mailto | 22–28 | `apps/web` unit |

Total: **28 spec cases** across four slices. Each is one (or a few) commit(s) on `feat/subscription-tier-cards`; the PR grows commit-by-commit.

## Cross-slice notes

- **Spec correction (flagged for the user).** The spec writes `cta: TierCtaSchema` on the flat `TierSchema`; that fails the dual-schema `IsAssignable` guard (the `cta` column is `text` → `TierSelect.cta` is `string`, not the enum). This plan uses `cta: z.string()` on the flat row (exactly as `overage`/`periodKind` do) and keeps the `TierCtaSchema` enum on the **contract** (`BillingTierSchema.cta`) and the **catalog** (`TierCatalogEntrySchema.cta`, where enum/literal values are already the convention). One word in the spec's Surface; apply before implementing slice 1.
- **The web bridge.** Slice 2 replaces `tier.purchasable` with `tier.cta === "subscribe"` in the current `SubscriptionBilling` purely to keep `apps/web` compiling; slice 4 deletes that code in the rebuild. Intentional, superseded — not churn to avoid.
- **Migration.** One additive migration in slice 1 (three `ADD COLUMN` + two checks). No seed row added — the `cta` default backfills existing rows; `standard`/`pro` reach their real `cta` via `tier apply` (slice 3). `standard` seeded on a fresh DB carries `cta` once the catalog entry has it (slice 3); before that the column default (`none`) is correct for `standard`.
- **Isolation is SQL, not app code.** `findSelectableForOrg` filters in the query (slice 1); no slice ever fetches globally then filters. Case 7/12/14 assert the exclusion at three layers.
- **Swagger.** `BillingTiersGetResponse` regenerates from the Zod schema (`z.toJSONSchema`, `swagger.config.ts:221`) — no manual edit; adjust a snapshot only if one pins the shape (slice 2).
- **Doc-sync (per CLAUDE.md "Keeping Documentation in Sync").** `COMMANDS.md` updates in slice 3 (new commands). No glossary/faq term changes (no new user-facing concept). CLI-charter/`.claude` allowlist unchanged — the new commands are mutations (prompt-gated + `--yes`-guarded), never allowlisted.
- **No new dependency, env var, or infra** — confirm `git diff package*.json` is empty at the end.

## Next step

Once discovery + spec + plan are confirmed (and the one-word spec correction applied), implement **slice 1** first — tests-first, one commit per slice on `feat/subscription-tier-cards`.
