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

Coverage shows when each result file was written. If they span more than two hours, a warning says so: those results weren't one `a11y:report` run, so they aren't one audit of one tree.

The **Keyboard pass** and **Screen-reader pass** sections after the generated section are hand-written. The generator never touches them; it only counts their open rows per owner. A row is closed by starting its Observed cell with "**Closed:**", saying what fixed it.

<!-- a11y-inventory:start -->
## Coverage

| Result file | Tool | Version | Ran (UTC) | Runs ok | Skipped |
|---|---|---|---|---|---|
| `apps/web/a11y-results/eslint.json` | eslint | — | 2026-11-07 18:58 | 904 | 0 |
| `apps/web/a11y-results/stories.json` | jest-axe | 4.14.0 | 2026-11-07 19:03 | 281 | 5 |
| `packages/core/a11y-results/eslint.json` | eslint | — | 2026-11-07 18:58 | 326 | 0 |
| `packages/core/a11y-results/stories.json` | jest-axe | 4.14.0 | 2026-11-07 19:03 | 177 | 0 |
| `apps/site/a11y-results/eslint.json` | eslint | — | 2026-11-07 18:58 | 31 | 0 |
| `packages/e2e/a11y-results/app.json` | axe-app | 4.14.0 | 2026-11-07 19:36 | 426 | 60 |
| `packages/e2e/a11y-results/site.json` | axe-site | 4.14.0 | 2026-11-07 19:37 | 24 | 0 |

Skipped runs (not audited; each is a coverage gap until it renders):

- `apps/web/a11y-results/stories.json` · apps/web/src/stories/FAQList.component.stories.tsx › Default: Cannot read properties of undefined (reading 'has')
- `apps/web/a11y-results/stories.json` · apps/web/src/stories/FAQList.component.stories.tsx › FilteredToJobs: Cannot read properties of undefined (reading 'has')
- `apps/web/a11y-results/stories.json` · apps/web/src/stories/FAQList.component.stories.tsx › GroupedByCategory: Cannot read properties of undefined (reading 'has')
- `apps/web/a11y-results/stories.json` · apps/web/src/stories/GlossaryList.component.stories.tsx › Default: Cannot read properties of undefined (reading 'has')
- `apps/web/a11y-results/stories.json` · apps/web/src/stories/GlossaryList.component.stories.tsx › FilteredToAnalytics: Cannot read properties of undefined (reading 'has')
- `packages/e2e/a11y-results/app.json` · entity-group-detail · owner · populated · brand: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · owner · error · brand: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · owner · loading · brand: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · owner · populated · brand: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · owner · error · brand: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · owner · loading · brand: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · owner · populated · brand: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · owner · error · brand: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · owner · loading · brand: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · owner · populated · brand.dark: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · owner · error · brand.dark: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · owner · loading · brand.dark: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · owner · populated · brand.dark: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · owner · error · brand.dark: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · owner · loading · brand.dark: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · owner · populated · brand.dark: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · owner · error · brand.dark: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · owner · loading · brand.dark: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · admin · populated · brand: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · admin · error · brand: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · admin · loading · brand: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · admin · populated · brand: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · admin · error · brand: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · admin · loading · brand: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · admin · populated · brand: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · admin · error · brand: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · admin · loading · brand: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · admin · populated · brand.dark: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · admin · error · brand.dark: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · admin · loading · brand.dark: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · admin · populated · brand.dark: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · admin · error · brand.dark: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · admin · loading · brand.dark: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · admin · populated · brand.dark: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · admin · error · brand.dark: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · admin · loading · brand.dark: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · member · populated · brand: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · member · error · brand: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · member · loading · brand: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · portal · member · populated · brand: nothing to drill into at step 2: /api/portals on /stations/5a26b111-c344-41bc-ad44-6414edd439eb returned no item
- `packages/e2e/a11y-results/app.json` · portal · member · error · brand: nothing to drill into at step 2: /api/portals on /stations/5a26b111-c344-41bc-ad44-6414edd439eb returned no item
- `packages/e2e/a11y-results/app.json` · portal · member · loading · brand: nothing to drill into at step 2: /api/portals on /stations/5a26b111-c344-41bc-ad44-6414edd439eb returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · member · populated · brand: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · member · error · brand: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · member · loading · brand: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · member · populated · brand: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · member · error · brand: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · member · loading · brand: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · member · populated · brand.dark: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · member · error · brand.dark: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · member · loading · brand.dark: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · portal · member · populated · brand.dark: nothing to drill into at step 2: /api/portals on /stations/5a26b111-c344-41bc-ad44-6414edd439eb returned no item
- `packages/e2e/a11y-results/app.json` · portal · member · error · brand.dark: nothing to drill into at step 2: /api/portals on /stations/5a26b111-c344-41bc-ad44-6414edd439eb returned no item
- `packages/e2e/a11y-results/app.json` · portal · member · loading · brand.dark: nothing to drill into at step 2: /api/portals on /stations/5a26b111-c344-41bc-ad44-6414edd439eb returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · member · populated · brand.dark: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · member · error · brand.dark: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · member · loading · brand.dark: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · member · populated · brand.dark: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · member · error · brand.dark: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · member · loading · brand.dark: nothing to drill into at step 1: /api/curated-views on /views returned no item

