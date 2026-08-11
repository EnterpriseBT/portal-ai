# Tier card responsive fixes — Condensed design (#357, #359)

**Issues:** [#357](https://github.com/EnterpriseBT/portal-ai/issues/357) (chip clip) + [#359](https://github.com/EnterpriseBT/portal-ai/issues/359) (skinny cards) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc). Two cosmetic layout fixes on the same surface (Subscriptions & Billing tier cards), done together.

**Why.** On **Settings → Subscriptions & Billing**, two responsive layout problems, both worse with the sidebar expanded: **(#357)** the tier card for the current plan shows a **"Current plan"** chip beside the plan title that **clips past the card's right padding** on a narrow card — the "which plan am I on" indicator is cut off; **(#359)** the card grid renders **too many columns at ~900px** (`md` breakpoint → 3 columns) even when the sidebar has squeezed the container far narrower, so the **cards get too skinny**. Single package: `apps/web`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Header row: title + "Current plan" chip | `apps/web/src/components/TierCard.component.tsx:145-152` | `<Stack direction="row" spacing={1} alignItems="center">` — **no wrap**; the title `<Typography>` has no shrink/ellipsis, so on a narrow card it takes the full width and pushes the `<Chip>` past the right padding, where it clips. |
| Rendered from | `apps/web/src/components/SubscriptionBilling.component.tsx` | The billing tab's tier-card grid. |

| Card grid columns (#359) | `apps/web/src/components/SubscriptionBilling.component.tsx:20-26` | Viewport-breakpoint grid (`md`=900px → 3 columns). MUI breakpoints key off the **viewport**, not the container, so an expanded sidebar (narrows the container, not the viewport) still renders 3 skinny columns. |

## Decision — wrap the header row (#357) + container-responsive grid (#359)

- **#357:** add `flexWrap="wrap"` + `useFlexGap` to the header `Stack`. On a narrow card the chip **drops below the title** instead of clipping; wide cards unchanged. `useFlexGap` makes MUI `spacing` a CSS `gap` that survives the wrap. (Rejected shrinking the title with ellipsis — the plan name matters more than the chip.)
- **#359:** replace the viewport-breakpoint columns with `repeat(auto-fit, minmax(min(100%, 16rem), 1fr))`. The grid sizes to the **real container** (so the sidebar no longer starves it), keeps each card ≥16rem, and stays ≤4 across (the grid renders ≤4 cards — contact/custom tiers collapse to one), preserving the #241 cap.

## Plan — 1 slice

**Files**
- `apps/web/src/components/TierCard.component.tsx` — `useFlexGap flexWrap="wrap"` on the title/chip `Stack` (#357).
- `apps/web/src/components/SubscriptionBilling.component.tsx` — `CARD_GRID_COLUMNS` → the auto-fit string (#359).

**Tests** (`cd apps/web && npm run test:unit -- "TierCard|SubscriptionBilling"`)
- Existing suites stay green — both changes are layout-only, so no new unit case (jsdom doesn't compute layout; the visuals are covered by the smoke below).

## Smoke (manual, against your dev stack)

1. `Settings → Subscriptions & Billing` on a **non-contact tier** so the plan cards render, one showing the **"Current plan"** chip.
2. **Narrow the viewport to ~900px with the sidebar expanded** so the tier-card column is tight.
3. **#357:** the "Current plan" chip stays fully visible — it **wraps below the plan title** instead of clipping past the right edge.
4. **#359:** the cards stay a **comfortable width** — the grid drops to fewer columns as the container narrows (never 3 skinny columns), and widens further as you expand the sidebar / shrink the window.
5. Widen back / collapse the sidebar: title + chip on **one line**, up to 4 cards across — no regression on wide screens.

## Out of scope

- Other billing-card tweaks (price line, feature grid) — only the header chip clip + the grid column sizing.
