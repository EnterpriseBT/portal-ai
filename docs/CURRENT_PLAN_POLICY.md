# Current-plan policy in the subscribed/managed state — Condensed design (#257)

**Issue:** [EnterpriseBT/portal-ai#257](https://github.com/EnterpriseBT/portal-ai/issues/257) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc). Follow-up to #241.

**Why.** After #241, the Settings → Subscription & Billing tab shows the full tier policy only on the **plan-list cards**, which render solely in the `unsubscribed` state. A **subscribed** org sees just "Manage subscription"; a **managed** org sees just the "contact us" banner — neither can see *what their current plan includes*. This surfaces the current plan's policy (allocations, per-tool caps, overage, period, toolpack entitlements) read-only in both states, reusing the #241 `TierCardUI`. Frontend-only (`apps/web`) — no contract, API, or DB change.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Billing tab UI + container | `apps/web/src/components/SubscriptionBilling.component.tsx` | `subscribed` branch = Manage button only; `managed` = banner only; cards live in the `unsubscribed` branch |
| Pure card | `apps/web/src/components/TierCard.component.tsx` (`TierCardUI`) | `cta`+`isCurrentPlan` already give a read-only current-plan card (grid + chip, no CTA) — reused as-is |
| Current-tier policy source | `sdk.organizations.usage()` → `OrganizationUsageGetResponse.tier: TierPolicy` (`packages/core/src/contracts/tier.contract.ts:20`) | Returns the org's **resolved** `TierPolicy` (full grid incl. entitlements) whether or not the tier is listed |
| Billing list | `sdk.billing.tiers()` → `BillingTier[]` (`apps/web/src/api/billing.api.ts`) | Contains the current tier's full `BillingTier` **only when it's selectable** (subscribed case) |
| Precedent: usage query wiring | `apps/web/src/views/Settings.view.tsx:98` (`sdk.organizations.usage()`) | The usage query is already used in Settings — same hook in the billing container |

## Decision — one `TierCardUI`, tier resolved from the list or synthesized from usage

Both states render the **same read-only `TierCardUI`** (`isCurrentPlan`, so no CTA — the existing Manage button still owns changes). The container resolves the card's `BillingTier`:

- **Listed (subscribed):** `tiers.find(t => t.slug === org.tier)` — the full `BillingTier` (carries price/description/cta).
- **Unlisted (managed):** synthesize `{ slug: policy.tier, displayName: currentTierName, policy: usage.tier, description: null, cta: "none", price: null }` from `usage().tier`.

`const currentPlanTier = tiers.find(...) ?? synthesizeFromUsage(usage.tier, currentTierName)`. Alternative (two bespoke render paths — a card for subscribed, a hand-rolled grid for managed) was rejected: synthesizing a `BillingTier` reuses one component and the `tier-format` formatters unchanged. If `usage()` is still loading/errored, the current-plan card is simply omitted (banner/Manage unchanged) — no hard dependency.

**Accepted limitation:** a managed (unlisted) tier's card title is the **slug-derived name** (`formatTierSlug`) and shows **no price/blurb**, because `usage()` returns a bare `TierPolicy` (no `displayName`/`description`/`price`). Surfacing the operator's real `displayName` for an unlisted tier would need the API to return it — a contract change, out of scope here. Subscribed (listed) tiers keep their real `displayName` + price.

## Plan — 1 slice

**Files**
- Edit: `apps/web/src/components/SubscriptionBilling.component.tsx` — container adds `sdk.organizations.usage()` to its `DataResult`; computes `currentPlanTier: BillingTier | null` (listed ?? synthesized); passes it to `SubscriptionBillingUI`. UI renders `{currentPlanTier && <TierCardUI tier={currentPlanTier} isCurrentPlan isOwner={isOwner} isPending={false} onSubscribe={() => {}} />}` inside **both** the `subscribed` (above Manage) and `managed` (below banner) branches. Add `currentPlanTier` to `SubscriptionBillingUIProps`.
- Edit: `apps/web/src/__tests__/SubscriptionBilling.component.test.tsx` — mock `sdk.organizations.usage()` in the container test; add UI cases.

**Tests** (`cd apps/web && npm run test:unit -- SubscriptionBilling`)
- `subscribed` state renders the Manage button **and** a read-only current-plan card (grid visible, "Current plan" chip, **no** Subscribe button).
- `managed` state renders the banner **and** a current-plan card built from a `usage().tier` `TierPolicy` (grid visible), no CTA.
- `currentPlanTier = null` (usage loading/absent) → subscribed shows Manage only, managed shows banner only (graceful degrade).
- Container: `usage()` mocked; `subscribed` org whose tier is in the list renders the listed card; a `managed` org (tier absent from list) renders the synthesized card.

## Smoke (manual, against your dev stack)

Preflight: `git checkout feat/current-plan-policy`, `npm install`, `npm run dev` (no build/migrate — frontend-only, no contract change).

1. **Subscribed:** with an org that has a live `stripe_subscription_id` (its tier is a listed tier, e.g. `pro`), open Settings → Subscription & Billing. Expect: the **Manage subscription** button **and** a read-only **Pro** card showing the full policy grid + "Current plan" chip + **no** Subscribe button.
2. **Managed:** put an org on an **unlisted** bespoke tier (`portalops tier create --slug ent_x --display-name "X Enterprise" --visible-to-org <other>`… i.e. a tier NOT visible to this org, then `portalai org set-tier <thisOrg> ent_x`), reload. Expect: the **"Your plan is managed — contact us"** banner **and** a current-plan card rendering that tier's policy grid (sourced from `usage()`), no CTA. Clean up after (delete the tier, restore the org's tier).
3. **Degrade:** with the usage endpoint failing (stop it / force an error), the subscribed tab still shows Manage (no crash) and the managed tab still shows the banner.
4. **Unsubscribed unchanged:** an unsubscribed org still shows the #241 plan-list cards exactly as before (no regression).

## Out of scope

- Any change to the `unsubscribed` plan-list behavior (that's #241, shipped).
- Usage/consumption numbers on the billing tab — that's the Organization tab (#172); this shows plan *policy*, not consumption.
- Contract/API/DB changes — the current tier's policy already ships on `usage()`; nothing new server-side.
