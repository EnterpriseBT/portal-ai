# Production tier catalog — Condensed design (#325)

**Issue:** [EnterpriseBT/portal-ai#325](https://github.com/EnterpriseBT/portal-ai/issues/325) · child of epic [#83](https://github.com/EnterpriseBT/portal-ai/issues/83) · Task · **small / condensed**.

**Why.** `tier-catalog.ts` carries **test-grade** magnitudes by its own admission — `pro`'s metered allocation is `null` (unlimited) "so no denial interrupts manual testing". That is fine for a sandbox and wrong for a live account taking money. This ticket replaces them with production allocations. **It sets no prices**: amounts live in Stripe, resolved by lookup key, never committed here.

## Current shape

| Tier | metered / period | expensive / period | metered/min | expensive/min | packs | custom packs |
|---|---|---|---|---|---|---|
| `standard` | 500 | 20 | 10 | 2 | 2 | no |
| `plus` | 5,000 | 200 | 60 | 10 | 4 | no |
| `pro` | **null** | 1,000,000 | **null** | 10,000 | all | yes |
| `enterprise` | null | null | null | null | all | yes |

Three facts that shape the numbers:

- **Allocations are a backstop, not the product lever.** Tiering is capability-based — which built-in toolpacks you get, and whether you may register custom ones. The core query/visualise/refresh loop is never charged. So an allocation exists to bound a runaway loop or an abuse case, not to meter ordinary use.
- **`expensive` maps to a bill we actually pay** — Tavily for `web_search`, Mapbox for geocoding. `bulk_geocode_records` charges **one unit per newly-geocoded row** (cache hits and failures are free), so a single call can consume a large slice of a period's allocation.
- **The two limits bound different things.** `…UnitsPerPeriod` bounds the monthly vendor bill; `…RatePerMin` bounds how fast it can be run up. A rate limit counts *calls*, not units — one bulk geocode is one call charging N units — so the rate never substitutes for the quota.

## Decision — production allocations

| Tier | metered / period | expensive / period | metered/min | expensive/min |
|---|---|---|---|---|
| `standard` | 500 | **100** | 10 | 2 |
| `plus` | 5,000 | **2,000** | 60 | 10 |
| `pro` | **50,000** | **20,000** | **120** | **30** |
| `enterprise` | null | null | null | null |

**`pro` gets finite ceilings.** Unlimited metered on a fixed monthly price is an unbounded Anthropic bill — one looping agent, no server-side stop. 50,000 calls per period is far beyond any real workload while still being a ceiling. The same argument applies to `pro.meteredRatePerMin`, `null` today: without it, a runaway loop burns the entire period allocation in seconds, so the quota bounds the bill and the rate bounds the blast speed. Both are needed.

**`pro.expensiveRatePerMin` drops from 10,000 to 30.** Ten thousand Tavily or Mapbox calls in one minute is not a limit; it is the absence of one.

**`expensive` scales up across the board** because the current numbers make geocoding unusable: `plus`'s 200 is exhausted by one bulk geocode of a 200-row column, and `standard`'s 20 means the feature effectively does not exist on free. 100 / 2,000 / 20,000 lets a realistic column through on a paid tier while keeping every tier's vendor exposure bounded.

**`enterprise` keeps `null`, deliberately.** It is the generic public *contact* card, not a tier orgs self-serve onto; a real enterprise deal gets an org-scoped custom tier (#241) with negotiated numbers. Worth knowing it is a footgun if anyone ever assigns an org to the generic row — flagged rather than silently changed, because changing it would misrepresent what the row is for.

**Toolpack entitlements are unchanged.** 2 / 4 / all + custom already expresses the capability tiering; nothing about go-live argues for moving it.

## Plan — 1 slice

- **Tests** — `packages/core/src/__tests__/registries/tier-catalog.test.ts` already pins each tier's fields exactly (`standard` at `:37-50`, `plus` at `:59-60`, `enterprise` at `:79-85`), so **the existing assertions go red on their own** the moment the numbers change; update them to the table above. Then add what they do not yet cover:
  - every tier's `meteredUnitsPerPeriod` and `meteredRatePerMin` is non-null **except `enterprise`** — the assertion that pins the removal of the test-grade unlimiteds, and the one that would catch them creeping back;
  - `expensiveUnitsPerPeriod` is strictly ascending across `standard < plus < pro`;
  - no `selectable` tier has an unlimited allocation — the invariant behind both, stated once so a fifth tier inherits it.
  Run; fail.
- **Files**: `packages/core/src/registries/tier-catalog.ts` — the six changed numbers, and the doc-comment's "test-grade magnitudes" paragraph rewritten to describe production intent and the backstop-not-lever reasoning.
- Green, then `npm run lint && npm run type-check`.

Amounts are **not** in this slice. The live products and prices already exist; setting their amounts is a Stripe act, followed by `portalops tier apply --env prod --yes --confirm-prod` to converge the rows onto the live price ids.

## Smoke (manual)

Rolls into the epic-level walk (#83).

1. `portalops tier apply --env prod --yes --confirm-prod` reports the paid rows converged onto **live-mode** price ids.
2. `curl https://api.portalsai.io/api/public/site-config` returns the four tiers with the production allocations.
3. Settings plan cards on `app.portalsai.io`, and `www.portalsai.io/pricing/`, render the live figures.
4. On a `standard` org, exhaust `expensive` (101 geocoded rows) → the tool returns a typed `TOOL_USAGE_QUOTA_EXCEEDED` **result**, relayed by the agent, not a crash.
5. A `free`-class tool still works on an exhausted org — `free` is never charged, never denied.
6. Changing a price amount in Stripe and re-running `tier apply` updates the cards with no code change.

## Out of scope

- **Price amounts.** Stripe is the record of truth; the repo holds lookup keys only. Changing an amount means creating a new price and transferring the lookup key to it, then re-running `tier apply`.
- **Optimizing the economics.** These allocations are sized as *safety ceilings* — high enough that no legitimate workload meets them, low enough to bound a runaway loop or an abuse case. They are deliberately **not** tuned for margin against projected per-tier cost. A separate ticket owns that pass, and it starts from a defensible baseline rather than from `null`. What it will want that does not exist yet: real per-org consumption data from the usage ledger, and a per-unit cost model for Anthropic / Tavily / Mapbox.
- **New tiers or a new pricing model** (usage-based, overage) beyond the existing four-tier shape.
- **Per-tool caps** (`perToolCaps` is `null` on every tier) — a finer-grained lever than this ticket needs.
- The `enterprise` row's allocations (see the Decision).
