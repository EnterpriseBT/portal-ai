# Enrich subscription tier cards with full policy details + Custom plan — Spec

**Issue:** [EnterpriseBT/portal-ai#241](https://github.com/EnterpriseBT/portal-ai/issues/241) · **Discovery:** `docs/SUBSCRIPTION_TIER_CARDS.discovery.md`

This spec pins the contract for turning Settings → Subscription & Billing from a name-and-price stub into a **data-driven, org-scoped** plan-comparison surface: the billing tier contract carries the whole `TierPolicy` + an operator blurb + a single authoritative `cta`; `GET /api/billing/tiers` becomes org-scoped so **per-client custom tiers** (bespoke slug, visible to one org) surface only to that org; portalops gains `tier create`/`tier update`/`tier description`; and the cards render every policy dimension with human formatting.

## Key decisions (flag for review)

1. **`cta` is the single source of truth** (D1) — a `text` column `cta ∈ {subscribe, contact, none}` replaces the derived `purchasable` boolean in the contract. `stripePriceId` stays only as the checkout mechanism. Invariant `cta = 'subscribe' ⇒ stripePriceId IS NOT NULL` is enforced by `tier apply` (existing `TierApplyMissingPricesError`) + a DB CHECK.
2. **Per-client custom tiers via `visibleToOrganizationId`** (D2) — nullable FK on `tiers`; `null` = public. `listBillingTiers` becomes **org-scoped in the repository query** (multi-tenant isolation, not app-code filtering).
3. **`description` excluded from convergence** (D5) — nullable `text`, never in `CONVERGED_POLICY_FIELDS`, so `tier apply` never clobbers operator copy.
4. **Contract embeds the whole policy** (D4) — `BillingTierSchema` gains `policy: TierPolicySchema`, `description`, `cta`; today's top-level `allocations` folds into `policy.allocations` (clean cut, no alias).
5. **CLI split** (D3) — `tier create`/`tier update`/`tier description` are new **portalops** commands (tier-row business config); **switch = existing `portalai org set-tier`** (no new command). Create/update adopt the shared cli-env **not-found (8)/conflict (9)** exit codes.
6. **Custom-card rendering** (D6) — a `cta === "contact"` card shows **title + blurb + "Contact support"** as an upgrade teaser and **the full policy grid + "Contact support to manage/update your plan"** when it is the org's current plan; public tiers always show the grid.

## Scope

### In scope

1. **Core** — `TierCtaSchema` + `cta`/`description`/`visibleToOrganizationId` on `TierSchema`; `cta` on `TierCatalogEntrySchema` + catalog entries; enriched `BillingTierSchema`.
2. **DB** — three columns on `tiers` (`cta`, `description`, `visible_to_organization_id`) + CHECK + FK; drizzle-zod (auto); type-checks (auto, no new assertion); one migration.
3. **API** — org-scoped `TiersRepository.findSelectableForOrg`; `BillingService.listBillingTiers(orgId)` projecting the full policy + blurb + cta; route passes the caller org; `@openapi` copy update; `seedTiers` carries `cta`.
4. **devops-cli** — mirror-table + `CONVERGED_POLICY_FIELDS` gain `cta`; `tier create`/`tier update`/`tier description` commands + `bin.ts` wiring + store writes; `COMMANDS.md`.
5. **Web** — new pure `TierCardUI` (own file) + `tier-format.util.ts`; `SubscriptionBillingUI`/container rebuilt for the enriched payload, current-plan/managed re-derivation, and the Contact-support mailto.

### Out of scope

Public pre-login pricing page; defining Pro/Enterprise + Stripe wiring (#239); a support ticketing system; price amounts / where pricing lives (stays in Stripe); i18n of blurbs; custom tiers scoped to **multiple** orgs (join-table escape hatch deferred).

## Surface

### Core — `packages/core/src/models/tier.model.ts`

Add the CTA enum and three fields to the flat row schema:

```ts
/** Card call-to-action (#241) — the single source of truth for what a tier's
 *  card offers. `subscribe` ⇒ self-serve Stripe checkout (requires a price);
 *  `contact` ⇒ a "Contact support" path (custom/enterprise); `none` ⇒ the free
 *  default (no CTA). Replaces the derived `purchasable` on the billing contract. */
export const TierCtaSchema = z.enum(["subscribe", "contact", "none"]);
export type TierCta = z.infer<typeof TierCtaSchema>;

// added to TierSchema (the flat DB row) — `cta` is z.string() (text column,
// CHECK-constrained), narrowed to TierCtaSchema on the contract, exactly as
// `overage`/`periodKind` are z.string() on the row and enums elsewhere. Using
// the enum here would break the dual-schema IsAssignable guard (TierSelect.cta
// is `string`).
  cta: z.string(),
  description: z.string().nullable(),                   // operator blurb; excluded from convergence
  visibleToOrganizationId: z.string().nullable(),       // null = public; set = private to one org
```

`TierPolicySchema` is **unchanged** — it already carries every dimension the cards render.

### Core — `packages/core/src/contracts/billing.contract.ts`

Replace the lifted `allocations` + `purchasable` with the embedded policy + `cta` + `description`:

```ts
import { TierPolicySchema } from "../models/tier.model.js";
import { TierCtaSchema } from "../models/tier.model.js";

export const BillingTierSchema = z.object({
  slug: z.string(),
  displayName: z.string(),
  /** The whole assembled policy — allocations (free/metered/expensive, each
   *  unitsPerPeriod + ratePerMin; null = unlimited), perToolCaps, overage,
   *  period, entitlements. */
  policy: TierPolicySchema,
  /** Operator-authored blurb; null renders cleanly (no blurb). */
  description: z.string().nullable(),
  /** Single source of truth for the card's action. */
  cta: TierCtaSchema,
  /** Live Stripe price; null = no price (non-`subscribe` tier) OR Stripe outage. */
  price: z
    .object({
      unitAmount: z.number().int(),
      currency: z.string(),
      interval: z.enum(["month", "year"]),
    })
    .nullable(),
});
```

`BillingTiersGetResponseSchema`, the checkout/portal schemas, and `contracts/index.ts` re-exports are unchanged. Swagger's `BillingTiersGetResponse` component regenerates automatically (`swagger.config.ts:221` `z.toJSONSchema`).

### Core — `packages/core/src/registries/tier-catalog.ts`

Add `cta: TierCtaSchema` to `TierCatalogEntrySchema` and to both entries: `standard → "none"`, `pro → "subscribe"`. The catalog defines **only** the public global tiers; custom rows are created ad-hoc via the CLI, never here. (`description`, `visibleToOrganizationId` are **not** catalog fields.)

### DB — `apps/api/src/db/schema/tiers.table.ts`

Add three columns + one CHECK; declare the FK:

```ts
  cta: text("cta").notNull().default("none"),
  description: text("description"),                       // nullable; operator blurb
  visibleToOrganizationId: text("visible_to_organization_id")
    .references(() => organizations.id),                  // nullable FK; null = public
// in the table-args array:
  check("tiers_cta_check", sql`${t.cta} IN ('subscribe', 'contact', 'none')`),
  check("tiers_cta_price_check",
    sql`${t.cta} <> 'subscribe' OR ${t.stripePriceId} IS NOT NULL`),
```

`organizations.id` is imported for the FK — this closes a **cyclic FK** with the existing `organizations.tier → tiers.slug` (both nullable/defaulted, so insert ordering resolves; see Migration).

`zod.ts` `TierSelectSchema`/`TierInsertSchema` regenerate via `createSelectSchema`/`createInsertSchema` — no edit. `type-checks.ts` needs **no new assertion**: the existing `Tier`↔`TierSelect` `IsAssignable` pair (`:146-156`) covers the new columns once they land on both `TierSchema` and the table.

### API — repository & service

**`apps/api/src/db/repositories/tiers.repository.ts`** — add the org-scoped finder (keep `findSelectable` for any non-scoped caller):

```ts
/** Live selectable tiers visible to `organizationId`: public rows
 *  (visible_to_organization_id IS NULL) plus rows scoped to this org (#241).
 *  The org filter lives HERE so no unfiltered path can leak another org's
 *  private tier. */
async findSelectableForOrg(
  organizationId: string,
  client: DbClient = db,
): Promise<TierSelect[]> {
  return (client as typeof db)
    .select().from(this.table)
    .where(and(
      eq(tiers.selectable, true),
      this.notDeleted(),
      or(isNull(tiers.visibleToOrganizationId),
         eq(tiers.visibleToOrganizationId, organizationId)),
    ))
    .orderBy(tiers.created);
}
```

**`apps/api/src/services/billing.service.ts`** — `listBillingTiers(organizationId: string)`:

```ts
static async listBillingTiers(organizationId: string): Promise<BillingTier[]> {
  const rows = await DbService.repository.tiers.findSelectableForOrg(organizationId);
  return Promise.all(rows.map(async (row) => ({
    slug: row.slug,
    displayName: row.displayName,
    policy: TierService.tierPolicyFromRow(row),
    description: row.description,
    cta: row.cta as BillingTier["cta"],
    price: row.stripePriceId ? await StripeService.getPrice(row.stripePriceId) : null,
  })));
}
```

`price` is still fetched only when a `stripePriceId` exists (a `subscribe` tier), degrading to `null` on outage — unchanged.

### API — route `apps/api/src/routes/billing.router.ts`

`GET /api/billing/tiers`: pass the resolved org — `const { organization } = await resolveCallerOrg(req); const tiers = await BillingService.listBillingTiers(organization.id);`. Update the `@openapi` `description` (`:60`) to state the payload now carries the full policy, blurb, and `cta`, and that the list is scoped to the caller's org. No new `ApiCode`.

### API — seed `apps/api/src/services/seed.service.ts`

`seedTiers` bootstrap-inserts `standard` from the catalog entry — it now carries `cta: "none"` automatically once the catalog entry has it; `description`/`visibleToOrganizationId` insert as `null`/default. No structural change beyond the field flowing through.

### devops-cli — `packages/devops-cli/src/tables.ts` + `commands/tier.ts`

- **`tables.ts` mirror** gains `cta: text("cta").notNull()`, `description: text("description")`, `visibleToOrganizationId: text("visible_to_organization_id")` — the create/update store writes them (parity with the source table; the registry parity test pins it).
- **`CONVERGED_POLICY_FIELDS`** (`tier.ts:39`) gains **`cta`** (catalog-owned). It does **not** gain `description` or `visibleToOrganizationId` (operator/per-client state, never converged).
- **New commands** (pure value-builders + an injectable store, mirroring `tierApply`'s `createTierStore`/`openEnvTierStore` seam; guarded via `guard()`, audited via `recordAudit`):

```
portalops tier create --env <e> --slug <s> --display-name <n> \
    [--cta <subscribe|contact|none>]      # default: contact
    [--visible-to-org <orgId>]            # scope to one org (custom)
    [--description <text>]
    [--overage <hard-deny|soft-alert>]    # default: hard-deny
    [--free-units N --free-rate N --metered-units N --metered-rate N \
     --expensive-units N --expensive-rate N]   # omitted = NULL (unlimited)
    [--selectable]                        # default: true
    --yes [--confirm-prod]

portalops tier update --env <e> --slug <s> [same optional flags as create] --yes [--confirm-prod]

portalops tier description --env <e> --slug <s> (--set <text> | --clear) --yes [--confirm-prod]
```

Store methods on the tier store: `createTier(values)`, `updateTier(slug, sets)`, `setDescription(slug, value | null)`. `create` on an existing slug → **conflict (exit 9)**; `update`/`description` on a missing slug → **not-found (exit 8)** (shared cli-env error classes). Every mutation appends a `recordAudit` JSONL line (`command: "tier create" | "tier update" | "tier description"`). Wire the subcommands under the existing `tier` command in `bin.ts:226`.

### devops-cli — `COMMANDS.md`

Document `tier create`/`tier update`/`tier description` (flags, exit codes, guard tiers) and add a short **custom-tier runbook**: create the tier (portalops) → set its blurb (portalops `tier description`) → switch the client's org onto it (`portalai org set-tier <orgId> <slug>`).

### Web — new pure UI + formatters

- **`apps/web/src/utils/tier-format.util.ts`** (new) — pure formatters, unit-tested directly:
  - `formatAllocation({ unitsPerPeriod, ratePerMin })` → e.g. `"1,000 units / month · 20 / min"`, `null` → `"Unlimited"`.
  - `formatPeriod(period)` → `"Monthly"`.
  - `formatOverage(overage)` → `"Stops at limit"` (`hard-deny`) / `"Alerts, keeps going"` (`soft-alert`).
  - `formatPerToolCaps(caps)` → list rows or `null`.
  - `entitlementPackNames(slugs)` → `slugs.map(s => BUILTIN_TOOLPACK_BY_SLUG[s]?.name ?? s)` (from `@portalai/core/registries`); `customToolpacks` → `"Custom toolpacks allowed / not allowed"`.
  - `formatPrice(price)` → existing helper, moved here (`"$49 / month"`, `null` → `"—"`).
  - `SUPPORT_MAILTO = "mailto:ben.turner@btdev.io"` (shared with `Help.view` — extract the address to this one constant).
- **`apps/web/src/components/TierCard.component.tsx`** (new) — a **single pure UI component** `TierCardUI` (props-only):

```ts
export interface TierCardUIProps {
  tier: BillingTier;
  isCurrentPlan: boolean;
  isOwner: boolean;
  isPending: boolean;
  onSubscribe: (slug: string) => void;   // used only when cta === "subscribe"
}
```

Rendering rules (D6):
- Header: `displayName`, `formatPrice`/"Free"/(nothing for contact), a "Current plan" chip when `isCurrentPlan`.
- Blurb: `description` when non-null.
- **Policy grid** (allocations for all three classes with both dimensions, perToolCaps, overage, period, entitlement names): shown when `cta !== "contact" || isCurrentPlan`; hidden for a contact **upgrade teaser**.
- **CTA**: `subscribe` → owner-gated Subscribe button; `contact` → a "Contact support" link (`SUPPORT_MAILTO`) reading **"Contact support"** as a teaser or **"Contact support to manage/update your plan"** when `isCurrentPlan`; `none` → no CTA.

### Web — `apps/web/src/components/SubscriptionBilling.component.tsx`

`SubscriptionBillingUI` maps `tiers` → `<TierCardUI>` (passing `isCurrentPlan = tier.slug === organization.tier`), drops the inline price/Subscribe logic (moved into `TierCardUI`). The container derivation changes:
- `subscribed` (live `stripeSubscriptionId`) → the existing Manage button (unchanged).
- else if the org's current tier **is** in the returned list → render the cards (current one flagged; a custom current plan renders full grid + manage-CTA per D6).
- else (current tier absent from the org-scoped list — an unlisted bespoke slug) → the existing **`managed`** banner (preserved as the fallback).

`billing.api.ts` (`sdk.billing.tiers`) is unchanged — same endpoint, richer payload. Owner-gating (`withOwnerGate`) is preserved and moves alongside `TierCardUI`.

## Migration

`cd apps/api && npm run db:generate -- --name add_tier_cta_description_visibility`, one migration:

1. `ALTER TABLE tiers ADD COLUMN cta text NOT NULL DEFAULT 'none'` (backfills existing rows to `none`; `tier apply` then converges `standard→none`/`pro→subscribe`).
2. `ADD COLUMN description text` (nullable).
3. `ADD COLUMN visible_to_organization_id text REFERENCES organizations(id)` (nullable).
4. `ADD CONSTRAINT tiers_cta_check` + `tiers_cta_price_check`.

**Cyclic FK note:** `tiers.visible_to_organization_id → organizations.id` plus the existing `organizations.tier → tiers.slug` form a cycle. It resolves because both sides are nullable/defaulted — `standard`/`pro` carry `visible_to_organization_id = NULL`, and a custom tier is created only after its org exists. No deferrable constraint needed. No production data at risk (project memory).

No seed row is added by the migration (the `cta` default backfills; `standard`/`pro` reach their real `cta` via `tier apply`).

## TDD test plan

Run via npm scripts (`feedback_use_npm_test_scripts`): `cd packages/core && npm run test:unit`; `cd apps/api && npm run test:unit && npm run test:integration`; `cd packages/devops-cli && npm run test:unit`; `cd apps/web && npm run test:unit`.

### Layer 1 — `@portalai/core` (models, contract, catalog)

1. `TierCtaSchema` accepts the three values, rejects others.
2. `TierSchema` round-trips with `cta`/`description: null`/`visibleToOrganizationId: null` and with them populated.
3. `BillingTierSchema` parses a full enriched tier (embedded `policy`, `description`, `cta`, `price`); rejects a missing `policy`; accepts `description: null` and `price: null`.
4. `BillingTierSchema` rejects an unknown `cta`.
5. Catalog: `standard.cta === "none"`, `pro.cta === "subscribe"`; `TierCatalogEntrySchema` requires `cta`.

### Layer 2 — DB / repository (integration)

6. `tiers` insert with each `cta` value round-trips; `findSelectableForOrg` returns public rows (`visible_to_organization_id IS NULL`).
7. **Isolation:** a tier scoped to org A is returned by `findSelectableForOrg(A)` and **excluded** from `findSelectableForOrg(B)`.
8. `tiers_cta_check` rejects a bad `cta`; `tiers_cta_price_check` rejects `cta='subscribe'` with `stripe_price_id IS NULL` and accepts it when a price is present.
9. FK: a tier with `visible_to_organization_id` pointing at a nonexistent org is rejected.
10. Dual-schema guards compile (`type-check` green; a scratch mismatch fails it).

### Layer 3 — billing service (integration)

11. `listBillingTiers(orgId)` projects the full `policy` (all three allocation classes with both dimensions), `description`, and `cta` for each visible row.
12. A custom tier scoped to the caller's org appears; a custom tier scoped to a **different** org does not.
13. `price` is `null` for a `contact`/`none` tier and fetched for a `subscribe` tier; a stubbed `getPrice → null` (outage) leaves `cta` intact.

### Layer 4 — route (integration)

14. `GET /api/billing/tiers` returns the enriched, org-scoped list for the caller; excludes another org's private tier.
15. Auth-guarded (401 without a token); 404 when the caller has no org.

### Layer 5 — devops-cli (unit, injectable fake store)

16. `tier create` builds correct insert values (defaults: `cta=contact`, `selectable=true`, `overage=hard-deny`, omitted allocations → `null`); calls the store once; audits.
17. `tier create` on an existing slug → **exit 9** (conflict), no write.
18. `tier update` changes only the passed fields; on a missing slug → **exit 8** (not-found).
19. `tier description --set`/`--clear` sets/nulls `description`; missing slug → exit 8.
20. Guard: an `app-dev` mutation without `--yes` → **exit 5** (confirmation-required); `local` needs no `--yes`.
21. `CONVERGED_POLICY_FIELDS` includes `cta` and **excludes** `description`/`visibleToOrganizationId` (pins the convergence set); mirror-table parity test still green.

### Layer 6 — web (unit)

22. `tier-format.util`: `formatAllocation` renders units + rate, `null` → "Unlimited"; `entitlementPackNames` maps slugs → display names, unknown slug falls through; `formatOverage`/`formatPeriod`/`formatPerToolCaps` cases.
23. `TierCardUI` — `subscribe` tier renders the grid + owner-gated Subscribe; non-owner sees the disabled+tooltip affordance.
24. `TierCardUI` — `contact` tier **not** current: title + blurb + "Contact support", **no grid**.
25. `TierCardUI` — `contact` tier **current** (`isCurrentPlan`): full grid + "Contact support to manage/update your plan".
26. `TierCardUI` — `none` tier current: "Current plan" chip, no CTA; a tier with `description: null` renders without a blurb.
27. `SubscriptionBillingUI` — maps a mixed list to cards; current plan flagged; unlimited allocations show "Unlimited".
28. Container — `subscribed` shows Manage; current tier absent from list → `managed` banner (fallback preserved).

**Totals:** ~5 core, ~5 db, ~3 service, ~2 route, ~6 cli, ~7 web ≈ **28 cases**.

## Acceptance criteria

- [ ] Each card shows name, price (or "Free"/none for contact), blurb, and — for public tiers or the current plan — every policy dimension: per-cost-class allocations (`free`/`metered`/`expensive`, each `unitsPerPeriod` **and** `ratePerMin`, `null` → "Unlimited"), per-tool caps, overage, billing period, and toolpack entitlements by display name.
- [ ] Adding/removing/repricing/re-describing a tier (catalog+`tier apply`, its Stripe price, or `portalops tier description`) changes the cards with **no** web/api code change or redeploy.
- [ ] A custom tier is a real, org-scoped data row: it appears **only** to its org (isolation test 7/12/14), shows "Contact support", and has no Subscribe/checkout path.
- [ ] Editing `description` via portalops updates the blurb; a subsequent `tier apply` does **not** revert it (`description` excluded from convergence).
- [ ] Unlimited (`null`) allocations render "Unlimited"; a tier with no blurb renders cleanly.
- [ ] A contact tier shows "Contact support" as an upgrade teaser (no grid) and "Contact support to manage/update your plan" + full grid when it's the current plan.
- [ ] Existing behavior preserved: owner-only actions gated, current plan indicated, subscribed/managed states intact, price live from Stripe (→ "—" on outage).
- [ ] `portalops tier create`/`update`/`description` are guarded (`--yes` on app-dev, `--yes --confirm-prod` on prod), audited, and use exit 8/9 for not-found/conflict; `portalai org set-tier` documented as the switch step.
- [ ] All new cases pass; `npm run lint && npm run type-check` clean; migration applies on a fresh DB.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| **Cross-tenant leak** — an org sees another org's private custom tier. | Org filter is in the repository SQL (`findSelectableForOrg`), never app-code post-fetch; tests 7/12/14 assert exclusion. **Fail-closed:** a row with no explicit visibility is public only when `visible_to_organization_id IS NULL` by construction. |
| Cyclic FK (`tiers ↔ organizations`) blocks inserts. | Both sides nullable/defaulted; `standard`/`pro` have `visible_to_organization_id = NULL`; custom tier created after its org. Migration test on a fresh DB confirms. |
| `cta = 'subscribe'` with no price → a dead Subscribe button. | `tiers_cta_price_check` CHECK + `tier apply`'s existing fail-closed `TierApplyMissingPricesError`; test 8. |
| Dropping `purchasable`/top-level `allocations` breaks a consumer. | Only the contract + `SubscriptionBilling` + contract tests read them; all updated in this PR (clean cut, no alias — project memory). `type-check` catches any stragglers. |
| Operator forgets to scope a bespoke tier → org falls to the `managed` banner. | The `managed` fallback is preserved for a current tier absent from the list; runbook in `COMMANDS.md` sets `--visible-to-org` at create time. |

**Rollback:** `git revert` + revert the migration (drop the three columns + two checks). Data-lossless — custom tiers created after ship would drop with the column, but none exist pre-ship.

## Files touched

**`packages/core`** — edit: `models/tier.model.ts` (+`TierCtaSchema`, +3 fields), `contracts/billing.contract.ts` (enriched), `registries/tier-catalog.ts` (+`cta`); new/updated tests under `__tests__/models`, `__tests__/contracts`, `__tests__/registries`.

**`apps/api`** — edit: `db/schema/tiers.table.ts` (+3 columns, +2 checks, FK import), `db/repositories/tiers.repository.ts` (+`findSelectableForOrg`), `services/billing.service.ts` (`listBillingTiers(orgId)`), `routes/billing.router.ts` (pass org + `@openapi`), `services/seed.service.ts` (cta flows through); new migration; integration tests. (`zod.ts`/`type-checks.ts` auto — verify green, no edit expected.)

**`packages/devops-cli`** — edit: `src/tables.ts` (+3 mirror columns), `src/commands/tier.ts` (+`cta` in `CONVERGED_POLICY_FIELDS`, +`createTier`/`updateTier`/`setDescription` + commands), `src/bin.ts` (wire subcommands), `COMMANDS.md`; unit tests.

**`apps/web`** — new: `components/TierCard.component.tsx`, `utils/tier-format.util.ts`, their tests; edit: `components/SubscriptionBilling.component.tsx`, `views/Help.view.tsx` (use `SUPPORT_MAILTO`); web unit tests.

No new dependency, env var, or infra change.

## Next step

`docs/SUBSCRIPTION_TIER_CARDS.plan.md` — TDD slices, each a testable commit on this branch: (1) **core + DB** — `TierCtaSchema` + 3 columns + catalog `cta` + migration + dual-schema (Layers 1–2); (2) **API** — `findSelectableForOrg` + `listBillingTiers(orgId)` + route + seed (Layers 3–4); (3) **devops-cli** — `cta` convergence + `tier create`/`update`/`description` + `COMMANDS.md` (Layer 5); (4) **web** — `tier-format.util` + `TierCardUI` + `SubscriptionBilling` rebuild (Layer 6). Slices 1→2 are ordered (contract before projection); 3 and 4 depend only on 1.
