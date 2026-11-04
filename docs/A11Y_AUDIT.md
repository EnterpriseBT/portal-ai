# Accessibility audit inventory

Every accessibility finding in Portals AI against **WCAG 2.2 AA**, mapped to a success criterion, to where it was seen (role, state, theme), and to the child of epic [#791](https://github.com/EnterpriseBT/portal-ai/issues/791) that owns the fix. It is the working list the area children (#793–#798) fix from, and the evidence the Accessibility Conformance Report (#800) is written from.

**Lifecycle.** This doc is durable for the life of the epic. It has no phase suffix, so a child's `/discovery` sweep leaves it alone. At close-out, #800 folds it into the ACR or deletes it.

## How it's produced

The section between the markers below is **generated**. Never edit it by hand: run `npm run a11y:report` and commit the result. That command:

1. Runs three report-only tools. Each writes raw results to a gitignored `a11y-results/` directory in its package:

| Tool | Script | Packages | Sees |
|---|---|---|---|
| `eslint-plugin-jsx-a11y` (strict) | `a11y:lint` | web, core, site | JSX and `.astro` source |
| `jest-axe` over every Storybook story | `a11y:stories` | web, core | each UI component in jsdom (no contrast, no landmarks) |
| axe in Playwright | `a11y:axe`, `a11y:axe:site` | e2e | every app route × owner/admin/member × populated/empty/error/loading/locked × both themes; every site page × both themes |

2. Runs `npm run a11y:inventory` (`scripts/a11y-inventory.mjs`), which normalizes the findings, assigns criteria and owners, and rewrites the generated section.

**Preconditions:**
- the dev stack is running;
- `npm run --workspace @portalai/e2e e2e:seed` and `e2e:auth:all` have been run;
- the marketing site is built and previewed on :3002.

The details are in `packages/e2e/README.md` → "Accessibility audit".

A run fails on a setup problem, never on findings: a missing result, a tool with no successful run, an unmapped rule. An empty report isn't a clean one.

The **Keyboard pass** and **Screen-reader pass** sections after the generated section are hand-written. The generator never touches them; it only counts their rows per owner.

<!-- a11y-inventory:start -->
_Not generated yet: run `npm run a11y:report`._
<!-- a11y-inventory:end -->

## Keyboard pass

Walked keyboard-only (no pointer), as owner and as member, through Playwright. Every flow is checked against:
- 2.1.1 keyboard
- 2.1.2 no keyboard trap
- 2.4.3 focus order
- 2.4.7 focus visible
- 2.4.11 focus not obscured
- 2.5.7 dragging movements
- 2.5.8 target size
- 3.3.7 redundant entry
- 3.3.8 accessible authentication

The flows:
1. Sign-in
2. CSV import → records
3. Station → portal → pin
4. A curated view
5. Settings → Members
6. Marketing site: home → pricing → contact

| ID | Flow | Step | WCAG | Observed | AT | Owner |
|---|---|---|---|---|---|---|

## Screen-reader pass

The script for each of the flows above is walked with **VoiceOver + Safari** (macOS) and **NVDA + Firefox** (Windows).

| ID | Flow | Step | WCAG | Observed | AT | Owner |
|---|---|---|---|---|---|---|
