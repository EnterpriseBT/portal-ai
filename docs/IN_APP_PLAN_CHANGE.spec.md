# In-app plan upgrade/downgrade for non-custom orgs — Spec

Pins the contract for in-app plan switching: `POST /api/billing/portal` gains an optional target `tier` that opens the Stripe billing portal's **`subscription_update_confirm`** flow deep-linked to that tier's price; the subscribed-state billing UI renders the full plan grid with a **"Switch to this plan"** CTA on non-current priced tiers. Payments/proration stay Stripe-hosted and the existing webhook reconciles the tier — **no** direct subscription mutation, **no** webhook change, **no** DB schema change. Discovery: `docs/IN_APP_PLAN_CHANGE.discovery.md`. Issue: #260.

## Key decisions (from discovery, confirmed)

1. **Portal-routed switch (D1)** — extend the portal session with `flow_data.subscription_update_confirm`; no bespoke `change-plan` endpoint (deferred).
2. **Extend `/portal` with an optional `tier` (D2)** — bodyless = Manage (today's behavior); `{ tier }` = a switch flow. One endpoint, backward-compatible.
3. **Switch CTA only on non-current priced (`cta === "subscribe"`) tiers (D3)**; custom orgs stay sales-gated (#241 collapse); Manage stays for payment/invoices/cancel.
4. **Downgrade to the free tier = cancel** (D4) — no "Switch" on the `none`-cta free tier; cancelling (via Manage) *is* going to free. No dedicated button.
5. **Webhook reconciliation is reused unchanged** — `handleSubscriptionEvent` maps the new price → tier on `customer.subscription.updated`.
6. **Portal *configuration* (switch-plans enabled + products allow-listed) is a per-env Stripe setup step** verified in smoke, not app code (Open Q1).

## Scope

### In scope
- `StripeService.createPortalSession` accepts an optional subscription-update descriptor → emits `flow_data`.
- `BillingService.createPortal(org, callerUserId, tierSlug?)` resolves the target tier + builds the descriptor, with guards.
- `BillingPortalRequestSchema = { tier?: string }`; `/portal` parses it; `@openapi` updated; swagger component registered.
- `sdk.billing.portal()` sends the optional `{ tier }`.
- Subscribed-state UI: full plan grid + "Switch to this plan" (owner-gated); `TierCardUI` grows a subscribed/switch mode.

### Out of scope
- A direct `POST /api/billing/change-plan` (no-redirect subscription mutation) — deferred.
- Custom-plan self-service (sales-gated).
- The Stripe portal **configuration** content (env setup, smoke-verified).
- Any DB schema / webhook change.

## Surface

### `StripeService.createPortalSession` — `apps/api/src/services/stripe.service.ts:143`

Add an optional `subscriptionUpdate` param; when present, emit `flow_data`:

```ts
static async createPortalSession(args: {
  customerId: string;
  returnUrl: string;
  subscriptionUpdate?: { subscriptionId: string; itemId: string; priceId: string };
}): Promise<{ url: string }> {
  const session = await StripeService.client().billingPortal.sessions.create({
    customer: args.customerId,
    return_url: args.returnUrl,
    ...(args.subscriptionUpdate
      ? {
          flow_data: {
            type: "subscription_update_confirm" as const,
            subscription_update_confirm: {
              subscription: args.subscriptionUpdate.subscriptionId,
              items: [
                {
                  id: args.subscriptionUpdate.itemId,   // subscription ITEM id (si_…)
                  price: args.subscriptionUpdate.priceId,
                },
              ],
            },
          },
        }
      : {}),
  });
  return { url: session.url };
}
```

Bodyless call (no `subscriptionUpdate`) is byte-for-byte today's Manage session.

### `BillingService.createPortal` — `apps/api/src/services/billing.service.ts:389`

Signature gains an optional `tierSlug`; guard order below. Reuses `StripeService.fetchSubscription` (`stripe.service.ts:89`) to get the subscription item id.

```ts
static async createPortal(
  org: OrganizationSelect,
  callerUserId: string,
  tierSlug?: string
): Promise<{ url: string }> {
  // (unchanged) configured 503 → owner 403 → has-customer 409 (BILLING_NO_SUBSCRIPTION)
  …existing guards…

  let subscriptionUpdate: {...} | undefined;
  if (tierSlug) {
    // switch flow: requires a live subscription
    if (!org.stripeSubscriptionId) {
      throw new ApiError(409, ApiCode.BILLING_NO_SUBSCRIPTION,
        "The organization has no active subscription to change");
    }
    // resolve target tier — SAME guards as createCheckout
    const tier = await DbService.repository.tiers.findBySlug(tierSlug);
    if (!tier || !tier.selectable) throw new ApiError(404, ApiCode.BILLING_TIER_NOT_FOUND, `Unknown plan: ${tierSlug}`);
    if (!tier.stripePriceId)       throw new ApiError(400, ApiCode.BILLING_TIER_NOT_PURCHASABLE, `The ${tier.displayName} plan cannot be switched to`);
    const sub = await StripeService.fetchSubscription(org.stripeSubscriptionId);
    const itemId = sub.items.data[0]?.id;
    if (!itemId) throw new ApiError(502, ApiCode.BILLING_PORTAL_FAILED, "Could not resolve the current subscription item");
    subscriptionUpdate = { subscriptionId: org.stripeSubscriptionId, itemId, priceId: tier.stripePriceId };
  }

  try {
    return await StripeService.createPortalSession({
      customerId: org.stripeCustomerId!,
      returnUrl: settingsUrl(),
      subscriptionUpdate,
    });
  } catch (err) { …502 BILLING_PORTAL_FAILED… }
}
```

- **Guard order:** configured (503) → owner (403) → has-customer (409) → *[switch only]* has-subscription (409) → tier exists+selectable (404) → priced (400) → Stripe (502). No new `ApiCode` — all reused.
- Targeting the current tier is **not** server-blocked (the frontend never offers Switch on the current plan); Stripe handles a same-price confirm harmlessly.

### Route `POST /api/billing/portal` — `apps/api/src/routes/billing.router.ts:224`

Parse an **optional** body; pass `tier` through. Bodyless request → Manage (unchanged).

```ts
const parsed = BillingPortalRequestSchema.safeParse(req.body ?? {});
if (!parsed.success) throw new ApiError(400, ApiCode.BILLING_INVALID_PAYLOAD, "Invalid request body");
const result = await BillingService.createPortal(organization, user.id, parsed.data.tier);
```

`@openapi` (`:191`): add an **optional** `requestBody` `$ref: '#/components/schemas/BillingPortalRequest'`, document the switch flow, and add `404` (unknown plan) / `400` (not switchable / invalid body) responses.

### Contract — `packages/core/src/contracts/billing.contract.ts`

```ts
/** Request body for `POST /api/billing/portal`. No tier = Manage (portal home);
 *  a tier = open the subscription-update flow to that tier's price (#260). */
export const BillingPortalRequestSchema = z.object({ tier: z.string().optional() });
export type BillingPortalRequest = z.infer<typeof BillingPortalRequestSchema>;
```

Register `BillingPortalRequest` under `components.schemas` in `apps/api/src/config/swagger.config.ts` (`billingSchemas`, alongside the others) via `z.toJSONSchema`.

### SDK — `apps/web/src/api/billing.api.ts:32`

`portal()` sends the optional body (drop the bodyless override, mirror `checkout()`):

```ts
portal: () =>
  useAuthMutation<BillingPortalResponse, BillingPortalRequest>({
    url: "/api/billing/portal",
    method: "POST",
  }),
```

Manage → `portalMutation.mutateAsync({})`; Switch → `portalMutation.mutateAsync({ tier })`.

### `TierCardUI` — `apps/web/src/components/TierCard.component.tsx`

Add to `TierCardUIProps`: `isSubscribed?: boolean` and `onSwitch?: (tierSlug: string) => void`. CTA rule for `cta === "subscribe" && !isCurrentPlan`:
- `isSubscribed` → owner-gated **"Switch to this plan"** button → `onSwitch(tier.slug)`.
- else → the existing owner-gated **"Subscribe"** button → `onSubscribe(tier.slug)`.

`cta === "none"` (free) and `contact` are unchanged (no Switch on free — D4; contact → support mailto).

### `SubscriptionBilling` — `apps/web/src/components/SubscriptionBilling.component.tsx`

- **Render the plan grid for `unsubscribed` AND `subscribed`** (today it's unsubscribed-only). Pass `isSubscribed={state === "subscribed"}` and `onSwitch` to each `TierCardUI`.
- The **subscribed** branch keeps the **"Manage subscription"** button (payment/invoices/cancel) below the grid; the standalone #257 current-plan card now applies to **`managed` only** (subscribed shows the current tier flagged *within* the grid).
- Container: add `handleSwitch(tierSlug)` → `portalMutation.mutateAsync({ tier: tierSlug }).then(redirect)`; `handleManage` → `portalMutation.mutateAsync({})`. Custom-only collapse (`cta === "contact"`) and owner-gating unchanged. (A subscribed org is always on a priced tier, so the collapse never triggers in the subscribed grid.)

## Migration / Seed

**None** — no DB schema change (Stripe owns the subscription; the webhook owns the tier write). No seed change.

## TDD test plan

Run via npm scripts: `cd packages/core && npm run test:unit`; `cd apps/api && npm run test:unit && npm run test:integration`; `cd apps/web && npm run test:unit`.

### Layer 1 — `@portalai/core` contract
1. `BillingPortalRequestSchema` parses `{ tier: "pro" }` and `{}` (tier optional); rejects `{ tier: 1 }`.

### Layer 2 — `apps/api` billing service (unit; StripeService + repo mocked) — `src/__tests__/services/billing.service.endpoints.test.ts`
2. `createPortal` **no tier** → `createPortalSession` called with **no** `subscriptionUpdate` (Manage unchanged); returns url.
3. `createPortal(tier)` on a subscribed org → resolves `findBySlug` price, calls `fetchSubscription`, passes `subscriptionUpdate { subscriptionId, itemId, priceId }` to `createPortalSession`.
4. `createPortal(tier)` with **no `stripeSubscriptionId`** → 409 `BILLING_NO_SUBSCRIPTION`; no Stripe call.
5. `createPortal(tier)` unknown/unselectable tier → 404 `BILLING_TIER_NOT_FOUND`; unpriced tier → 400 `BILLING_TIER_NOT_PURCHASABLE`.
6. non-owner → 403 `BILLING_NOT_OWNER`; unconfigured → 503; Stripe throw → 502 `BILLING_PORTAL_FAILED`.

### Layer 3 — `apps/api` route (integration) — `src/__tests__/__integration__/routes/billing.router.integration.test.ts`
7. `POST /api/billing/portal` with `{ tier: PRO }` on a subscribed org → 200 `{ url }` (StripeService stubbed); bodyless → 200 (Manage).
8. Malformed body (`{ tier: 5 }`) → 400 `BILLING_INVALID_PAYLOAD`; anonymous → 401; non-owner → 403.

### Layer 4 — `apps/web` (unit) — `SubscriptionBilling.component.test.tsx`, `TierCard.component.test.tsx`
9. `TierCardUI` `isSubscribed` + non-current subscribe tier → renders **"Switch to this plan"** (not "Subscribe"); click → `onSwitch(slug)`; non-owner → disabled + tooltip.
10. `TierCardUI` current plan → chip, no Switch; free (`none`) tier → no Switch; `contact` → mailto (unchanged).
11. `SubscriptionBillingUI` **subscribed** → renders the full grid (current flagged, Switch on the other paid tier) **and** the Manage button; `managed` → still the single current-plan card + banner (unchanged).
12. Container: `handleSwitch` calls `sdk.billing.portal().mutateAsync({ tier })` then redirects; `handleManage` calls `mutateAsync({})` (mocked SDK).

**Totals ≈ 1 core, 5 api unit, 2 api integration, 4 web ≈ 12 cases.** No migration/seed test (no schema change).

## Acceptance criteria

- A subscribed org sees all plans in the billing tab; a non-current priced tier offers **"Switch to this plan"** (owner-gated) that opens the Stripe portal's subscription-update flow for that plan; on confirm, the webhook reconciles the tier.
- Downgrade works the same way between priced tiers; the free tier offers no Switch (cancel via Manage = go to free).
- A custom-plan org still sees only its card (sales-gated, no Switch); `contact` tiers show support-contact, never Switch.
- `POST /api/billing/portal` with no body still opens Manage (unchanged); with `{ tier }` opens the switch flow; guards return the documented 403/404/400/409/502/503.
- No DB or webhook change; no in-app path mutates the subscription directly (Stripe-hosted only → no desync, cf. #259).
- `npm run lint && npm run type-check` clean; all new cases pass.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| The env's Stripe **portal configuration** doesn't allow subscription updates → `flow_data` rejected at session create. | Per-env setup step (Open Q1); **smoke verifies it in app-dev's sandbox** before merge. Failure surfaces as 502 `BILLING_PORTAL_FAILED` (fail-closed), not a bad local state. |
| `sub.items.data[0]` assumption (single-item subscription). | Portal tiers are single-price subscriptions; guard the empty case → 502. Revisit if multi-item plans appear. |
| Switching to the current plan. | Frontend never offers it; Stripe confirms a same-price update harmlessly. |
| Portal/Stripe outage. | **Fail-closed** — 502/503 surfaced via `FormAlert`; no local subscription/tier write (the webhook is the only writer). |
| Contract drift (`/portal` now takes a body). | `tier` is **optional** — bodyless Manage callers unaffected; swagger component + `@openapi` updated in the same PR. |

**Rollback:** `git revert` — no schema/data to unwind; `/portal` reverts to bodyless Manage.

## Files touched

**`packages/core`** — edit: `contracts/billing.contract.ts` (+`BillingPortalRequestSchema`); contract test.

**`apps/api`** — edit: `services/stripe.service.ts` (portal `flow_data`), `services/billing.service.ts` (`createPortal(tierSlug?)`), `routes/billing.router.ts` (parse body + `@openapi`), `config/swagger.config.ts` (register `BillingPortalRequest`); unit + integration tests. No new `ApiCode`; no migration.

**`apps/web`** — edit: `api/billing.api.ts` (`portal()` body), `components/TierCard.component.tsx` (`isSubscribed`/`onSwitch` + Switch CTA), `components/SubscriptionBilling.component.tsx` (subscribed grid + `handleSwitch`); component tests.

No new dependency, env var, or infra (the Stripe portal *config* is an operator setup step, not code).

## Next step

`docs/IN_APP_PLAN_CHANGE.plan.md` — TDD slices on this branch: (1) **backend** — `createPortalSession` `flow_data` + `createPortal(tierSlug?)` + `BillingPortalRequestSchema` + route/`@openapi`/swagger (Layers 1–3); (2) **frontend** — `TierCardUI` Switch mode + `SubscriptionBilling` subscribed grid + SDK `portal({tier})` (Layer 4). Two slices; the webhook needs none. Slice 2 depends on slice 1's contract.
