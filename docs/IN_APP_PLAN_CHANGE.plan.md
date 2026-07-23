# In-app plan upgrade/downgrade for non-custom orgs — Plan

**TDD-sequenced implementation of in-app plan switching: the `/portal` subscription-update `flow_data` + optional `tier` contract (backend), then the subscribed-state "Switch to this plan" grid (frontend).**

Spec: `docs/IN_APP_PLAN_CHANGE.spec.md`. Discovery: `docs/IN_APP_PLAN_CHANGE.discovery.md`. Issue: #260. Builds on #241 (tier cards + custom-only rule), #257 (current-plan card), #259 (set-tier Stripe guard), and the existing Stripe webhook (`handleSubscriptionEvent`) which reconciles the tier from a portal-routed switch **with no change**.

Two slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/in-app-plan-change`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale:

- **Slice 1** is the backend contract — the portal `flow_data`, `createPortal(tierSlug?)`, the optional `BillingPortalRequestSchema`, and the route/swagger. It's **backward-compatible**: bodyless `/portal` stays Manage, so the current frontend (bodyless `portal()`) keeps working and the tree stays green with no frontend change.
- **Slice 2** is the frontend — the subscribed-state grid + "Switch to this plan" + the SDK `portal({tier})`. It depends on slice 1's `BillingPortalRequest` type and the switch-enabled endpoint.

---

## Slice 1 — Backend: portal subscription-update flow + optional `tier`

Extend the portal session with `flow_data`, teach `createPortal` an optional `tierSlug`, add the optional request contract, and parse it in the route. Additive + backward-compatible.

**Files**

- Edit: `packages/core/src/contracts/billing.contract.ts` — add `BillingPortalRequestSchema = { tier?: string }` + type.
- Edit: `apps/api/src/services/stripe.service.ts` — `createPortalSession` gains optional `subscriptionUpdate` → emits `flow_data.subscription_update_confirm`.
- Edit: `apps/api/src/services/billing.service.ts` — `createPortal(org, callerUserId, tierSlug?)`: switch guards (has-subscription 409 → tier 404 → priced 400), `fetchSubscription` for the item id, build `subscriptionUpdate`.
- Edit: `apps/api/src/routes/billing.router.ts` — parse optional `BillingPortalRequestSchema` body (bodyless = Manage), pass `tier`; update `@openapi` (optional `requestBody`, +404/400).
- Edit: `apps/api/src/config/swagger.config.ts` — register `BillingPortalRequest` in `billingSchemas`.
- Edit tests: `packages/core/src/__tests__/contracts/billing.contract.test.ts`; `apps/api/src/__tests__/services/billing.service.endpoints.test.ts`; `apps/api/src/__tests__/__integration__/routes/billing.router.integration.test.ts`.

**Steps**

1. **Contract test (spec case 1).** `BillingPortalRequestSchema` parses `{ tier: "pro" }` and `{}`; rejects `{ tier: 1 }`. Run; fail → add the schema → green. Rebuild core (`npm run build --workspace=@portalai/core`) so `apps/api` sees the new type.
2. **Service tests (spec cases 2–6).** In `billing.service.endpoints.test.ts` (StripeService + repo mocked, mirroring the checkout tests): no-tier → `createPortalSession` called **without** `subscriptionUpdate` (Manage); `createPortal(tier)` on a subscribed org → resolves the price, calls `fetchSubscription`, passes `subscriptionUpdate`; no `stripeSubscriptionId` → 409; unknown/unselectable → 404, unpriced → 400; non-owner → 403, unconfigured → 503, Stripe throw → 502. Run; fail.
3. **Implement** `createPortalSession` `flow_data` + `createPortal(tierSlug?)`. Add `fetchSubscription` mock to the test's StripeService stub. Green 2–6.
4. **Route integration (spec cases 7–8).** `POST /portal` with `{ tier: PRO }` on a subscribed org → 200 `{ url }` (StripeService `createPortalSession` spied/stubbed to a URL); bodyless → 200; `{ tier: 5 }` → 400 `BILLING_INVALID_PAYLOAD`; anon → 401; non-owner → 403. Run; fail → parse body in the route + `@openapi` + register the swagger component. Green 7–8.
5. **Lint + type-check.** Clean. (Frontend untouched — bodyless `portal()` still compiles + works against the optional body.)

**Done when:** cases 1–8 pass; `POST /portal` accepts an optional `{ tier }` and opens the subscription-update flow; bodyless Manage unchanged; no frontend change yet.

**Risk:** the `flow_data` shape / `fetchSubscription` item-id assumption. Mitigation — the service test asserts the exact `subscriptionUpdate` args passed to `createPortalSession`; the empty-items case → 502 (case in step 3). Real portal-config acceptance is a smoke concern (Open Q1), not unit-testable here.

---

## Slice 2 — Frontend: subscribed-state grid + "Switch to this plan"

Render the plan grid in the subscribed state and add the owner-gated Switch CTA wired to `portal({tier})`. Depends on slice 1's contract + endpoint.

**Files**

- Edit: `apps/web/src/api/billing.api.ts` — `portal()` → `useAuthMutation<BillingPortalResponse, BillingPortalRequest>` (drop the bodyless override).
- Edit: `apps/web/src/components/TierCard.component.tsx` — `TierCardUIProps` gains `isSubscribed?`/`onSwitch?`; `cta === "subscribe" && !isCurrentPlan` renders **"Switch to this plan"** (→ `onSwitch`) when `isSubscribed`, else **"Subscribe"**.
- Edit: `apps/web/src/components/SubscriptionBilling.component.tsx` — render the grid for `unsubscribed` **and** `subscribed` (pass `isSubscribed` + `onSwitch`); keep Manage in the subscribed branch; the standalone #257 current-plan card block now guards on `state === "managed"` only; container `handleSwitch(slug)` → `portalMutation.mutateAsync({ tier: slug })` → redirect; `handleManage` → `mutateAsync({})`.
- Edit tests: `apps/web/src/__tests__/TierCard.component.test.tsx`; `apps/web/src/__tests__/SubscriptionBilling.component.test.tsx`.

**Steps**

1. **`TierCardUI` tests (spec cases 9–10).** `isSubscribed` + non-current subscribe tier → "Switch to this plan" (not "Subscribe"); click → `onSwitch(slug)`; non-owner → disabled + tooltip; current plan → chip no Switch; free (`none`) → no Switch; `contact` → mailto. Run; fail → add `isSubscribed`/`onSwitch` + CTA branch. Green 9–10.
2. **`SubscriptionBilling` tests (spec cases 11–12).** `SubscriptionBillingUI` subscribed → full grid (current flagged + Switch on the other paid tier) **and** Manage; `managed` → single current-plan card + banner (unchanged). Container: `handleSwitch` → `sdk.billing.portal().mutateAsync({ tier })` + redirect; `handleManage` → `mutateAsync({})` (mocked SDK). Run; fail.
3. **Implement** the subscribed-state grid render + `handleSwitch` + the SDK body change. Green 11–12.
4. **Manual check.** `npm run dev`; a subscribed org's billing tab shows the grid with "Switch to this plan" on the non-current paid tier + Manage.
5. **Lint + type-check.** Clean.

**Done when:** cases 9–12 pass; a subscribed org sees the switchable grid; Manage preserved; managed/unsubscribed unchanged.

**Risk:** demoting the #257 subscribed current-plan card into the grid could regress the #257 tests. Mitigation — the #257 subscribed card test becomes "current tier flagged within the grid"; the `managed` current-plan-card test stays; both updated in step 2.

---

## Sequence summary

| Slice | What lands | Spec cases | Test commands |
|---|---|---|---|
| 1 | portal `flow_data` + `createPortal(tierSlug?)` + `BillingPortalRequestSchema` + route/swagger | 1–8 | `packages/core` unit; `apps/api` unit + integration |
| 2 | subscribed-state grid + "Switch to this plan" + SDK `portal({tier})` | 9–12 | `apps/web` unit |

Total: **~12 spec cases** across two slices. No migration, no webhook change. Each slice is one commit on `feat/in-app-plan-change`; the PR grows commit-by-commit.

## Cross-slice notes

- **Backward-compat is what keeps slice 1 green without touching the frontend:** `/portal` parses an *optional* body, so the still-bodyless `portal()` from `main` works until slice 2 changes it. Order matters — contract (1) before consumer (2).
- **Rebuild `@portalai/core`** after slice 1's contract edit so `apps/api` (and slice 2's `apps/web`) compile against `BillingPortalRequest`.
- **No webhook change** — `handleSubscriptionEvent` already reconciles the tier from the portal-routed `customer.subscription.updated`. Do not touch it.
- **Doc-sync:** the `@openapi` block on `/portal` is the API's documented contract — update it in slice 1 (feeds `/api-docs`). No glossary/README/CLAUDE.md surface changes (no new user-facing concept or convention).
- **Smoke (the merge gate, later via `/smoke`)** must verify the app-dev Stripe **portal configuration** permits subscription updates for the tier products (Open Q1) — the one thing unit/integration tests can't cover.
- **No new dependency, env var, or `ApiCode`** — confirm `git diff package*.json` empty at the end.

## Next step

Implement **slice 1** first — tests-first, one commit per slice on `feat/in-app-plan-change` — only after discovery/spec/plan are reviewed and confirmed.
