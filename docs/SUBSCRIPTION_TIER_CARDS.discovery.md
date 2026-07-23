# Enrich subscription tier cards with full policy details + Custom plan — Discovery

**Issue:** [EnterpriseBT/portal-ai#241](https://github.com/EnterpriseBT/portal-ai/issues/241)

**Why this exists.** Settings → **Subscription & Billing** (`SubscriptionBilling.component.tsx`) shows a prospective buyer almost nothing: a tier's `displayName`, a price line (or "Free"), and a Subscribe button. The org can't see what a plan actually *includes* — its unit allocations, per-minute rates, per-tool caps, overage behavior, billing period, or toolpack entitlements — even though the tier policy carrying all of that is one projection away (`TierService.tierPolicyFromRow`). There is no operator-authored prose for any plan, and no "Custom / enterprise" option for buyers whose needs exceed the self-serve tiers. Because tiers change over time (#239 adds Pro/Enterprise; tiers get repriced and re-described later), the display must be **fully data-driven** — adding, removing, repricing, or re-describing a tier takes zero web/api code changes and no redeploy. **Custom tiers are per-client, not a generic card:** an operator mints a bespoke slug (e.g. `acme_enterprise`) visible *only* to that client's org, and that org sees it as an upgrade card. This is the work that turns the billing cards from a name-and-price stub into a data-driven, org-scoped plan-comparison surface plus a "contact support" path onto custom tiers.

## The current shape

### Billing tier contract (the wire shape)

`packages/core/src/contracts/billing.contract.ts:13` — `BillingTierSchema` carries `slug`, `displayName`, `allocations` (lifted from `TierPolicySchema.shape.allocations`, `:16`), `purchasable: boolean` (`:18`, = `stripePriceId != null`), and a nullable `price` (`:20`). The header comment (`:5`) states the intent: enrichment should **"add a field, not a reshape,"** and `purchasable` is split from `price` so a Stripe outage (`price: null`) never reads as "not for sale." `perToolCaps`, `overage`, `period`, and `entitlements` are **not** projected yet.

### Tier policy model & projection

| Piece | Location | Note |
|---|---|---|
| Flat DB-row shape | `packages/core/src/models/tier.model.ts:91` (`TierSchema`) | Scalar charge grid + jsonb `perToolCaps`; `stripePriceId` nullable (`:106`), `selectable` (`:109`), `builtinToolpacks`/`customToolpacks` (`:113`) |
| Assembled policy | `tier.model.ts:71` (`TierPolicySchema`) | `period`, `allocations{free,metered,expensive}` (`null` = unlimited), `perToolCaps`, `overage`, `entitlements` |
| Row → policy | `apps/api/src/services/tier.service.ts:32` (`tierPolicyFromRow`) | Already produces the exact nested shape the cards need |

### Billing service + route (currently **global**, not org-scoped)

`apps/api/src/services/billing.service.ts:264` — `listBillingTiers()` reads `tiers.findSelectable()` (a **global** query, no org filter) and projects `slug`, `displayName`, `allocations`, `purchasable`, `price`. This is the projection point to enrich **and** the query that must become org-scoped. The route is `apps/api/src/routes/billing.router.ts:79` — it already resolves the caller's org (`resolveCallerOrg`), so the org id is in hand; `@openapi` block at `:54`. `StripeService.getPrice` (`stripe.service.ts:167`) is TTL-cached and returns `null` (never throws) on outage — `price` degrades to "—" while for-sale-ness stays truthful. `createCheckout` (`billing.service.ts:286`) already blocks checkout on a non-`selectable` current tier (D5) and 400s an unpriced tier.

### Tier table & dual-schema

`apps/api/src/db/schema/tiers.table.ts` (pgTable) → drizzle-zod at `apps/api/src/db/schema/zod.ts:67` → bidirectional `IsAssignable` assertions in `apps/api/src/db/schema/type-checks.ts`. A new column must land in **all** of table + `zod.ts` + core `TierSchema` + `type-checks.ts`, or CI breaks at compile time. Migrations generate into `apps/api/drizzle/`; `0068_add_stripe_billing_columns_and_events.sql` is the precedent for a tier ALTER.

### Tier catalog & `tier apply` convergence

`packages/core/src/registries/tier-catalog.ts` is the declarative **global**-policy record-of-truth (`standard`/`pro`); `standard` (`:79`) is already a listed-but-unbuyable row (`selectable`, `stripeLookupKey: null`). `packages/devops-cli/src/commands/tier.ts:39` — `CONVERGED_POLICY_FIELDS` is the explicit list `tier apply` writes; rows the catalog doesn't name surface once as `unmanaged` and are **never read further, written, or deleted** (`:73`). That is exactly the lifecycle a per-client custom row wants — a custom tier is deliberately *not* in the catalog, so apply leaves it alone. Convergence mirrors the catalog across four surfaces (catalog schema, `packages/devops-cli/src/tables.ts`, core `TierSchema`, `CONVERGED_POLICY_FIELDS`), parity-pinned by tests. `vars.ts:169` (`setVar` + `guardMutation` + `recordAudit`) is the pattern for a guarded mutation command.

### Frontend cards

`apps/web/src/components/SubscriptionBilling.component.tsx` — `SubscriptionBillingUI` (`:81`) renders `displayName`, `formatPrice`/"Free" (`:139`), owner-gated Subscribe shown only when `purchasable` (`:141`). The container (`:170`) derives `unsubscribed | subscribed | managed` (`:199`: a live subscription wins; else **a tier not in the selectable list = a managed custom deal**), owner-ness, current-plan label. Data via `sdk.billing.tiers` (`apps/web/src/api/billing.api.ts`). Support-link precedent: a `mailto:` at `apps/web/src/views/Help.view.tsx:132`.

## The design space

### Decision 1 — CTA as a single source of truth *(user: single source of truth is preferred)*

Distinguish the three card actions — Subscribe (self-serve), Contact support (custom/enterprise), none (free default) — from one authoritative field, not several overlapping ones.

**Chosen: a `cta` enum column** (`"subscribe" | "contact" | "none"`) on the tier row + catalog, projected verbatim to the contract. It replaces the derived `purchasable` boolean entirely (`purchasable` was `stripePriceId != null`; `cta === "subscribe"` now says the same thing, once). `price` stays a separate nullable field so a Stripe outage still degrades price without changing the CTA. Invariant: `cta === "subscribe"` ⇒ a resolvable Stripe price — already enforced fail-closed by `tier apply` (`TierApplyMissingPricesError`); the frontend gates Subscribe on `cta === "subscribe"`, Contact-support on `cta === "contact"`.

**Lean: adopt the `cta` column; drop `purchasable` from the contract** (clean cut — no external consumer, no prod data). `stripePriceId` remains, but only as the checkout mechanism, never as a second display-decision source.

### Decision 2 — Per-client custom tiers: visibility mechanism *(user: no generic Custom catalog row — bespoke slug visible only to one org)*

A custom tier is a bespoke row (`acme_enterprise`) that only Acme's org may see; Acme sees it as an upgrade card. `listBillingTiers` must become **org-scoped**.

| | A: nullable `visibleToOrganizationId` column on `tiers` | B: `tier_visibility` join table |
|---|---|---|
| One custom tier ↔ one org | Natural (`null` = public/global) | Works, heavier |
| Custom tier shared by N orgs | Not without a second row | Natural |
| Query | `WHERE visibleToOrganizationId IS NULL OR = :org` | join + `IN` |
| Migration weight | One nullable column | New table + FK |

**Lean: A — a nullable `visibleToOrganizationId` on the tier row.** `null` = public (all orgs, today's behavior); set = private to that org. `listBillingTiers(orgId)` returns global-selectable rows **plus** rows scoped to that org. A custom tier for multiple orgs (partner group) is a rare future need; note the join-table as the escape hatch if it ever arrives. This field is **not** a catalog/converged concept (catalog rows are global, always `null`) — like `description` it's excluded from `tier apply`.

### Decision 3 — Operator CLI surface for custom tiers *(user: include simple create / update / switch commands)*

The three common admin actions map cleanly onto the existing CLI domain split (memory: portalops = tier-row business config; portalai = customer app-data incl. org→tier assignment):

| Action | CLI | Status |
|---|---|---|
| **Create** a custom tier row (`acme_enterprise`, `cta: contact`, `visibleToOrganizationId`, policy, blurb) | **portalops** (new) | new — a guarded `tier create` command |
| **Update** a custom tier (policy, blurb, visibility) | **portalops** (new) | new — a guarded `tier update` (or field-scoped edits incl. the `tier description` command below) |
| **Switch** an org onto a plan | **portalai** | **already exists** — `portalai org set-tier <orgId> <tierSlug>` (`packages/admin-cli/src/bin.ts:174`, `orgSetTier`) |

**Decided (in scope):** add the portalops `tier create` / `tier update` commands (slug, `displayName`, policy fields, `cta`, `visibleToOrganizationId`, guarded + audited, `vars.ts:169` shape), documented in `COMMANDS.md`. Switching is a reuse of the existing `portalai org set-tier` — no new command, just document it as the assignment step in the custom-tier runbook. These operate on rows the catalog doesn't name, so `tier apply` leaves them untouched.

### Decision 4 — Contract shape for the enriched tier

| | A: flat sibling fields | B: embed `policy: TierPolicySchema` |
|---|---|---|
| Reuse of `tierPolicyFromRow` | Partial | Full — attach the whole policy |
| Redundancy | None | Minor (`policy.tier` dups `slug`; `allocations` moves under `policy`) |
| Future policy growth | New sibling each time | Free — inside `policy` |

**Lean: B.** `listBillingTiers` calls `tierPolicyFromRow(row)` once and attaches it whole, alongside `price`, `description`, `cta`. Today's top-level `allocations` folds into `policy.allocations` (clean cut). Frontend reads `tier.policy.*`.

### Decision 5 — `description` storage, convergence, and command

Per the ticket: a nullable `description` text column across the full dual-schema (+ migration), **excluded** from `CONVERGED_POLICY_FIELDS` so `tier apply` never clobbers operator copy; a `portalops tier description --slug --set/--clear` subcommand (guarded, audited, `vars.ts:169` shape) documented in `COMMANDS.md`. Support target for the `cta === "contact"` card: reuse the `Help.view` mailto (extracted to a shared constant) — the "no code change" bar is about tiers, not the global support address.

### Decision 6 — Custom-card rendering & CTA copy *(user: distinct copy on/off the custom plan; policy shown only when on it)*

Today `managed = !subscribed && !tiers.some(t => t.slug === org.tier)`. Once custom tiers appear in the org-scoped list, an org actually *on* `acme_enterprise` would find its slug in the list → wrongly read as not-managed. Re-derive display state from `cta` + current-plan, not list-membership.

The custom (`cta === "contact"`) card renders in two modes, keyed on whether it's the org's current plan:

| | Not on this plan (upgrade teaser) | On this plan (current) |
|---|---|---|
| **Policy grid** | **Hidden** — title + short blurb only | **Shown** — the tier's *actual* policy (all dimensions), same rendering as any tier |
| **CTA** | "Contact support" | "Contact support to manage/update your plan" |

Public tiers (`cta` `none`/`subscribe`) always show the full policy grid — they're comparison cards for everyone. Only a *custom* card hides its grid until the org is on it (the negotiated policy is meaningful only to that client). Both CTA variants route to the same support mailto.

**Lean: gate the policy grid on `cta !== "contact" || isCurrentPlan`; pick the CTA copy on `isCurrentPlan`.** The API still returns the full policy for every org-visible tier (no cross-tenant leak — the row is visible only to this org); hiding the grid is purely a frontend rendering rule.

## Tradeoff comparison

| | D1 `cta` col | D2 `visibleToOrgId` | D3 create cmd | D4 embed `policy` | D5 `description` | D6 state re-derive |
|---|---|---|---|---|---|---|
| Spreads to spec | Yes | Yes | Yes | Yes | Yes | Yes |
| New DB column | Yes | Yes | No | No | Yes | No |
| Touches convergence | Yes (add field) | No (excluded) | No | No | No (excluded) | No |
| Multi-tenant isolation | — | **Critical** | — | — | — | — |
| Frontend-only | No | No | No | No | No | Yes |

## Recommendation

1. Add a `cta` enum column (`subscribe|contact|none`) to core `TierSchema`, the `tiers` table + `zod.ts` + `type-checks.ts`, the catalog schema + `CONVERGED_POLICY_FIELDS` + `devops-cli/src/tables.ts` mirror (catalog: `standard → none`, `pro → subscribe`). Drop the derived `purchasable` from the billing contract.
2. Add a nullable `visibleToOrganizationId` column (FK-shaped) to the `tiers` dual-schema; **exclude** it from convergence. Rewrite `findSelectable` → an org-scoped finder returning `visibleToOrganizationId IS NULL OR = :orgId`; thread the caller org from the route into `listBillingTiers(orgId)`.
3. Add a nullable `description` text column across the dual-schema + migration; **exclude** from `CONVERGED_POLICY_FIELDS`.
4. Extend `BillingTierSchema` to embed `policy: TierPolicySchema` + `description: string | null` + `cta`; fold top-level `allocations` into `policy`. Update `listBillingTiers` projection and the route `@openapi`.
5. Add portalops `tier create` / `tier update` commands (slug/displayName/policy/`cta`/`visibleToOrganizationId`) and `tier description --slug --set/--clear` — all guarded + audited, documented in `COMMANDS.md`; document `portalai org set-tier` as the existing switch/assignment step.
6. Rebuild `SubscriptionBillingUI` to render every `policy` dimension generically + the blurb, formatting `null` → "Unlimited". Explicitly: the **per-cost-class allocations** for all three classes (`free`, `metered`, `expensive`), each showing **both** its `unitsPerPeriod` (units per billing period) **and** its `ratePerMin` (per-minute rate limit); plus per-tool caps, overage behavior, billing period, and toolpack entitlements (rendered as a plain list of pack display names, mapped from slugs via the builtin-toolpack registry). Custom (`cta === "contact"`) cards: **title + blurb + "Contact support"** as an upgrade teaser; **full policy grid + "Contact support to manage/update your plan"** when it's the current plan (Decision 6). Public tiers always show the grid. Re-derive current-plan/managed per Decision 6; preserve owner-gating and subscribed states.

## Open questions

_None remaining._ Toolpack entitlements are rendered as a plain list of pack **display names** (mapped from slugs via the `packages/core` builtin-toolpack registry) — no "All toolpacks" collapse, just the names.

## Enterprise-scale considerations

- **Multi-tenancy — now critical.** `listBillingTiers` becomes org-scoped: an org must **never** see another org's custom tier. This is a correctness+isolation requirement, tested directly (org A's list excludes org B's private tier). **Lean: filter in the repository query (`visibleToOrganizationId IS NULL OR = :orgId`), never in app code after a global fetch — no chance of an unfiltered path leaking.**
- **Concurrency & correctness** — `description`/custom-row edits are single-row `UPDATE`s; `tier apply` converges a **disjoint** column set (`description`, `visibleToOrganizationId`, custom rows all excluded), so apply and operator edits can't clobber each other. **Lean: safe by column/row disjointness; no lock.**
- **Accuracy & auditability** — every portalops tier mutation appends to the audit log (`recordAudit`). **Lean: audited via the existing JSONL path.**
- **Failure modes** — Stripe outage → `price: null` → "—"; `cta` stays truthful from the DB. **Lean: preserve the split-degrade; no new failure surface.**
- **Scale & unbounded growth** — the per-org list is a small fixed set (global tiers + a handful of scoped rows). **N/A because cardinality is bounded by the catalog + rare per-client rows.**
- **Contract stability** — embedding the whole `TierPolicy` + a widenable `cta` enum + additive `description` means future tiers/entitlements/CTA kinds plug in without re-plumbing. **Lean: additive-open, per the tier-two-axes memory.**
- **Data lifecycle** — `description` and `visibleToOrganizationId` live outside convergence so operator/custom state survives every `tier apply`. **Lean: persistence aligned to operator intent.**

## What this doesn't decide

- A public / pre-login pricing page — out of scope; auth-gated Settings tab only.
- Defining the Pro/Enterprise tiers or Stripe sandbox wiring — that's **#239**; this displays whatever tiers exist.
- Building a support ticketing system — "Contact support" links to the existing channel only.
- Price amounts or where pricing lives — pricing stays in Stripe (memory: no price amounts in code); this only displays it.
- Localization/i18n of blurbs — single-language copy for now.
- Custom tiers scoped to **multiple** orgs (partner groups) — the join-table escape hatch (D2 option B) is deferred until a concrete need appears.

## Next step

Write `docs/SUBSCRIPTION_TIER_CARDS.spec.md` (the contract: enriched `BillingTierSchema`, `cta` semantics + invariant, `visibleToOrganizationId` + org-scoped `listBillingTiers`, the portalops command surface, card rendering + state rules) and `docs/SUBSCRIPTION_TIER_CARDS.plan.md` (slices). Rough slicing: (1) core/DB — `cta` + `visibleToOrganizationId` + `description` columns, catalog + convergence updates, migration, type-checks; (2) org-scoped `listBillingTiers` + enriched contract + route `@openapi`; (3) portalops `tier create`/`tier update`/`tier description` commands + `COMMANDS.md` (switch = existing `portalai org set-tier`); (4) frontend card rebuild + formatting + Contact-support CTA + state re-derivation. Each slice independently green-testable.
