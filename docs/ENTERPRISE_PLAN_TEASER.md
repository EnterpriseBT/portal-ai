# Enterprise plan teaser card — Condensed design (#265)

**Issue:** [EnterpriseBT/portal-ai#265](https://github.com/EnterpriseBT/portal-ai/issues/265) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The Enterprise (`cta: "contact"`) plan card, shown as an *upgrade teaser* to any org not on a custom plan, renders only a generic "Enterprise" title, the line "Custom pricing", and a bare "Contact support" mailto — sparse next to the fully-detailed Standard/Plus/Pro cards, so the highest-value plan reads as an afterthought. This chore fleshes out the teaser: a centered icon, an explanation of what "Custom pricing" means (tailored allocations/entitlements, not a fixed self-serve plan), and a supporting line under the "Contact support" link. Purely presentational, `apps/web` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Teaser branch | `apps/web/src/components/TierCard.component.tsx:85` | `isContactTeaser = cta === "contact" && !isCurrentPlan`; sets `showGrid=false`, generic title |
| Price line | `TierCard.component.tsx:89` | `cta === "contact"` → `"Custom pricing"` |
| Contact link | `TierCard.component.tsx:195` | `<Link href={SUPPORT_MAILTO}>` — teaser text is exactly `"Contact support"` |
| Generic label | `TierCard.component.tsx:33` | `GENERIC_CONTACT_TIER_LABEL = "Enterprise"` |
| Support mailto | `apps/web/src/utils/tier-format.util.ts:16` | `SUPPORT_MAILTO` (unchanged) |
| Teaser test (case 24) | `apps/web/src/__tests__/TierCard.component.test.tsx:161` | asserts generic label, no grid, `link name /^contact support$/i` |

## Decision — flesh the teaser inside the existing `isContactTeaser` branch

Keep all changes inside the `isContactTeaser` block of `TierCardUI` — no new component, no prop, no contract touch. When `isContactTeaser` is true, render, in the card's content column:

1. A **centered decorative icon** — MUI `WorkspacePremium` (from `@mui/icons-material`), `color="primary"`, ~40px, `aria-hidden` (decorative). Centered above/around the title.
2. The generic **"Enterprise"** title + **"Custom pricing"** price line (as today).
3. A short **explanation** `Typography` (body2, secondary): custom pricing = allocations, entitlements, and support tailored to your organization rather than a fixed self-serve plan.
4. The **"Contact support"** `Link` (text unchanged, so the case-24 anchored regex still matches) with a supporting `Typography` line beneath: reach out to our team to scope a plan for your volume and needs.

The on-plan custom card (`isCurrentPlan`, `showGrid=true`) is untouched — icon/teaser copy live only in the `isContactTeaser` branch. The `#260` flex-column bottom-alignment (icon+copy in the scrolling content, CTA pinned in the trailing `mt:auto` box) is preserved. `WorkspacePremium` chosen over `Diamond` as the more "premium/enterprise" read; both are available in `@mui/icons-material`.

## Plan — 1 slice

**Files**

- Edit: `apps/web/src/components/TierCard.component.tsx` — import `WorkspacePremium` from `@mui/icons-material`; in the `isContactTeaser` branch render centered icon + explanation copy + supporting line under the unchanged "Contact support" link.
- Edit: `apps/web/src/__tests__/TierCard.component.test.tsx` — extend case 24 to assert the icon renders (`svg` / testid), the explanation copy is present, and the existing generic-label / no-grid / `^contact support$` link assertions still hold. Add an assertion the icon/explanation do **not** appear on the `isCurrentPlan` contact card (case 25 region).

**Tests** (from `apps/web`, never raw jest)

- `npm run test:unit -- TierCard`
- `npm run lint && npm run type-check` at the slice boundary.

## Smoke (manual, against your dev stack)

1. `npm run dev`; open **Settings → Subscription & Billing** as an org **not** on a custom plan (e.g. the local `bbgrabbag` org on Standard/Plus/Pro).
2. The **Enterprise** card shows: a centered icon, the "Enterprise" title, a "Custom pricing" line with an explanation sentence, and a "Contact support" link with a supporting line beneath it. It no longer looks empty next to the priced cards and its CTA stays bottom-aligned.
3. Click **Contact support** → opens the `SUPPORT_MAILTO` mail draft (unchanged).
4. Confirm no horizontal scroll at narrow/mid/wide widths; the card sits in the responsive grid with the others.
5. (If you have a custom-plan org, e.g. `acme_enterprise` visible-to that org) confirm the *current-plan* custom card still shows its real policy grid and specific name — **no** teaser icon/explanation copy.

## Out of scope

- The on-plan (current custom plan) card layout — only the generic upgrade teaser is touched.
- Any change to `cta` semantics, the billing contract, or `SUPPORT_MAILTO`'s destination.
- Per-operator customizable teaser copy — the expanded text is static.