## Summary

Each row below is one rule on one element, wherever it was seen: **Where** lists the routes, stories or lines, and **Instances** counts every sighting.

| Owner | Rows | Instances | WCAG criteria | Keyboard / screen-reader findings |
|---|---|---|---|---|
| [#793 Dialogs and forms](#owner-793) | 0 | 0 | — | 0 |
| [#794 Tables, grids and lists](#owner-794) | 5 | 18 | — | 2 |
| [#795 RegionEditor spreadsheet canvas](#owner-795) | 13 | 51 | 4.1.2 | 1 |
| [#796 Maps and charts](#owner-796) | 0 | 0 | — | 1 |
| [#797 App shell, navigation and landmarks](#owner-797) | 0 | 0 | — | 0 |
| [#798 Marketing site](#owner-798) | 0 | 0 | — | 1 |
| Unassigned | 0 | 0 | — | 0 |

<a id="owner-793"></a>

## #793 Dialogs and forms

No automated findings.

<a id="owner-794"></a>

## #794 Tables, grids and lists

| ID | WCAG | Rule | Impact | Element | Where | Instances | Seen | Tool |
|---|---|---|---|---|---|---|---|---|
| cce6c08c | best practice | heading-order | moderate | `.MuiPaper-outlined.MuiPaper-rounded.MuiCard-root > .MuiStack-root > .MuiCardActionArea-root > .MuiCardContent-root > .MuiStack-root > .MuiStack-root > h3` | 4: column-definitions, connectors, entities, jobs | 4 | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| e86a6bdc | best practice | heading-order | moderate | `apps/web/src/stories/CuratedViewDetail.view.stories.tsx h6` | 1: Empty | 1 | — | jest-axe |
| 8c7e8755 | best practice | heading-order | moderate | `h3` | 1: stations | 1 | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 1a851f7c | best practice | heading-order | moderate | `h6` | 11: column-definition-detail, column-definitions, connectors, entities, entity-groups, jobs, +5 more | 11 | roles: admin, member, owner · states: empty, locked, populated · themes: brand, brand.dark | axe-app |
| 53f149ff | best practice | jsx-a11y/no-autofocus | — | `apps/web/src/components/PaginationToolbar.component.tsx` | 1: :747 | 1 | — | eslint |

<a id="owner-795"></a>

## #795 RegionEditor spreadsheet canvas

| ID | WCAG | Rule | Impact | Element | Where | Instances | Seen | Tool |
|---|---|---|---|---|---|---|---|---|
| 2345f6f1 | 4.1.2 | aria-prohibited-attr | serious | `apps/web/src/modules/RegionEditor/stories/BindingEditorPopover.stories.tsx` | 6: EnumColumn, ExcludedState, NormalizedKeyValidationError, ReferenceColumn, ServerErrorAlert, StringColumn | 6 | — | jest-axe |
| 23a381c2 | 4.1.2 | aria-prohibited-attr | serious | `apps/web/src/modules/RegionEditor/stories/RegionDrawingStep.stories.tsx` | 5: CrosstabSelected, DriftSeeded, MessyPipelineSkipRules, MessyQuartersSkipRules, WithProposedRegions | 5 | — | jest-axe |
| 5292aa4d | 4.1.2 | aria-prohibited-attr | serious | `apps/web/src/modules/RegionEditor/stories/RegionDrawingStep.stories.tsx div[data-corner-header]` | 7: CrosstabSelected, DriftSeeded, Empty, Interactive, MessyPipelineSkipRules, MessyQuartersSkipRules, +1 more | 7 | — | jest-axe |
| e0d4f664 | 4.1.2 | aria-prohibited-attr | serious | `apps/web/src/modules/RegionEditor/stories/RegionEditor.stories.tsx` | 1: ModeB_DriftHalt | 1 | — | jest-axe |
| 1741e9ce | 4.1.2 | aria-prohibited-attr | serious | `apps/web/src/modules/RegionEditor/stories/RegionEditor.stories.tsx div[data-corner-header]` | 3: Interactive, ModeA_Empty, ModeB_DriftHalt | 3 | — | jest-axe |
| 1d220399 | 4.1.2 | aria-prohibited-attr | serious | `apps/web/src/modules/RegionEditor/stories/SheetCanvas.stories.tsx div[data-corner-header]` | 8: CrosstabSheet, DriftHighlighted, Empty, InteractiveDrawing, MessyPipelineSkipRules, MessyQuartersSkipRules, +2 more | 8 | — | jest-axe |
| de9c47a9 | 4.1.2 | aria-prohibited-attr | serious | `apps/web/src/workflows/FileUploadConnector/stories/FileUploadConnectorWorkflow.stories.tsx` | 2: Step1_InvalidRegion, Step1_RegionsDrawn_Valid | 2 | — | jest-axe |
| bb99c709 | 4.1.2 | aria-prohibited-attr | serious | `apps/web/src/workflows/FileUploadConnector/stories/FileUploadConnectorWorkflow.stories.tsx div[data-corner-header]` | 3: Step1_Empty, Step1_InvalidRegion, Step1_RegionsDrawn_Valid | 3 | — | jest-axe |
| 7273f52e | 4.1.2 | aria-prohibited-attr | serious | `apps/web/src/workflows/FileUploadConnector/stories/FileUploadRegionDrawingStep.stories.tsx` | 3: InvalidRegion_AttemptedInterpret, OneRegion_Valid, ServerError | 3 | — | jest-axe |
| 864ce79f | 4.1.2 | aria-prohibited-attr | serious | `apps/web/src/workflows/FileUploadConnector/stories/FileUploadRegionDrawingStep.stories.tsx div[data-corner-header]` | 5: Empty, InvalidRegion_AttemptedInterpret, MultipleRegions_MergedEntity, OneRegion_Valid, ServerError | 5 | — | jest-axe |
| fd0eeb17 | 4.1.2 | jsx-a11y/no-noninteractive-element-interactions | — | `apps/web/src/modules/RegionEditor/RegionDrawingStep.component.tsx` | 1: :387 | 1 | — | eslint |
| 424ee260 | 4.1.2 | jsx-a11y/no-noninteractive-element-interactions | — | `apps/web/src/modules/RegionEditor/ReviewStep.component.tsx` | 1: :509 | 1 | — | eslint |
| 0182bd69 | best practice | aria-allowed-role | minor | `apps/web/src/modules/RegionEditor/stories/BindingEditorPopover.stories.tsx form` | 6: EnumColumn, ExcludedState, NormalizedKeyValidationError, ReferenceColumn, ServerErrorAlert, StringColumn | 6 | — | jest-axe |

<a id="owner-796"></a>

## #796 Maps and charts

No automated findings.

<a id="owner-797"></a>

## #797 App shell, navigation and landmarks

No automated findings.

<a id="owner-798"></a>

## #798 Marketing site

No automated findings.

<a id="owner-unassigned"></a>

## Unassigned

No automated findings.
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

**Walked 2026-11-04**, keyboard only, in Chromium 1280×720 against the local stack and the `e2e-fixture` org (demo-seeded). The app was walked as owner and as member, the sign-in page and marketing site signed out. Tab order, focus indicators and obscured focus were recorded by script, with screenshots, and judged by eye. "Verify" marks a finding inferred from code that the owning child confirms before fixing.

**Checked and passing:**
- **No keyboard traps (2.1.2).** Every walked page's tab order completed a full cycle.
- **Dialogs keep focus (2.4.3).** New Station and Create View open from the keyboard, move focus into the dialog, and return it to their button on Escape.
- **Text fields show focus (2.4.7).** They get a clear ring.
- **The marketing site's skip link is the first stop (2.4.1).**
- **No obscured focus on the site (2.4.11).** The script flagged covered elements, but that came from sampling during a smooth scroll; the screenshots show nothing covered.

**Not exercised here:**
- **Redundant entry (3.3.7):** the import workflow is multi-step, so the screen-reader script walks it end to end.
- **Accessible authentication (3.3.8):** sign-in hands off to Google or Auth0, and our own page asks for no cognitive test.

**Maps and charts weren't reached:** the fixture org has no portal or pinned result (see Coverage).

| ID | Flow | Step | WCAG | Observed | AT | Owner |
|---|---|---|---|---|---|---|
| KB-01 | All app pages | first Tab | 2.4.1 | **Closed:** every layout starts with a "Skip to main content" link into `main#main-content` (#797, 25f32b83). Re-walked 2026-11-05, owner and member, both themes. List pages no longer auto-focus their search (KB-02, #988). | keyboard | #797 |
| KB-02 | Station → portal → pin; CSV import → records; Curated view | page load | 2.4.3 | **Closed:** `PaginationToolbar`'s search no longer has `autoFocus`, so a list page opens on its `h1`, as the route announcer sets it (#797), and the field is named "Search" (#988). Was: list pages auto-focused the Search field on load (also jsx-a11y `no-autofocus`), so the first Tab landed in the list, and the header and navigation came only after the page content. | keyboard | #988 |
| KB-03 | All app pages | sidebar | 4.1.2, 2.4.4 | **Closed:** sidebar entries are named links, collapsed ones by `aria-label` and a tooltip, with `aria-current` on the current page (#797, 25f32b83). Re-walked 2026-11-05: 13 links for owner, 7 for member, none unnamed. | keyboard | #797 |
| KB-04 | All app pages | header | 2.4.7 | **Closed:** the theme draws a 2px `primary.main` focus ring on every control (#797, 074eb99f). Re-walked 2026-11-05 in both themes. | keyboard | #797 |
| KB-05 | All app pages | sidebar | 2.4.7 | **Closed:** sidebar entries get the same 2px focus ring (#797, 074eb99f). Re-walked 2026-11-05 in both themes. | keyboard | #797 |
| KB-06 | All app pages | sidebar | 2.5.8 | **Closed:** the 16 px toggle answers clicks over 24 px (#797, 25f32b83). Re-walked 2026-11-05: clicks 3 px outside on either side hit it. | keyboard | #797 |
| KB-07 | CSV import → records | records table | 2.5.7 | Column reorder is a drag. dnd-kit's keyboard sensor exists, but there's no single-pointer alternative (verify). | inspection | #794 |
| KB-08 | CSV import → records | layout plan | 2.5.7 | Drawing a region in the RegionEditor takes a pointer drag. Typed bounds exist only for a region already drawn (verify). | inspection | #795 |
| KB-09 | Station → portal → pin | chart result | 1.1.1, 4.1.2 | D3 charts render inside a sandboxed iframe that axe can't enter. There's no text alternative contract for a chart's content. | inspection | #796 |
| KB-10 | Marketing site | header and footer nav | 2.5.8 | Nav links are 19 px tall. Check whether the spacing exception holds (verify). | keyboard | #798 |

## Screen-reader pass

Walk each flow below twice:
- **VoiceOver + Safari** on macOS: VO = Ctrl+Option. Open the rotor with VO+U to list landmarks, headings and links.
- **NVDA + Firefox** on Windows: browse mode is the default. H moves by heading, D by landmark, Tab by control, and Insert+F7 lists elements.

Use the local stack, signed in as the e2e owner (`e2e-fixture` org). Flow 5 is also walked as the member.

Each step says what you **do** and what you should **hear**. Anything you hear that differs, or anything you can't do without the mouse, is a finding. Record it in the table at the end as `SR-nn`, with the flow and step number, the AT you heard it with, and the owner: the area child that owns that part of the UI. If you're unsure of the owner, write `?` and it gets triaged. Two habits help:
- **Note when each page's title is announced.** A route change that announces nothing is a finding (2.4.2, 4.1.3).
- **Note when a toast or status change is announced.** Success and error toasts, job progress and lock alerts should be heard without moving focus to them (4.1.3).

### 1. Sign-in (`/login`, signed out)

| Step | Do | Expect to hear |
|---|---|---|
| 1 | Load `/login` | The page title, then a level-1 heading naming the page |
| 2 | List landmarks (rotor / D) | At least a main region; no unlabelled duplicate regions |
| 3 | Tab through every control | Each sign-in option as a **button** with a name naming its provider; Terms and Privacy as **links** |
| 4 | Activate the Google option | Navigation to the provider (stop here; the provider's page isn't ours) |

### 2. CSV import → records

| Step | Do | Expect to hear |
|---|---|---|
| 1 | Go to Connectors | The page title; "Connectors" level-1 heading; the Connected / Catalog tabs as a **tab list** with the selected tab announced |
| 2 | Open the Catalog tab and start a File Upload connector | A **dialog** announced with its name; focus inside it |
| 3 | Choose `packages/e2e/src/fixtures/core-loop.csv` from the file field | The field's label; the chosen file's name after picking |
| 4 | Move through each wizard step (Next) | Each step's name or number, and the stepper's current step; field labels and errors read when they appear |
| 5 | In the layout step (RegionEditor), try to understand the sheet | Something meaningful: a grid with row and column headers, or a stated alternative. A wall of unnamed buttons or silence is a finding |
| 6 | Commit the import | A status announcement while it runs, and its outcome, without moving focus |
| 7 | Open the new entity's records | The records table as a **table** with column headers read for each cell (Ctrl+Alt+arrows / NVDA table keys) |
| 8 | Open one record | Its fields as label–value pairs |

### 3. Station → portal → pin

| Step | Do | Expect to hear |
|---|---|---|
| 1 | Go to Stations, open My Station | Page titles; the station's name as a heading |
| 2 | Start a portal and send "How many customers are there?" | The message field's label; your message; the reply announced or reachable as it arrives (4.1.3), not only visible |
| 3 | Ask for a chart ("Chart orders by month") | The chart as an image or region with a **name**, and some text alternative to its data. Silence or "frame" alone is a finding (#796) |
| 4 | Pin the result | The pin button's name; a confirmation announced |
| 5 | Open Pinned results and the pin | The pinned result's title as a heading; the chart's alternative again |

### 4. A curated view

| Step | Do | Expect to hear |
|---|---|---|
| 1 | Go to Views, choose Create View | A **dialog** with its name; the first field focused with its label |
| 2 | Submit empty | The error read for each required field, and focus moved to the first invalid one |
| 3 | Fill it in and save | The dialog closing and a confirmation; focus returned to a sensible place |
| 4 | Open the view | Its name as a heading; its table as in flow 2, step 7 |

### 5. Settings → Members (owner, then member)

| Step | Do | Expect to hear |
|---|---|---|
| 1 | Go to Settings | The page title; the settings tabs as a **tab list** with the selected tab |
| 2 | Open Members | The members table with headers; each member's name and access |
| 3 | Open the invite dialog (owner) | A **dialog** with its name; labelled fields; errors read on an invalid email |
| 4 | As member, visit Settings | Only the tabs the member has; any unavailable action announced as unavailable **with its reason**, not silently missing focus |

### 6. Marketing site: home → pricing → contact (`localhost:3002`)

| Step | Do | Expect to hear |
|---|---|---|
| 1 | Load `/`, press Tab once | "Skip to content" as the first link; activating it moves you to the main content |
| 2 | List landmarks and headings | Banner, primary navigation, main, footer navigation; one level-1 heading |
| 3 | Go to Pricing via the nav | The current page marked current in the nav; each plan as a heading; its prices and limits read in order |
| 4 | Go to Contact | The page's heading; each contact method with a meaningful name |
| 5 | Toggle the theme | The toggle's name and its new state |

### Findings

**No findings.** The six flows were walked with VoiceOver + Safari and NVDA + Firefox on 2026-11-05, and every step announced what the script expects. A later walk adds its findings to this table.

| ID | Flow | Step | WCAG | Observed | AT | Owner |
|---|---|---|---|---|---|---|
