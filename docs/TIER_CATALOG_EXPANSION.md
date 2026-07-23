# Expand tier catalog to Standard/Plus/Pro/Enterprise — Condensed design (#263)

**Issue:** [EnterpriseBT/portal-ai#263](https://github.com/EnterpriseBT/portal-ai/issues/263) · Feature · **small / condensed**.

**Why.** The catalog defines only Standard (free) + Pro (paid) — one purchasable tier, so #260's in-app switch has no target. Add **Plus** (paid) and a public **Enterprise** (`contact`) so the self-serve lineup is four and switching is real. Test-grade values (refine later); pricing lives in Stripe. Touches `packages/core` (catalog + test); the Stripe products, `tier apply`, and portal config are operational steps against the two sandboxes.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Catalog | `packages/core/src/registries/tier-catalog.ts` | `standard` + `pro` only; entries carry `cta` + `stripeLookupKey` (#241) |
| Catalog pin test | `packages/core/src/__tests__/registries/tier-catalog.test.ts` | pins `standard`/`pro` field values + the field-mirror |
| Convergence | `packages/devops-cli` `tier apply` | resolves `stripeLookupKey` → env price; fail-closed on a missing price |
| Cta/price DB guard | `tiers_cta_price_check` (#241) | `cta='subscribe'` ⇒ a price must resolve → create Stripe prices **before** `tier apply` |

## Decision — four catalog tiers, ascending, Pro maxed

Add `plus` (`cta: subscribe`, lookup `plus_monthly`) and `enterprise` (`cta: contact`, no price, `selectable`, public — the generic "contact sales" card; the per-client custom tiers of #241 are unchanged and coexist). Retune `standard` to a real entry tier and keep `pro` as the top self-serve with **everything allowed + generous** allocations.

| slug | cta | lookup | free | metered (units/rate) | expensive (units/rate) | builtin packs | custom |
|---|---|---|---|---|---|---|---|
| standard | none | — | ∞ | 500 / 10 | 20 / 2 | data_query, web_search | no |
| plus | subscribe | plus_monthly | ∞ | 5 000 / 60 | 200 / 10 | data_query, statistics, web_search, entity_management | no |
| pro | subscribe | pro_monthly | ∞ | ∞ | 1 000 000 / 10 000 | **all 6** | **yes** |
| enterprise | contact | — | ∞ | ∞ | ∞ | all 6 | yes |

`∞` = `null` (unlimited). `overage: hard-deny`, monthly/anchor 1 for all. Pro keeps `expensive` finite-but-huge (bounds Tavily/`web_search` cost even under a generous quota — the existing QA posture); Enterprise is negotiated → unlimited.

## Plan — 1 code slice + operational rollout

**Code (slice — commit on this branch)**
- Edit: `packages/core/src/registries/tier-catalog.ts` — the four entries above.
- Edit: `packages/core/src/__tests__/registries/tier-catalog.test.ts` — repin `standard` (new modest values), add `plus`/`enterprise` assertions, keep the field-mirror + frozen checks.
- `npm run build --workspace=@portalai/core` (devops-cli + api read the built catalog).

**Tests** (`cd packages/core && npm run test:unit -- tier-catalog`): every entry parses; four slugs unique; `standard`/`plus`/`pro`/`enterprise` carry the table's values; `pro` has all packs + `customToolpacks: true`; `enterprise.cta === "contact"` + `stripeLookupKey === null`.

**Operational rollout (per env: local, app-dev — done while walking, not code)**
1. Create Stripe **products + recurring prices** for Plus and Pro carrying lookup keys `plus_monthly` / `pro_monthly` (reuse an existing `pro_monthly` price if present).
2. `DATABASE_URL=… STRIPE_SECRET_KEY=… npx portalops tier apply --env <env>` → converges all four rows (fail-closed if a price is missing).
3. Stripe **customer-portal** config: enable "switch plans" + allow-list the Plus/Pro products (so #260's `subscription_update_confirm` works).

## Smoke (manual, against your dev stack)

1. `npm run build --workspace=@portalai/core`; `tier apply --env local`; `db:studio` → `tiers` has 4 rows, `plus`/`pro` with non-null `stripe_price_id`, `enterprise` `cta=contact`/no price.
2. Billing tab (unsubscribed org) shows **four** cards: Standard (Free), Plus (priced + Subscribe), Pro (priced + Subscribe), Enterprise (Contact support).
3. Repeat `tier apply --env app-dev`; confirm four rows there too.
4. (Feeds #260) with the portal configured, a subscribed org can Switch between Plus and Pro.

## Out of scope

- Production pricing/allocations — test placeholders (refine later).
- The #260 switch mechanism (shipped separately; this unblocks its smoke).
- Per-client custom tiers (#241) — unchanged.
