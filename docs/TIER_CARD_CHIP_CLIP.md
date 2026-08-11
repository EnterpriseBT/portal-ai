# 'Current plan' chip clipping in the tier card — Condensed design (#357)

**Issue:** [EnterpriseBT/portal-ai#357](https://github.com/EnterpriseBT/portal-ai/issues/357) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** On **Settings → Subscriptions & Billing**, the tier card for the current plan shows a **"Current plan"** chip beside the plan title. On a narrow card (small screen, and worse with the sidebar expanded), the chip **clips past the card's right padding** — the key "which plan am I on" indicator is cut off on a revenue-facing screen. Single package: `apps/web`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Header row: title + "Current plan" chip | `apps/web/src/components/TierCard.component.tsx:145-152` | `<Stack direction="row" spacing={1} alignItems="center">` — **no wrap**; the title `<Typography>` has no shrink/ellipsis, so on a narrow card it takes the full width and pushes the `<Chip>` past the right padding, where it clips. |
| Rendered from | `apps/web/src/components/SubscriptionBilling.component.tsx` | The billing tab's tier-card grid. |

## Decision — wrap the header row

Add `flexWrap="wrap"` + `useFlexGap` to the header `Stack`. On a narrow card the chip **drops below the title** instead of clipping; on a wide card the layout is unchanged (title + chip on one line). `useFlexGap` is required so MUI's `spacing` renders as a CSS `gap` (which survives the wrap) rather than margins (which would leave the wrapped chip flush against the title).

Rejected the alternative (shrink the title with `minWidth: 0` + ellipsis): truncating the plan name is worse UX than wrapping the chip — the plan name is the more important text.

## Plan — 1 slice

**Files**
- Edit `apps/web/src/components/TierCard.component.tsx` — add `useFlexGap flexWrap="wrap"` to the title/chip `Stack` (`:145`).

**Tests** (`cd apps/web && npm run test:unit -- "TierCard"`)
- The existing `TierCard` suite (renders title + "Current plan" chip when current) stays green — the change is layout-only, so no new unit case (jsdom doesn't compute layout; the clip is visual, covered by the smoke below).

## Smoke (manual, against your dev stack)

1. `Settings → Subscriptions & Billing`. Ensure one tier card shows the **"Current plan"** chip (your org is on that tier).
2. **Narrow the viewport** to a small width **with the sidebar expanded** so the tier-card column is tight.
3. **Expected:** the "Current plan" chip stays fully visible — it **wraps below the plan title** when the card is too narrow for both on one line, never clipping past the right edge.
4. Widen back / collapse the sidebar: title + chip sit on **one line** as before (no regression on wide cards).

## Out of scope

- Any other billing-card responsive tweaks (price line, feature grid) — this is only the header title/chip clip.
