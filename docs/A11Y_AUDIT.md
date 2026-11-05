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
## Coverage

| Result file | Tool | Version | Runs ok | Skipped |
|---|---|---|---|---|
| `apps/web/a11y-results/eslint.json` | eslint | — | 889 | 0 |
| `apps/web/a11y-results/stories.json` | jest-axe | 4.14.0 | 281 | 5 |
| `packages/core/a11y-results/eslint.json` | eslint | — | 322 | 0 |
| `packages/core/a11y-results/stories.json` | jest-axe | 4.14.0 | 177 | 0 |
| `apps/site/a11y-results/eslint.json` | eslint | — | 31 | 0 |
| `packages/e2e/a11y-results/app.json` | axe-app | 4.14.0 | 414 | 72 |
| `packages/e2e/a11y-results/site.json` | axe-site | 4.14.0 | 24 | 0 |

Skipped runs (not audited; each is a coverage gap until it renders):

- `apps/web/a11y-results/stories.json` · apps/web/src/stories/FAQList.component.stories.tsx › Default: Cannot read properties of undefined (reading 'has')
- `apps/web/a11y-results/stories.json` · apps/web/src/stories/FAQList.component.stories.tsx › FilteredToJobs: Cannot read properties of undefined (reading 'has')
- `apps/web/a11y-results/stories.json` · apps/web/src/stories/FAQList.component.stories.tsx › GroupedByCategory: Cannot read properties of undefined (reading 'has')
- `apps/web/a11y-results/stories.json` · apps/web/src/stories/GlossaryList.component.stories.tsx › Default: Cannot read properties of undefined (reading 'has')
- `apps/web/a11y-results/stories.json` · apps/web/src/stories/GlossaryList.component.stories.tsx › FilteredToAnalytics: Cannot read properties of undefined (reading 'has')
- `packages/e2e/a11y-results/app.json` · entity-group-detail · owner · populated · brand: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · owner · error · brand: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · owner · loading · brand: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · portal · owner · populated · brand: nothing to drill into at step 2: /api/portals on /stations/5a26b111-c344-41bc-ad44-6414edd439eb returned no item
- `packages/e2e/a11y-results/app.json` · portal · owner · error · brand: nothing to drill into at step 2: /api/portals on /stations/5a26b111-c344-41bc-ad44-6414edd439eb returned no item
- `packages/e2e/a11y-results/app.json` · portal · owner · loading · brand: nothing to drill into at step 2: /api/portals on /stations/5a26b111-c344-41bc-ad44-6414edd439eb returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · owner · populated · brand: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · owner · error · brand: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · owner · loading · brand: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · owner · populated · brand: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · owner · error · brand: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · owner · loading · brand: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · owner · populated · brand.dark: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · owner · error · brand.dark: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · owner · loading · brand.dark: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · portal · owner · populated · brand.dark: nothing to drill into at step 2: /api/portals on /stations/5a26b111-c344-41bc-ad44-6414edd439eb returned no item
- `packages/e2e/a11y-results/app.json` · portal · owner · error · brand.dark: nothing to drill into at step 2: /api/portals on /stations/5a26b111-c344-41bc-ad44-6414edd439eb returned no item
- `packages/e2e/a11y-results/app.json` · portal · owner · loading · brand.dark: nothing to drill into at step 2: /api/portals on /stations/5a26b111-c344-41bc-ad44-6414edd439eb returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · owner · populated · brand.dark: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · owner · error · brand.dark: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · owner · loading · brand.dark: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · owner · populated · brand.dark: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · owner · error · brand.dark: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · owner · loading · brand.dark: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · admin · populated · brand: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · admin · error · brand: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · admin · loading · brand: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · portal · admin · populated · brand: nothing to drill into at step 2: /api/portals on /stations/5a26b111-c344-41bc-ad44-6414edd439eb returned no item
- `packages/e2e/a11y-results/app.json` · portal · admin · error · brand: nothing to drill into at step 2: /api/portals on /stations/5a26b111-c344-41bc-ad44-6414edd439eb returned no item
- `packages/e2e/a11y-results/app.json` · portal · admin · loading · brand: nothing to drill into at step 2: /api/portals on /stations/5a26b111-c344-41bc-ad44-6414edd439eb returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · admin · populated · brand: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · admin · error · brand: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · admin · loading · brand: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · admin · populated · brand: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · admin · error · brand: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · admin · loading · brand: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · admin · populated · brand.dark: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · admin · error · brand.dark: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · admin · loading · brand.dark: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · portal · admin · populated · brand.dark: nothing to drill into at step 2: /api/portals on /stations/5a26b111-c344-41bc-ad44-6414edd439eb returned no item
- `packages/e2e/a11y-results/app.json` · portal · admin · error · brand.dark: nothing to drill into at step 2: /api/portals on /stations/5a26b111-c344-41bc-ad44-6414edd439eb returned no item
- `packages/e2e/a11y-results/app.json` · portal · admin · loading · brand.dark: nothing to drill into at step 2: /api/portals on /stations/5a26b111-c344-41bc-ad44-6414edd439eb returned no item
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
| [#793 Dialogs and forms](#owner-793) | 27 | 74 | 4.1.2 | 0 |
| [#794 Tables, grids and lists](#owner-794) | 20 | 97 | 1.4.3, 4.1.2 | 2 |
| [#795 RegionEditor spreadsheet canvas](#owner-795) | 9 | 38 | 4.1.2 | 1 |
| [#796 Maps and charts](#owner-796) | 0 | 0 | — | 1 |
| [#797 App shell, navigation and landmarks](#owner-797) | 104 | 673 | 1.1.1, 1.3.1, 1.4.3, 2.1.1, 2.5.3, 4.1.2 | 5 |
| [#798 Marketing site](#owner-798) | 8 | 21 | 1.4.3 | 1 |
| Unassigned | 0 | 0 | — | 0 |

<a id="owner-793"></a>

## #793 Dialogs and forms

| ID | WCAG | Rule | Impact | Element | Where | Instances | Seen | Tool |
|---|---|---|---|---|---|---|---|---|
| 89861fc2 | 4.1.2 | aria-command-name | serious | .Mui-selected.MuiListItemButton-root.MuiListItemButton-gutters | 3: connectors, help, settings | 3 | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 2cd831c2 | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/AdvancedFilterBuilder.component.stories.tsx .MuiBox-root > .MuiBox-root > .MuiBox-root > .MuiBox-root > .MuiBox-root > .MuiBox-root > .MuiBox-root > .MuiFormControl-root > .MuiSelect-root.MuiInputBase-root > .MuiSelect-select.MuiSelect-outlined | 1: MaxDepthReached | 1 | — | jest-axe |
| 78d3c106 | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/AdvancedFilterBuilder.component.stories.tsx .MuiBox-root > .MuiBox-root > .MuiBox-root > .MuiBox-root > .MuiBox-root > .MuiBox-root > .MuiFormControl-root > .MuiSelect-root.MuiInputBase-root > .MuiSelect-select.MuiSelect-outlined | 1: MaxDepthReached | 1 | — | jest-axe |
| 91247097 | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/AdvancedFilterBuilder.component.stories.tsx .MuiBox-root > .MuiBox-root > .MuiBox-root > .MuiBox-root > .MuiFormControl-root > .MuiSelect-root.MuiInputBase-root > .MuiSelect-select.MuiSelect-outlined | 1: MaxDepthReached | 1 | — | jest-axe |
| b88b933a | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/AdvancedFilterBuilder.component.stories.tsx .MuiBox-root > .MuiBox-root > .MuiFormControl-root > .MuiSelect-root.MuiInputBase-root > .MuiSelect-select.MuiSelect-outlined | 2: MaxDepthReached, Populated | 3 | — | jest-axe |
| 495d49f5 | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/AdvancedFilterBuilder.component.stories.tsx .MuiBox-root > .MuiFormControl-root > .MuiSelect-root.MuiInputBase-root > .MuiSelect-select.MuiSelect-outlined | 4: BetweenOperators, EmptyAndArrayOperators, MaxDepthReached, Populated | 7 | — | jest-axe |
| de9c47a9 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/workflows/FileUploadConnector/stories/FileUploadConnectorWorkflow.stories.tsx | 2: Step1_InvalidRegion, Step1_RegionsDrawn_Valid | 2 | — | jest-axe |
| 271b92d5 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/workflows/FileUploadConnector/stories/FileUploadConnectorWorkflow.stories.tsx div[data-corner-header=""] | 3: Step1_Empty, Step1_InvalidRegion, Step1_RegionsDrawn_Valid | 3 | — | jest-axe |
| 7273f52e | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/workflows/FileUploadConnector/stories/FileUploadRegionDrawingStep.stories.tsx | 3: InvalidRegion_AttemptedInterpret, OneRegion_Valid, ServerError | 3 | — | jest-axe |
| 0ba71aed | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/workflows/FileUploadConnector/stories/FileUploadRegionDrawingStep.stories.tsx div[data-corner-header=""] | 5: Empty, InvalidRegion_AttemptedInterpret, MultipleRegions_MergedEntity, OneRegion_Valid, ServerError | 5 | — | jest-axe |
| fd812fff | 4.1.2 | button-name | critical | packages/core/src/stories/IconButton.stories.tsx button | 1: Default | 1 | — | jest-axe |
| 7e1b66c0 | 4.1.2 | label | critical | apps/web/src/stories/AdvancedFilterBuilder.component.stories.tsx #_r_kl_ | 1: BetweenOperators | 1 | — | jest-axe |
| a60ad4d8 | 4.1.2 | label | critical | apps/web/src/stories/AdvancedFilterBuilder.component.stories.tsx #_r_km_ | 1: BetweenOperators | 1 | — | jest-axe |
| 2fc613b6 | 4.1.2 | label | critical | apps/web/src/stories/AdvancedFilterBuilder.component.stories.tsx #_r_m2_ | 1: MaxDepthReached | 1 | — | jest-axe |
| f6b2d0a7 | best practice | aria-allowed-role | minor | apps/web/src/stories/CuratedViewEditorDialog.component.stories.tsx form | 6: Create, Edit, Saving, SqlMode, SqlModeUpsell, WithValidationError | 6 | — | jest-axe |
| 6dc28c79 | best practice | aria-allowed-role | minor | apps/web/src/stories/DeleteCuratedViewDialog.component.stories.tsx form | 3: Default, Deleting, WithError | 3 | — | jest-axe |
| 78e7ccaf | best practice | aria-allowed-role | minor | apps/web/src/stories/DeleteTagDialog.component.stories.tsx form | 3: Default, Deleting, DifferentTag | 3 | — | jest-axe |
| 91a647f9 | best practice | aria-allowed-role | minor | apps/web/src/stories/RenameOrganizationDialog.component.stories.tsx form | 3: Default, PermissionDenied, Saving | 3 | — | jest-axe |
| 1c5f8667 | best practice | aria-allowed-role | minor | apps/web/src/stories/TagFormModal.component.stories.tsx form | 5: CreateMode, EditMode, EditWithServerError, ServerError, Submitting | 5 | — | jest-axe |
| ca6a0a48 | best practice | heading-order | moderate | .MuiStack-root > h6 | 1: settings | 1 | roles: admin, member, owner · states: error, populated · themes: brand, brand.dark | axe-app |
| e6d4efd6 | best practice | heading-order | moderate | apps/web/src/stories/CuratedViewEditorDialog.component.stories.tsx h6 | 6: Create, Edit, Saving, SqlMode, SqlModeUpsell, WithValidationError | 6 | — | jest-axe |
| e4cfa0d2 | best practice | heading-order | moderate | apps/web/src/stories/TagFormModal.component.stories.tsx h6 | 5: CreateMode, EditMode, EditWithServerError, ServerError, Submitting | 5 | — | jest-axe |
| 2483fa7e | best practice | heading-order | moderate | apps/web/src/stories/ToolpackMetadataModal.component.stories.tsx h6 | 2: Default, Unentitled | 2 | — | jest-axe |
| 3f08377b | best practice | heading-order | moderate | apps/web/src/workflows/FileUploadConnector/stories/FileUploadConnectorWorkflow.stories.tsx .MuiTypography-subtitle1 | 4: Step1_InvalidRegion, Step1_RegionsDrawn_Valid, Step2_AllGreen, Step2_BlockerPresent | 4 | — | jest-axe |
| 595fdf3b | best practice | heading-order | moderate | apps/web/src/workflows/FileUploadConnector/stories/FileUploadConnectorWorkflow.stories.tsx h6 | 1: Step1_Empty | 1 | — | jest-axe |
| e7dac676 | best practice | jsx-a11y/no-autofocus | — | apps/web/src/components/ChatWindow.component.tsx | 1: :288 | 1 | — | eslint |
| af258267 | best practice | jsx-a11y/no-autofocus | — | apps/web/src/components/SsoLoginForm.component.tsx | 1: :108 | 1 | — | eslint |

<a id="owner-794"></a>

## #794 Tables, grids and lists

| ID | WCAG | Rule | Impact | Element | Where | Instances | Seen | Tool |
|---|---|---|---|---|---|---|---|---|
| 4830db52 | 1.4.3 | color-contrast | serious |  | 14: column-definition-detail, column-definitions, connector-detail, entities, entity-detail, entity-groups, +8 more | 14 | roles: admin, member, owner · states: error, populated · themes: brand.dark | axe-app |
| f05935f7 | 1.4.3 | color-contrast | serious |  >  > .MuiStack-root > .MuiChip-colorWarning.MuiChip-outlinedWarning > .MuiChip-label.MuiChip-labelSmall | 1: toolpacks | 5 | roles: admin, owner · states: populated · themes: brand | axe-app |
| 5f27d59e | 1.4.3 | color-contrast | serious | .MuiButton-contained.MuiButton-containedPrimary.MuiButton-sizeMedium | 3: entity-groups, tags, views | 3 | roles: admin, owner · states: empty, populated · themes: brand.dark | axe-app |
| 91722e26 | 1.4.3 | color-contrast | serious | .MuiButton-outlinedError | 1: stations | 1 | roles: admin, owner · states: populated · themes: brand.dark | axe-app |
| fe7eccf7 | 1.4.3 | color-contrast | serious | .MuiChip-label | 1: job-detail | 1 | roles: admin, member, owner · states: populated · themes: brand.dark | axe-app |
| a5214448 | 1.4.3 | color-contrast | serious | .MuiPaper-outlined.MuiPaper-rounded.MuiCard-root > .MuiStack-root > .MuiBox-root > .MuiStack-root > .MuiButton-outlinedError.MuiButton-colorError | 2: connectors, entities | 15 | roles: admin, owner · states: populated · themes: brand.dark | axe-app |
| 89a71f83 | 1.4.3 | color-contrast | serious | .MuiPaper-outlined.MuiPaper-rounded.MuiCard-root > .MuiStack-root > .MuiCardActionArea-root > .MuiCardContent-root > .MuiStack-root > .MuiBox-root > .MuiStack-root > .MuiBox-root > .MuiChip-colorError.MuiChip-outlinedError > .MuiChip-label.MuiChip-labelSmall | 1: jobs | 3 | roles: admin, member, owner · states: populated · themes: brand.dark | axe-app |
| 8fd55971 | 4.1.2 | aria-command-name | serious | .MuiBox-root > .MuiListItemButton-root.MuiListItemButton-gutters | 1: connectors | 3 | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| b40cacd6 | 4.1.2 | aria-input-field-name | serious | .MuiSelect-select | 13: column-definition-detail, column-definitions, connector-detail, entities, entity-detail, entity-groups, +7 more | 13 | roles: admin, member, owner · states: empty, error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 6b84b4b2 | 4.1.2 | aria-input-field-name | serious | #tabpanel-0 > .MuiBox-root > .MuiStack-root > .MuiBox-root > .MuiBox-root > .MuiBox-root > .MuiSelect-root.MuiInputBase-root > .MuiSelect-select.MuiSelect-outlined | 1: connectors | 1 | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 199e2593 | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/Connector.view.stories.tsx #tabpanel-0 > .MuiBox-root > .MuiStack-root > .MuiBox-root > .MuiBox-root > .MuiBox-root > .MuiSelect-root.MuiInputBase-root > .MuiSelect-select.MuiSelect-outlined | 1: Default | 1 | — | jest-axe |
| d4cf6987 | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/PaginationToolbar.component.stories.tsx .MuiSelect-select | 11: AllFilterTypes, BooleanFilters, Default, Interactive, LastPage, MidPage, +5 more | 11 | — | jest-axe |
| 5706fa98 | best practice | heading-order | moderate | .MuiPaper-outlined.MuiPaper-rounded.MuiCard-root > .MuiStack-root > .MuiCardActionArea-root > .MuiCardContent-root > .MuiStack-root > .MuiStack-root > h6 | 4: column-definitions, connectors, entities, jobs | 4 | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 6328129f | best practice | heading-order | moderate | .MuiTypography-h6 | 1: connectors | 1 | roles: admin, owner · states: empty · themes: brand | axe-app |
| e86a6bdc | best practice | heading-order | moderate | apps/web/src/stories/CuratedViewDetail.view.stories.tsx h6 | 1: Empty | 1 | — | jest-axe |
| bff1218e | best practice | heading-order | moderate | h4 | 6: column-definitions, connectors, entities, entity-groups, tags, toolpacks | 6 | roles: member · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 1a851f7c | best practice | heading-order | moderate | h6 | 11: column-definition-detail, column-definitions, connector-detail, entities, entity-groups, jobs, +5 more | 11 | roles: admin, member, owner · states: empty, locked, populated · themes: brand, brand.dark | axe-app |
| d736ad8e | best practice | image-redundant-alt | minor | img[alt="E2E Test User"] | 1: connectors | 1 | roles: owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| f1bd287e | best practice | image-redundant-alt | minor | img[alt="e2e-admin@portalsai.io"] | 1: connectors | 1 | roles: admin · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 53f149ff | best practice | jsx-a11y/no-autofocus | — | apps/web/src/components/PaginationToolbar.component.tsx | 1: :747 | 1 | — | eslint |

<a id="owner-795"></a>

## #795 RegionEditor spreadsheet canvas

| ID | WCAG | Rule | Impact | Element | Where | Instances | Seen | Tool |
|---|---|---|---|---|---|---|---|---|
| 2345f6f1 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/BindingEditorPopover.stories.tsx | 6: EnumColumn, ExcludedState, NormalizedKeyValidationError, ReferenceColumn, ServerErrorAlert, StringColumn | 6 | — | jest-axe |
| 23a381c2 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/RegionDrawingStep.stories.tsx | 5: CrosstabSelected, DriftSeeded, MessyPipelineSkipRules, MessyQuartersSkipRules, WithProposedRegions | 5 | — | jest-axe |
| a47467a2 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/RegionDrawingStep.stories.tsx div[data-corner-header=""] | 7: CrosstabSelected, DriftSeeded, Empty, Interactive, MessyPipelineSkipRules, MessyQuartersSkipRules, +1 more | 7 | — | jest-axe |
| e0d4f664 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/RegionEditor.stories.tsx | 1: ModeB_DriftHalt | 1 | — | jest-axe |
| 9dda1f9d | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/RegionEditor.stories.tsx div[data-corner-header=""] | 3: Interactive, ModeA_Empty, ModeB_DriftHalt | 3 | — | jest-axe |
| be8862c2 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/SheetCanvas.stories.tsx div[data-corner-header=""] | 8: CrosstabSheet, DriftHighlighted, Empty, InteractiveDrawing, MessyPipelineSkipRules, MessyQuartersSkipRules, +2 more | 8 | — | jest-axe |
| fd0eeb17 | 4.1.2 | jsx-a11y/no-noninteractive-element-interactions | — | apps/web/src/modules/RegionEditor/RegionDrawingStep.component.tsx | 1: :387 | 1 | — | eslint |
| 424ee260 | 4.1.2 | jsx-a11y/no-noninteractive-element-interactions | — | apps/web/src/modules/RegionEditor/ReviewStep.component.tsx | 1: :509 | 1 | — | eslint |
| 0182bd69 | best practice | aria-allowed-role | minor | apps/web/src/modules/RegionEditor/stories/BindingEditorPopover.stories.tsx form | 6: EnumColumn, ExcludedState, NormalizedKeyValidationError, ReferenceColumn, ServerErrorAlert, StringColumn | 6 | — | jest-axe |

<a id="owner-796"></a>

## #796 Maps and charts

No automated findings.

<a id="owner-797"></a>

## #797 App shell, navigation and landmarks

| ID | WCAG | Rule | Impact | Element | Where | Instances | Seen | Tool |
|---|---|---|---|---|---|---|---|---|
| 0dd7ddee | 1.1.1 | aria-progressbar-name | serious | :root > .MuiCircularProgress-root.MuiCircularProgress-indeterminate.MuiCircularProgress-colorPrimary | 1: settings | 1 | roles: admin, member · states: loading · themes: brand | axe-app |
| 447b49e4 | 1.1.1 | aria-progressbar-name | serious | .MuiBox-root > .MuiStack-root > .MuiCircularProgress-root.MuiCircularProgress-indeterminate.MuiCircularProgress-colorPrimary | 2: settings, stations | 2 | roles: admin, member, owner · states: loading · themes: brand, brand.dark | axe-app |
| 723f3a15 | 1.1.1 | aria-progressbar-name | serious | .MuiCircularProgress-root | 15: column-definition-detail, column-definitions, connector-detail, connectors, entities, entity-detail, +9 more | 15 | roles: admin, member, owner · states: loading, locked · themes: brand, brand.dark | axe-app |
| 3d9fd228 | 1.1.1 | aria-progressbar-name | serious | .MuiStack-root > .MuiCircularProgress-root.MuiCircularProgress-indeterminate.MuiCircularProgress-colorPrimary | 1: stations | 1 | roles: admin, member · states: loading · themes: brand | axe-app |
| 89fa1ce9 | 1.1.1 | aria-progressbar-name | serious | #tabpanel-0 > .MuiBox-root > .MuiStack-root > .MuiStack-root > .MuiCircularProgress-root.MuiCircularProgress-indeterminate.MuiCircularProgress-colorPrimary | 1: connectors | 1 | roles: admin, member, owner · states: empty, error · themes: brand.dark | axe-app |
| fabf96b1 | 1.1.1 | aria-progressbar-name | serious | apps/web/src/modules/D3Widget/stories/D3Widget.stories.tsx .MuiCircularProgress-root | 1: Loading | 1 | — | jest-axe |
| 8051a0be | 1.1.1 | aria-progressbar-name | serious | apps/web/src/stories/Authorized.stories.tsx span | 2: Loading, WithError | 2 | — | jest-axe |
| acbca274 | 1.1.1 | aria-progressbar-name | serious | apps/web/src/stories/Connector.view.stories.tsx #tabpanel-0 > .MuiBox-root > .MuiStack-root > .MuiStack-root > .MuiCircularProgress-root.MuiCircularProgress-indeterminate.MuiCircularProgress-colorPrimary | 1: Default | 1 | — | jest-axe |
| 7b22f862 | 1.1.1 | aria-progressbar-name | serious | apps/web/src/stories/Dashboard.view.stories.tsx .MuiBox-root > .MuiPaper-root.MuiPaper-outlined.MuiPaper-rounded > .MuiStack-root > .MuiBox-root > .MuiStack-root > .MuiCircularProgress-root.MuiCircularProgress-indeterminate.MuiCircularProgress-colorPrimary | 1: Default | 2 | — | jest-axe |
| 67ea94ae | 1.1.1 | aria-progressbar-name | serious | apps/web/src/stories/Dashboard.view.stories.tsx .MuiStack-root > .MuiCircularProgress-root.MuiCircularProgress-indeterminate.MuiCircularProgress-colorPrimary | 1: Default | 1 | — | jest-axe |
| d950cae1 | 1.1.1 | aria-progressbar-name | serious | apps/web/src/stories/DataJobStream.component.stories.tsx .MuiLinearProgress-root | 1: ActiveJob | 1 | — | jest-axe |
| d9a4b796 | 1.1.1 | aria-progressbar-name | serious | apps/web/src/stories/DataResult.component.stories.tsx span | 2: Loading, PartialLoading | 2 | — | jest-axe |
| a07b6487 | 1.1.1 | aria-progressbar-name | serious | apps/web/src/stories/FilterSqlPreview.component.stories.tsx span | 1: Loading | 1 | — | jest-axe |
| 8b51247e | 1.1.1 | aria-progressbar-name | serious | apps/web/src/stories/JobCard.component.stories.tsx .MuiLinearProgress-root | 3: Active, ActiveWithStreamProgress, Revalidation | 3 | — | jest-axe |
| 88751d19 | 1.1.1 | aria-progressbar-name | serious | apps/web/src/stories/Loading.view.stories.tsx span | 1: Default | 1 | — | jest-axe |
| 52055a1b | 1.1.1 | aria-progressbar-name | serious | apps/web/src/stories/Settings.view.stories.tsx .MuiBox-root > .MuiStack-root > .MuiCircularProgress-root.MuiCircularProgress-indeterminate.MuiCircularProgress-colorPrimary | 1: Default | 1 | — | jest-axe |
| 30981468 | 1.1.1 | aria-progressbar-name | serious | apps/web/src/workflows/FileUploadConnector/stories/FileUploadConnectorWorkflow.stories.tsx | 1: Step0_Uploading | 1 | — | jest-axe |
| 3d4e8a1c | 1.1.1 | aria-progressbar-name | serious | apps/web/src/workflows/FileUploadConnector/stories/FileUploadConnectorWorkflow.stories.tsx .MuiBox-root > .MuiBox-root > .MuiBox-root > .MuiLinearProgress-root.MuiLinearProgress-colorPrimary.MuiLinearProgress-determinate | 1: Step0_FilesSelected | 2 | — | jest-axe |
| 5752d06a | 1.1.1 | aria-progressbar-name | serious | apps/web/src/workflows/FileUploadConnector/stories/UploadStep.stories.tsx | 2: Parsing, Uploading | 2 | — | jest-axe |
| 0bfd98bb | 1.1.1 | aria-progressbar-name | serious | apps/web/src/workflows/FileUploadConnector/stories/UploadStep.stories.tsx .MuiBox-root > .MuiBox-root > .MuiBox-root > .MuiLinearProgress-root.MuiLinearProgress-colorPrimary | 1: Uploading | 2 | — | jest-axe |
| d5d1f4cc | 1.1.1 | aria-progressbar-name | serious | apps/web/src/workflows/FileUploadConnector/stories/UploadStep.stories.tsx .MuiLinearProgress-root | 2: ErrorState, OneFileSelected | 2 | — | jest-axe |
| aab619f9 | 1.1.1 | aria-progressbar-name | serious | packages/core/src/stories/MultiSearchableSelect.stories.tsx .MuiCircularProgress-root | 1: Async | 1 | — | jest-axe |
| 129d245a | 1.1.1 | aria-progressbar-name | serious | packages/core/src/stories/Progress.stories.tsx .MuiLinearProgress-root | 6: Complete, Default, Error, NoLabel, Thick, Zero | 6 | — | jest-axe |
| 054b9760 | 1.1.1 | aria-progressbar-name | serious | packages/core/src/stories/SearchableSelect.stories.tsx .MuiCircularProgress-root | 1: Async | 1 | — | jest-axe |
| afc486e8 | 1.1.1 | aria-progressbar-name | serious | packages/core/src/stories/StatusMessage.stories.tsx span | 1: Loading | 1 | — | jest-axe |
| 05fe17ab | 1.3.1 | list | serious | apps/web/src/stories/SidebarNav.component.stories.tsx ul | 3: Expanded, FooterRenderProp, WithoutFooter | 3 | — | jest-axe |
| 338bfa83 | 1.3.1 | list | serious | apps/web/src/stories/SidebarNavItem.component.stories.tsx ul | 2: ChildSelected, WithChildrenOpen | 2 | — | jest-axe |
| e181b2eb | 1.4.3 | color-contrast | serious | .MuiButton-contained | 12: column-definitions, connectors, entities, entity-groups, invitation-accept, login, +6 more | 12 | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand.dark | axe-app |
| ea6c7c24 | 1.4.3 | color-contrast | serious | .MuiButton-root | 1: dashboard | 1 | roles: admin, member, owner · states: populated · themes: brand.dark | axe-app |
| f83131b6 | 2.1.1 | jsx-a11y/click-events-have-key-events | — | apps/web/src/components/SidebarNavToggle.component.tsx | 1: :54 | 1 | — | eslint |
| c10d6f4b | 2.1.1, 4.1.2 | jsx-a11y/no-static-element-interactions | — | apps/web/src/components/SidebarNavToggle.component.tsx | 1: :54 | 1 | — | eslint |
| 3e40577f | 2.5.3 | label-content-name-mismatch | serious |  | 20: column-definition-detail, column-definitions, connector-detail, connectors, dashboard, entities, +14 more | 20 | roles: admin, member, owner · states: empty, error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| e8886413 | 4.1.2 | aria-command-name | serious | .Mui-selected | 15: column-definition-detail, column-definitions, dashboard, entities, entity-detail, entity-groups, +9 more | 15 | roles: admin, member, owner · states: empty, error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 5e8aaf14 | 4.1.2 | aria-command-name | serious | .MuiListItemButton-root.MuiListItemButton-gutters | 20: column-definition-detail, column-definitions, connector-detail, connectors, dashboard, entities, +14 more | 213 | roles: admin, member, owner · states: empty, error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 1576f759 | 4.1.2 | aria-command-name | serious | apps/web/src/stories/Authorized.layout.stories.tsx .Mui-selected | 3: Default, WithLongContent, WithMultipleElements | 3 | — | jest-axe |
| 87c1f722 | 4.1.2 | aria-command-name | serious | apps/web/src/stories/Authorized.layout.stories.tsx .MuiListItemButton-root.MuiListItemButton-gutters | 3: Default, WithLongContent, WithMultipleElements | 9 | — | jest-axe |
| 97df4262 | 4.1.2 | aria-command-name | serious | apps/web/src/stories/SidebarNav.component.stories.tsx .MuiListItemButton-root.MuiListItemButton-gutters | 1: Collapsed | 3 | — | jest-axe |
| 42c9fe0c | 4.1.2 | aria-command-name | serious | apps/web/src/stories/SidebarNavItem.component.stories.tsx | 1: CollapsedWithChildren | 1 | — | jest-axe |
| 56f4fdcd | 4.1.2 | aria-command-name | serious | apps/web/src/stories/SidebarNavItem.component.stories.tsx .MuiButtonBase-root | 1: CollapsedNoChildren | 1 | — | jest-axe |
| ee3e688c | 4.1.2 | aria-prohibited-attr | serious |  | 1: dashboard | 1 | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| f003b5d1 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/stories/Dashboard.view.stories.tsx | 1: Default | 1 | — | jest-axe |
| 79b6a103 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/stories/HealthCheck.component.stories.tsx .MuiBox-root | 2: Healthy, UnknownTimestamp | 2 | — | jest-axe |
| a88c6214 | best practice | heading-order | moderate | apps/web/src/stories/Authorized.layout.stories.tsx .MuiBox-root > h6 | 1: WithMultipleElements | 1 | — | jest-axe |
| 6b7f4782 | best practice | heading-order | moderate | apps/web/src/stories/Authorized.layout.stories.tsx h5 | 1: Default | 1 | — | jest-axe |
| 3ed9f2da | best practice | heading-order | moderate | apps/web/src/stories/BadRequest.view.stories.tsx h4 | 2: CustomDescription, Default | 2 | — | jest-axe |
| 4ed9e289 | best practice | heading-order | moderate | apps/web/src/stories/Forbidden.view.stories.tsx h4 | 2: CustomDescription, Default | 2 | — | jest-axe |
| 2e486a39 | best practice | heading-order | moderate | apps/web/src/stories/Help.view.stories.tsx div[data-testid="getting-started-step-1"] > .MuiCardContent-root > .MuiStack-root > .MuiStack-root > .MuiTypography-subtitle1 | 2: Default, GlossaryFilteredToAnalytics | 2 | — | jest-axe |
| 514bb0bf | best practice | heading-order | moderate | apps/web/src/stories/HttpError.component.stories.tsx h4 | 7: BackButtonOnly, Forbidden, NoButtons, NoDescription, NotFound, ServerError, +1 more | 7 | — | jest-axe |
| 24b961c5 | best practice | heading-order | moderate | apps/web/src/stories/NotFound.view.stories.tsx h4 | 2: CustomDescription, Default | 2 | — | jest-axe |
| 8534c76c | best practice | heading-order | moderate | apps/web/src/stories/ServerError.view.stories.tsx h4 | 2: CustomDescription, Default | 2 | — | jest-axe |
| c038d63c | best practice | heading-order | moderate | apps/web/src/stories/Unauthorized.view.stories.tsx h4 | 2: CustomDescription, Default | 2 | — | jest-axe |
| 5dd41f8a | best practice | heading-order | moderate | div[data-testid="getting-started-step-1"] > .MuiCardContent-root > .MuiStack-root > .MuiStack-root > .MuiTypography-subtitle1 | 1: help | 1 | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| b9463d9f | best practice | heading-order | moderate | packages/core/src/stories/PageSection.stories.tsx .MuiCard-root.MuiPaper-root > .MuiCardContent-root > h6 | 5: Default, OutlinedVariant, WithActions, WithIcon, WithSecondaryMenu | 5 | — | jest-axe |
| da7fba43 | best practice | heading-order | moderate | packages/core/src/stories/PageSection.stories.tsx .MuiPaper-root.MuiPaper-outlined > .MuiStack-root > .MuiBox-root > .MuiStack-root > .MuiCard-root.MuiPaper-root > .MuiCardContent-root > h6 | 1: Composed | 2 | — | jest-axe |
| 30bf364d | best practice | image-redundant-alt | minor | apps/web/src/stories/Authorized.layout.stories.tsx img | 3: Default, WithLongContent, WithMultipleElements | 3 | — | jest-axe |
| 45a5bbc9 | best practice | image-redundant-alt | minor | apps/web/src/stories/HeaderMenu.component.stories.tsx img | 1: UIWithCustomChildren | 1 | — | jest-axe |
| c8484360 | best practice | image-redundant-alt | minor | img | 20: column-definition-detail, column-definitions, connector-detail, connectors, dashboard, entities, +14 more | 20 | roles: admin, member, owner · states: empty, error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| ed380177 | best practice | landmark-one-main | moderate | html | 23: column-definition-detail, column-definitions, connector-detail, connectors, dashboard, entities, +17 more | 23 | roles: admin, member, owner · states: empty, error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| fd3b5de4 | best practice | page-has-heading-one | moderate | html | 8: column-definition-detail, connector-detail, connectors, entity-detail, job-detail, record-detail, +2 more | 8 | roles: admin, member, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| 4ea83654 | best practice | region | moderate |  | 22: column-definition-detail, column-definitions, connector-detail, connectors, dashboard, entities, +16 more | 42 | roles: admin, member, owner · states: empty, error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| b27dbe16 | best practice | region | moderate |  >  | 1: toolpacks | 31 | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| defca027 | best practice | region | moderate |  > td | 1: entity-detail | 4 | roles: admin, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| a8b0c07e | best practice | region | moderate | .MuiBadge-badge | 4: column-definitions, entities, entity-detail, jobs | 4 | roles: admin, member, owner · states: empty, error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 1564b9fe | best practice | region | moderate | .MuiBox-root | 8: column-definitions, connector-detail, entities, entity-groups, job-detail, station-detail, +2 more | 13 | roles: admin, member, owner · states: loading, locked, populated · themes: brand, brand.dark | axe-app |
| 31b9c4f5 | best practice | region | moderate | .MuiBox-root > .MuiPaper-outlined.MuiPaper-rounded > .MuiStack-root > .MuiBox-root | 1: dashboard | 2 | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 15517352 | best practice | region | moderate | .MuiBox-root > .MuiPaper-outlined.MuiPaper-rounded > .MuiStack-root > .MuiStack-root > .MuiStack-root > h2 | 1: dashboard | 2 | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| ca827f8c | best practice | region | moderate | .MuiBox-root > .MuiTypography-caption.MuiTypography-root | 2: connector-detail, station-detail | 4 | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 6f2a980f | best practice | region | moderate | .MuiChip-colorPrimary.MuiChip-outlinedPrimary > .MuiChip-label.MuiChip-labelSmall | 1: station-detail | 4 | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| ad7ca5b6 | best practice | region | moderate | .MuiCircularProgress-root | 1: entity-detail | 1 | roles: owner · states: locked · themes: brand | axe-app |
| e04b0836 | best practice | region | moderate | .MuiPaper-outlined.MuiPaper-rounded > .MuiStack-root > .MuiBox-root | 1: job-detail | 1 | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 2d21c1dc | best practice | region | moderate | .MuiPaper-outlined.MuiPaper-rounded > .MuiStack-root > .MuiStack-root | 1: job-detail | 1 | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 85f7b872 | best practice | region | moderate | .MuiPaper-outlined.MuiPaper-rounded > .MuiStack-root > .MuiStack-root > .MuiStack-root > h2 | 2: entity-detail, job-detail | 4 | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| c2160cbb | best practice | region | moderate | .MuiSelect-select | 13: column-definition-detail, column-definitions, connector-detail, entities, entity-detail, entity-groups, +7 more | 13 | roles: admin, member, owner · states: empty, error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| f1618523 | best practice | region | moderate | .MuiStack-root > .MuiBox-root | 1: connector-detail | 1 | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| f784edc5 | best practice | region | moderate | .MuiStack-root > .MuiStack-root | 3: entity-detail, help, stations | 3 | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| ebfd3502 | best practice | region | moderate | .MuiTabs-root | 3: connectors, help, settings | 3 | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 7b00596d | best practice | region | moderate | .MuiTypography-body1 | 6: column-definitions, connectors, entities, entity-groups, tags, toolpacks | 6 | roles: member · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| c7443303 | best practice | region | moderate | .MuiTypography-body2 | 1: station-detail | 1 | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| f2fab31b | best practice | region | moderate | .MuiTypography-caption | 19: column-definition-detail, column-definitions, connector-detail, connectors, entities, entity-detail, +13 more | 19 | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 0b0eec8a | best practice | region | moderate | #_r_5_ | 8: column-definitions, entities, entity-detail, entity-groups, jobs, portal-results, +2 more | 8 | roles: admin, member, owner · states: empty, error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 94e71b13 | best practice | region | moderate | #_r_6_ | 1: stations | 1 | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| e7a3f965 | best practice | region | moderate | #_r_7_ | 2: column-definition-detail, connector-detail | 2 | roles: member · states: locked, populated · themes: brand, brand.dark | axe-app |
| 4c984270 | best practice | region | moderate | #_r_8_-label | 1: entity-detail | 1 | roles: admin · states: populated · themes: brand, brand.dark | axe-app |
| 274bbcff | best practice | region | moderate | #_r_9_ | 1: column-definition-detail | 1 | roles: admin, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 851a125f | best practice | region | moderate | #_r_a_ | 1: toolpacks | 1 | roles: admin, owner · states: empty, populated · themes: brand, brand.dark | axe-app |
| 87abde1b | best practice | region | moderate | #_r_b_ | 1: entity-detail | 1 | roles: admin, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 5e2cd754 | best practice | region | moderate | #_r_e_ | 1: entity-detail | 1 | roles: admin · states: populated · themes: brand, brand.dark | axe-app |
| 5013159d | best practice | region | moderate | #_r_g_ | 1: connector-detail | 1 | roles: admin, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 226da632 | best practice | region | moderate | #_r_k_-label | 1: entity-detail | 1 | roles: admin, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 71fa8b83 | best practice | region | moderate | #_r_m_ | 1: station-detail | 1 | roles: member · states: populated · themes: brand, brand.dark | axe-app |
| 5f40cc2f | best practice | region | moderate | #_r_n_ | 1: station-detail | 1 | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 9009b2e1 | best practice | region | moderate | #tabpanel-0 | 3: connectors, help, settings | 3 | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| eb5b3d95 | best practice | region | moderate | h1 | 20: column-definition-detail, column-definitions, connector-detail, connectors, dashboard, entities, +14 more | 20 | roles: admin, member, owner · states: empty, error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| ce90a969 | best practice | region | moderate | h2 | 4: column-definition-detail, connector-detail, job-detail, station-detail | 4 | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 98554026 | best practice | region | moderate | h4 | 6: column-definitions, connectors, entities, entity-groups, tags, toolpacks | 6 | roles: member · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| aedc54dc | best practice | region | moderate | h6 | 10: column-definition-detail, column-definitions, entities, entity-groups, jobs, portal-results, +4 more | 10 | roles: admin, member, owner · states: empty, locked, populated · themes: brand, brand.dark | axe-app |
| 3526dddb | best practice | region | moderate | label > .Mui-checked.MuiCheckbox-root.MuiCheckbox-colorPrimary > .PrivateSwitchBase-input[data-indeterminate="false"] | 1: connector-detail | 2 | roles: admin, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| c0f1e321 | best practice | region | moderate | label > .MuiCheckbox-root.MuiCheckbox-colorPrimary.MuiCheckbox-sizeSmall > .PrivateSwitchBase-input[data-indeterminate="false"] | 1: connector-detail | 2 | roles: admin, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| c5a05068 | best practice | region | moderate | label > .MuiFormControlLabel-label.MuiTypography-body1 | 1: connector-detail | 4 | roles: admin, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 6bb07007 | best practice | region | moderate | pre | 2: connector-detail, job-detail | 2 | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 9be769da | best practice | region | moderate | span[data-mui-internal-clone-element="true"] | 1: connector-detail | 1 | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 8d5104e0 | best practice | region | moderate | tbody | 2: entity-detail, toolpacks | 2 | roles: admin, member, owner · states: empty, locked, populated · themes: brand, brand.dark | axe-app |
| bc053425 | best practice | region | moderate | th | 2: entity-detail, toolpacks | 5 | roles: admin, member, owner · states: empty, locked, populated · themes: brand, brand.dark | axe-app |
| 0a73a342 | best practice | region | moderate | th > .MuiTypography-caption.MuiTypography-root | 1: entity-detail | 6 | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |

<a id="owner-798"></a>

## #798 Marketing site

| ID | WCAG | Rule | Impact | Element | Where | Instances | Seen | Tool |
|---|---|---|---|---|---|---|---|---|
| 4d3735b0 | 1.4.3 | color-contrast | serious | .button | 4: /features/, /privacy/, /security/, /terms/ | 4 | themes: brand.dark | axe-site |
| 05b7eb45 | 1.4.3 | color-contrast | serious | .button--primary | 1: /use-cases/ | 1 | themes: brand.dark | axe-site |
| 5619744d | 1.4.3 | color-contrast | serious | .button--primary.button[href$="mailto:qa@portalsai.io"] | 1: /contact/ | 1 | themes: brand.dark | axe-site |
| 0ce85bcb | 1.4.3 | color-contrast | serious | .button.button--primary[href="/"] | 1: /404.html | 1 | themes: brand.dark | axe-site |
| ec44c0e0 | 1.4.3 | color-contrast | serious | .card > .button--primary.button[href$="app-dev.portalsai.io"] | 1: /pricing/ | 3 | themes: brand.dark | axe-site |
| 4226979d | 1.4.3 | color-contrast | serious | .site-header__actions > .button--primary.button[href$="app-dev.portalsai.io"] | 5: /, /pricing/, /use-cases/analysts/, /use-cases/founders/, /use-cases/operations/ | 5 | themes: brand.dark | axe-site |
| 8c8d2f4f | 1.4.3 | color-contrast | serious | a[href$="app-dev.portalsai.io"] | 2: /404.html, /contact/ | 2 | themes: brand.dark | axe-site |
| 510cbf8b | 1.4.3 | color-contrast | serious | p > .button--primary.button[href$="app-dev.portalsai.io"] | 4: /, /use-cases/analysts/, /use-cases/founders/, /use-cases/operations/ | 4 | themes: brand.dark | axe-site |

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
| KB-01 | All app pages | first Tab | 2.4.1 | No skip link and no `<main>` to skip to. Reaching page content means tabbing through the header and all 14 sidebar items. | keyboard | #797 |
| KB-02 | Station → portal → pin; CSV import → records; Curated view | page load | 2.4.3 | List pages auto-focus the Search field on load (`PaginationToolbar`; also jsx-a11y `no-autofocus`). The first Tab lands in the list, and the header and navigation come only after the page content. | keyboard | #794 |
| KB-03 | All app pages | sidebar | 4.1.2, 2.4.4 | The 14 sidebar entries are `div[role="button"]` with no accessible name, so each is announced as an unnamed "button". They navigate, so they should be links. | keyboard | #797 |
| KB-04 | All app pages | header | 2.4.7 | The theme switcher shows no focus indicator. | keyboard | #797 |
| KB-05 | All app pages | sidebar | 2.4.7 | A focused sidebar entry shows only a faint grey tint, hard to tell from its unfocused state. | keyboard | #797 |
| KB-06 | All app pages | sidebar | 2.5.8 | The sidebar toggle target is 16×32 px, under the 24 px minimum with no spacing exception. | keyboard | #797 |
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

| ID | Flow | Step | WCAG | Observed | AT | Owner |
|---|---|---|---|---|---|---|
