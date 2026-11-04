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
| `packages/e2e/a11y-results/app.json` | axe-app | 4.14.0 | 414 | 24 |
| `packages/e2e/a11y-results/site.json` | axe-site | 4.14.0 | 24 | 0 |

Skipped runs (not audited; each is a coverage gap until it renders):

- `apps/web/a11y-results/stories.json` · apps/web/src/stories/FAQList.component.stories.tsx › Default: Cannot read properties of undefined (reading 'has')
- `apps/web/a11y-results/stories.json` · apps/web/src/stories/FAQList.component.stories.tsx › FilteredToJobs: Cannot read properties of undefined (reading 'has')
- `apps/web/a11y-results/stories.json` · apps/web/src/stories/FAQList.component.stories.tsx › GroupedByCategory: Cannot read properties of undefined (reading 'has')
- `apps/web/a11y-results/stories.json` · apps/web/src/stories/GlossaryList.component.stories.tsx › Default: Cannot read properties of undefined (reading 'has')
- `apps/web/a11y-results/stories.json` · apps/web/src/stories/GlossaryList.component.stories.tsx › FilteredToAnalytics: Cannot read properties of undefined (reading 'has')
- `packages/e2e/a11y-results/app.json` · entity-group-detail · owner · populated · brand: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · portal · owner · populated · brand: nothing to drill into at step 2: /api/portals on /stations/5a26b111-c344-41bc-ad44-6414edd439eb returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · owner · populated · brand: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · owner · populated · brand: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · owner · populated · brand.dark: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · portal · owner · populated · brand.dark: nothing to drill into at step 2: /api/portals on /stations/5a26b111-c344-41bc-ad44-6414edd439eb returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · owner · populated · brand.dark: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · owner · populated · brand.dark: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · admin · populated · brand: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · portal · admin · populated · brand: nothing to drill into at step 2: /api/portals on /stations/5a26b111-c344-41bc-ad44-6414edd439eb returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · admin · populated · brand: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · admin · populated · brand: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · admin · populated · brand.dark: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · portal · admin · populated · brand.dark: nothing to drill into at step 2: /api/portals on /stations/5a26b111-c344-41bc-ad44-6414edd439eb returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · admin · populated · brand.dark: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · admin · populated · brand.dark: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · member · populated · brand: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · portal · member · populated · brand: nothing to drill into at step 2: /api/portals on /stations/5a26b111-c344-41bc-ad44-6414edd439eb returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · member · populated · brand: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · member · populated · brand: nothing to drill into at step 1: /api/curated-views on /views returned no item
- `packages/e2e/a11y-results/app.json` · entity-group-detail · member · populated · brand.dark: nothing to drill into at step 1: /api/entity-groups on /entity-groups returned no item
- `packages/e2e/a11y-results/app.json` · portal · member · populated · brand.dark: nothing to drill into at step 2: /api/portals on /stations/5a26b111-c344-41bc-ad44-6414edd439eb returned no item
- `packages/e2e/a11y-results/app.json` · portal-result-detail · member · populated · brand.dark: nothing to drill into at step 1: /api/portal-results on /portal-results returned no item
- `packages/e2e/a11y-results/app.json` · view-detail · member · populated · brand.dark: nothing to drill into at step 1: /api/curated-views on /views returned no item

## Summary

| Owner | Automated findings | WCAG criteria | Keyboard / screen-reader findings |
|---|---|---|---|
| [#793 Dialogs and forms](#owner-793) | 92 | 1.4.3, 2.5.3, 4.1.2 | 0 |
| [#794 Tables, grids and lists](#owner-794) | 311 | 1.4.3, 2.5.3, 4.1.2 | 2 |
| [#795 RegionEditor spreadsheet canvas](#owner-795) | 51 | 2.5.3, 4.1.2 | 1 |
| [#796 Maps and charts](#owner-796) | 0 | — | 1 |
| [#797 App shell, navigation and landmarks](#owner-797) | 421 | 1.1.1, 1.3.1, 1.4.3, 2.1.1, 2.5.3, 4.1.2 | 5 |
| [#798 Marketing site](#owner-798) | 21 | 1.4.3 | 1 |
| Unassigned | 0 | — | 0 |

<a id="owner-793"></a>

## #793 Dialogs and forms

| ID | WCAG | Rule | Impact | Location | Seen | Tool |
|---|---|---|---|---|---|---|
| c977c780 | 1.4.3 | color-contrast | serious | invitation-accept .MuiButton-contained | states: populated · themes: brand.dark | axe-app |
| 520b7b7b | 1.4.3 | color-contrast | serious | login .MuiButton-contained | states: populated · themes: brand.dark | axe-app |
| 8524340f | 1.4.3 | color-contrast | serious | not-invited .MuiButton-contained | states: populated · themes: brand.dark | axe-app |
| b85075a4 | 2.5.3 | label-content-name-mismatch | serious | settings | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| 5d95032a | 4.1.2 | aria-command-name | serious | settings .Mui-selected.MuiListItemButton-root.MuiListItemButton-gutters | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| 664802d7 | 4.1.2 | aria-command-name | serious | settings .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(10) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 71c80a8c | 4.1.2 | aria-command-name | serious | settings .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(11) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| f39f8e46 | 4.1.2 | aria-command-name | serious | settings .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | roles: admin, member, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| 4153344a | 4.1.2 | aria-command-name | serious | settings .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | roles: admin, member, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| 523a73e7 | 4.1.2 | aria-command-name | serious | settings .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(4) | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| c5700e86 | 4.1.2 | aria-command-name | serious | settings .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(5) | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 963ad233 | 4.1.2 | aria-command-name | serious | settings .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(6) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 18b83c79 | 4.1.2 | aria-command-name | serious | settings .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(7) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 3d25b14c | 4.1.2 | aria-command-name | serious | settings .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(8) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 6641951b | 4.1.2 | aria-command-name | serious | settings .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(9) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 59491158 | 4.1.2 | aria-command-name | serious | settings > .MuiListItemButton-root.MuiListItemButton-gutters | roles: admin, member, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| 86e34dd1 | 4.1.2 | aria-command-name | serious | settings > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(1) | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 32709968 | 4.1.2 | aria-command-name | serious | settings > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 9aa99fe9 | 4.1.2 | aria-command-name | serious | settings > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 57fef932 | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/AdvancedFilterBuilder.component.stories.tsx › BetweenOperators .MuiBox-root:nth-child(1) > .MuiFormControl-root > .MuiSelect-root.MuiInputBase-root > .MuiSelect-select.MuiSelect-outlined | — | jest-axe |
| a7656798 | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/AdvancedFilterBuilder.component.stories.tsx › BetweenOperators .MuiBox-root:nth-child(2) > .MuiFormControl-root > .MuiSelect-root.MuiInputBase-root > .MuiSelect-select.MuiSelect-outlined | — | jest-axe |
| bb2be09c | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/AdvancedFilterBuilder.component.stories.tsx › EmptyAndArrayOperators .MuiBox-root:nth-child(1) > .MuiFormControl-root > .MuiSelect-root.MuiInputBase-root > .MuiSelect-select.MuiSelect-outlined | — | jest-axe |
| e9d0e27d | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/AdvancedFilterBuilder.component.stories.tsx › EmptyAndArrayOperators .MuiBox-root:nth-child(2) > .MuiFormControl-root > .MuiSelect-root.MuiInputBase-root > .MuiSelect-select.MuiSelect-outlined | — | jest-axe |
| f4ff31ab | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/AdvancedFilterBuilder.component.stories.tsx › EmptyAndArrayOperators .MuiBox-root:nth-child(3) > .MuiFormControl-root > .MuiSelect-root.MuiInputBase-root > .MuiSelect-select.MuiSelect-outlined | — | jest-axe |
| 0b832c00 | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/AdvancedFilterBuilder.component.stories.tsx › MaxDepthReached .MuiBox-root > .MuiBox-root > .MuiBox-root > .MuiBox-root > .MuiBox-root > .MuiBox-root > .MuiBox-root:nth-child(1) > .MuiFormControl-root > .MuiSelect-root.MuiInputBase-root > .MuiSelect-select.MuiSelect-outlined | — | jest-axe |
| e2bb6070 | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/AdvancedFilterBuilder.component.stories.tsx › MaxDepthReached .MuiBox-root:nth-child(2) > .MuiFormControl-root > .MuiSelect-root.MuiInputBase-root > .MuiSelect-select.MuiSelect-outlined | — | jest-axe |
| 3c02070e | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/AdvancedFilterBuilder.component.stories.tsx › MaxDepthReached > .MuiBox-root > .MuiBox-root > .MuiBox-root > .MuiBox-root > .MuiBox-root > .MuiBox-root > .MuiFormControl-root > .MuiSelect-root.MuiInputBase-root > .MuiSelect-select.MuiSelect-outlined | — | jest-axe |
| e6521b26 | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/AdvancedFilterBuilder.component.stories.tsx › MaxDepthReached > .MuiBox-root > .MuiBox-root > .MuiBox-root > .MuiBox-root > .MuiFormControl-root > .MuiSelect-root.MuiInputBase-root > .MuiSelect-select.MuiSelect-outlined | — | jest-axe |
| 87612a32 | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/AdvancedFilterBuilder.component.stories.tsx › MaxDepthReached > .MuiBox-root > .MuiBox-root > .MuiFormControl-root > .MuiSelect-root.MuiInputBase-root > .MuiSelect-select.MuiSelect-outlined | — | jest-axe |
| 179ddf30 | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/AdvancedFilterBuilder.component.stories.tsx › Populated .MuiBox-root:nth-child(3) > .MuiFormControl-root > .MuiSelect-root.MuiInputBase-root > .MuiSelect-select.MuiSelect-outlined | — | jest-axe |
| 220a362a | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/AdvancedFilterBuilder.component.stories.tsx › Populated > .MuiBox-root > .MuiBox-root:nth-child(1) > .MuiFormControl-root > .MuiSelect-root.MuiInputBase-root > .MuiSelect-select.MuiSelect-outlined | — | jest-axe |
| 00646725 | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/AdvancedFilterBuilder.component.stories.tsx › Populated > .MuiBox-root > .MuiBox-root:nth-child(2) > .MuiFormControl-root > .MuiSelect-root.MuiInputBase-root > .MuiSelect-select.MuiSelect-outlined | — | jest-axe |
| a7fbae89 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/workflows/FileUploadConnector/stories/FileUploadConnectorWorkflow.stories.tsx › Step1_Empty div[data-corner-header=""] | — | jest-axe |
| 2efa1515 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/workflows/FileUploadConnector/stories/FileUploadConnectorWorkflow.stories.tsx › Step1_InvalidRegion | — | jest-axe |
| b746b80a | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/workflows/FileUploadConnector/stories/FileUploadConnectorWorkflow.stories.tsx › Step1_InvalidRegion div[data-corner-header=""] | — | jest-axe |
| dd700696 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/workflows/FileUploadConnector/stories/FileUploadConnectorWorkflow.stories.tsx › Step1_RegionsDrawn_Valid | — | jest-axe |
| 8bfed7f9 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/workflows/FileUploadConnector/stories/FileUploadConnectorWorkflow.stories.tsx › Step1_RegionsDrawn_Valid div[data-corner-header=""] | — | jest-axe |
| 862fc3cc | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/workflows/FileUploadConnector/stories/FileUploadRegionDrawingStep.stories.tsx › Empty div[data-corner-header=""] | — | jest-axe |
| 3b86098a | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/workflows/FileUploadConnector/stories/FileUploadRegionDrawingStep.stories.tsx › InvalidRegion_AttemptedInterpret | — | jest-axe |
| db271dd6 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/workflows/FileUploadConnector/stories/FileUploadRegionDrawingStep.stories.tsx › InvalidRegion_AttemptedInterpret div[data-corner-header=""] | — | jest-axe |
| c8f0d178 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/workflows/FileUploadConnector/stories/FileUploadRegionDrawingStep.stories.tsx › MultipleRegions_MergedEntity div[data-corner-header=""] | — | jest-axe |
| 1413b8e1 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/workflows/FileUploadConnector/stories/FileUploadRegionDrawingStep.stories.tsx › OneRegion_Valid | — | jest-axe |
| f3f0ad65 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/workflows/FileUploadConnector/stories/FileUploadRegionDrawingStep.stories.tsx › OneRegion_Valid div[data-corner-header=""] | — | jest-axe |
| 78ab7bbc | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/workflows/FileUploadConnector/stories/FileUploadRegionDrawingStep.stories.tsx › ServerError | — | jest-axe |
| f6c87935 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/workflows/FileUploadConnector/stories/FileUploadRegionDrawingStep.stories.tsx › ServerError div[data-corner-header=""] | — | jest-axe |
| f580ec3e | 4.1.2 | button-name | critical | packages/core/src/stories/IconButton.stories.tsx › Default button | — | jest-axe |
| 473d82b7 | 4.1.2 | label | critical | apps/web/src/stories/AdvancedFilterBuilder.component.stories.tsx › BetweenOperators #_r_kl_ | — | jest-axe |
| 977aba06 | 4.1.2 | label | critical | apps/web/src/stories/AdvancedFilterBuilder.component.stories.tsx › BetweenOperators #_r_km_ | — | jest-axe |
| 1a514589 | 4.1.2 | label | critical | apps/web/src/stories/AdvancedFilterBuilder.component.stories.tsx › MaxDepthReached #_r_m2_ | — | jest-axe |
| 6edb4792 | best practice | aria-allowed-role | minor | apps/web/src/stories/CuratedViewEditorDialog.component.stories.tsx › Create form | — | jest-axe |
| c6aabcdd | best practice | aria-allowed-role | minor | apps/web/src/stories/CuratedViewEditorDialog.component.stories.tsx › Edit form | — | jest-axe |
| 94cacdf9 | best practice | aria-allowed-role | minor | apps/web/src/stories/CuratedViewEditorDialog.component.stories.tsx › Saving form | — | jest-axe |
| f7f0773a | best practice | aria-allowed-role | minor | apps/web/src/stories/CuratedViewEditorDialog.component.stories.tsx › SqlMode form | — | jest-axe |
| fc954c0d | best practice | aria-allowed-role | minor | apps/web/src/stories/CuratedViewEditorDialog.component.stories.tsx › SqlModeUpsell form | — | jest-axe |
| 9926bb2b | best practice | aria-allowed-role | minor | apps/web/src/stories/CuratedViewEditorDialog.component.stories.tsx › WithValidationError form | — | jest-axe |
| c5b0b4cc | best practice | aria-allowed-role | minor | apps/web/src/stories/DeleteCuratedViewDialog.component.stories.tsx › Default form | — | jest-axe |
| 79f61927 | best practice | aria-allowed-role | minor | apps/web/src/stories/DeleteCuratedViewDialog.component.stories.tsx › Deleting form | — | jest-axe |
| e1a82388 | best practice | aria-allowed-role | minor | apps/web/src/stories/DeleteCuratedViewDialog.component.stories.tsx › WithError form | — | jest-axe |
| 6d633706 | best practice | aria-allowed-role | minor | apps/web/src/stories/DeleteTagDialog.component.stories.tsx › Default form | — | jest-axe |
| 39e279e6 | best practice | aria-allowed-role | minor | apps/web/src/stories/DeleteTagDialog.component.stories.tsx › Deleting form | — | jest-axe |
| 2f874701 | best practice | aria-allowed-role | minor | apps/web/src/stories/DeleteTagDialog.component.stories.tsx › DifferentTag form | — | jest-axe |
| 8ecf09f7 | best practice | aria-allowed-role | minor | apps/web/src/stories/RenameOrganizationDialog.component.stories.tsx › Default form | — | jest-axe |
| acb2bc0b | best practice | aria-allowed-role | minor | apps/web/src/stories/RenameOrganizationDialog.component.stories.tsx › PermissionDenied form | — | jest-axe |
| abe9c408 | best practice | aria-allowed-role | minor | apps/web/src/stories/RenameOrganizationDialog.component.stories.tsx › Saving form | — | jest-axe |
| bdd5c899 | best practice | aria-allowed-role | minor | apps/web/src/stories/TagFormModal.component.stories.tsx › CreateMode form | — | jest-axe |
| 723d9d69 | best practice | aria-allowed-role | minor | apps/web/src/stories/TagFormModal.component.stories.tsx › EditMode form | — | jest-axe |
| b298674c | best practice | aria-allowed-role | minor | apps/web/src/stories/TagFormModal.component.stories.tsx › EditWithServerError form | — | jest-axe |
| a5217c47 | best practice | aria-allowed-role | minor | apps/web/src/stories/TagFormModal.component.stories.tsx › ServerError form | — | jest-axe |
| be509365 | best practice | aria-allowed-role | minor | apps/web/src/stories/TagFormModal.component.stories.tsx › Submitting form | — | jest-axe |
| 32ac7003 | best practice | heading-order | moderate | apps/web/src/stories/CuratedViewEditorDialog.component.stories.tsx › Create h6 | — | jest-axe |
| f473f54c | best practice | heading-order | moderate | apps/web/src/stories/CuratedViewEditorDialog.component.stories.tsx › Edit h6 | — | jest-axe |
| a5882495 | best practice | heading-order | moderate | apps/web/src/stories/CuratedViewEditorDialog.component.stories.tsx › Saving h6 | — | jest-axe |
| dd56cd1a | best practice | heading-order | moderate | apps/web/src/stories/CuratedViewEditorDialog.component.stories.tsx › SqlMode h6 | — | jest-axe |
| 48a2bfff | best practice | heading-order | moderate | apps/web/src/stories/CuratedViewEditorDialog.component.stories.tsx › SqlModeUpsell h6 | — | jest-axe |
| 3a7de840 | best practice | heading-order | moderate | apps/web/src/stories/CuratedViewEditorDialog.component.stories.tsx › WithValidationError h6 | — | jest-axe |
| d66cbae4 | best practice | heading-order | moderate | apps/web/src/stories/TagFormModal.component.stories.tsx › CreateMode h6 | — | jest-axe |
| bec6c030 | best practice | heading-order | moderate | apps/web/src/stories/TagFormModal.component.stories.tsx › EditMode h6 | — | jest-axe |
| 09522a1e | best practice | heading-order | moderate | apps/web/src/stories/TagFormModal.component.stories.tsx › EditWithServerError h6 | — | jest-axe |
| d5c0e005 | best practice | heading-order | moderate | apps/web/src/stories/TagFormModal.component.stories.tsx › ServerError h6 | — | jest-axe |
| 26e88e4a | best practice | heading-order | moderate | apps/web/src/stories/TagFormModal.component.stories.tsx › Submitting h6 | — | jest-axe |
| eb346847 | best practice | heading-order | moderate | apps/web/src/stories/ToolpackMetadataModal.component.stories.tsx › Default h6 | — | jest-axe |
| 4da4b4b5 | best practice | heading-order | moderate | apps/web/src/stories/ToolpackMetadataModal.component.stories.tsx › Unentitled h6 | — | jest-axe |
| 28c6cb00 | best practice | heading-order | moderate | apps/web/src/workflows/FileUploadConnector/stories/FileUploadConnectorWorkflow.stories.tsx › Step1_Empty h6 | — | jest-axe |
| 5d00afcf | best practice | heading-order | moderate | apps/web/src/workflows/FileUploadConnector/stories/FileUploadConnectorWorkflow.stories.tsx › Step1_InvalidRegion .MuiTypography-subtitle1 | — | jest-axe |
| 1bfea963 | best practice | heading-order | moderate | apps/web/src/workflows/FileUploadConnector/stories/FileUploadConnectorWorkflow.stories.tsx › Step1_RegionsDrawn_Valid .MuiTypography-subtitle1 | — | jest-axe |
| 1ad26da9 | best practice | heading-order | moderate | apps/web/src/workflows/FileUploadConnector/stories/FileUploadConnectorWorkflow.stories.tsx › Step2_AllGreen .MuiTypography-subtitle1 | — | jest-axe |
| c2c2a270 | best practice | heading-order | moderate | apps/web/src/workflows/FileUploadConnector/stories/FileUploadConnectorWorkflow.stories.tsx › Step2_BlockerPresent .MuiTypography-subtitle1 | — | jest-axe |
| cd0c8664 | best practice | heading-order | moderate | settings .MuiStack-root:nth-child(5) > h6 | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| e77df5df | best practice | image-redundant-alt | minor | settings > img | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| ab76f9e3 | best practice | image-redundant-alt | minor | settings img | roles: admin, member, owner · states: loading · themes: brand, brand.dark | axe-app |
| c843f082 | best practice | jsx-a11y/no-autofocus | — | apps/web/src/components/ChatWindow.component.tsx:288 | — | eslint |
| fc6ce63c | best practice | jsx-a11y/no-autofocus | — | apps/web/src/components/SsoLoginForm.component.tsx:108 | — | eslint |

<a id="owner-794"></a>

## #794 Tables, grids and lists

| ID | WCAG | Rule | Impact | Location | Seen | Tool |
|---|---|---|---|---|---|---|
| 3e63968f | 1.4.3 | color-contrast | serious | column-definitions .MuiButton-contained | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand.dark | axe-app |
| 491da1b4 | 1.4.3 | color-contrast | serious | connectors .MuiButton-contained | roles: member · states: loading, populated · themes: brand.dark | axe-app |
| dc350cfe | 1.4.3 | color-contrast | serious | connectors .MuiPaper-outlined.MuiPaper-rounded.MuiCard-root:nth-child(1) > .MuiStack-root > .MuiBox-root > .MuiStack-root > .MuiButton-outlinedError.MuiButton-colorError | roles: admin, owner · states: populated · themes: brand.dark | axe-app |
| a825d3af | 1.4.3 | color-contrast | serious | connectors .MuiPaper-outlined.MuiPaper-rounded.MuiCard-root:nth-child(2) > .MuiStack-root > .MuiBox-root > .MuiStack-root > .MuiButton-outlinedError.MuiButton-colorError | roles: admin, owner · states: populated · themes: brand.dark | axe-app |
| f74fa641 | 1.4.3 | color-contrast | serious | connectors .MuiPaper-outlined.MuiPaper-rounded.MuiCard-root:nth-child(3) > .MuiStack-root > .MuiBox-root > .MuiStack-root > .MuiButton-outlinedError.MuiButton-colorError | roles: admin, owner · states: populated · themes: brand.dark | axe-app |
| ed8877f0 | 1.4.3 | color-contrast | serious | connectors .MuiPaper-outlined.MuiPaper-rounded.MuiCard-root:nth-child(4) > .MuiStack-root > .MuiBox-root > .MuiStack-root > .MuiButton-outlinedError.MuiButton-colorError | roles: admin, owner · states: populated · themes: brand.dark | axe-app |
| 0382059c | 1.4.3 | color-contrast | serious | connectors .MuiPaper-outlined.MuiPaper-rounded.MuiCard-root:nth-child(5) > .MuiStack-root > .MuiBox-root > .MuiStack-root > .MuiButton-outlinedError.MuiButton-colorError | roles: admin, owner · states: populated · themes: brand.dark | axe-app |
| c88ab3c0 | 1.4.3 | color-contrast | serious | entities .MuiButton-contained | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand.dark | axe-app |
| 6a5ce735 | 1.4.3 | color-contrast | serious | entities .MuiPaper-outlined.MuiPaper-rounded.MuiCard-root:nth-child(1) > .MuiStack-root > .MuiBox-root > .MuiStack-root > .MuiButton-outlinedError.MuiButton-colorError | roles: admin, owner · states: populated · themes: brand.dark | axe-app |
| cbc23799 | 1.4.3 | color-contrast | serious | entities .MuiPaper-outlined.MuiPaper-rounded.MuiCard-root:nth-child(10) > .MuiStack-root > .MuiBox-root > .MuiStack-root > .MuiButton-outlinedError.MuiButton-colorError | roles: admin, owner · states: populated · themes: brand.dark | axe-app |
| be0fc525 | 1.4.3 | color-contrast | serious | entities .MuiPaper-outlined.MuiPaper-rounded.MuiCard-root:nth-child(2) > .MuiStack-root > .MuiBox-root > .MuiStack-root > .MuiButton-outlinedError.MuiButton-colorError | roles: admin, owner · states: populated · themes: brand.dark | axe-app |
| 4d6fe5de | 1.4.3 | color-contrast | serious | entities .MuiPaper-outlined.MuiPaper-rounded.MuiCard-root:nth-child(3) > .MuiStack-root > .MuiBox-root > .MuiStack-root > .MuiButton-outlinedError.MuiButton-colorError | roles: admin, owner · states: populated · themes: brand.dark | axe-app |
| 8393972f | 1.4.3 | color-contrast | serious | entities .MuiPaper-outlined.MuiPaper-rounded.MuiCard-root:nth-child(4) > .MuiStack-root > .MuiBox-root > .MuiStack-root > .MuiButton-outlinedError.MuiButton-colorError | roles: admin, owner · states: populated · themes: brand.dark | axe-app |
| 9a9258a7 | 1.4.3 | color-contrast | serious | entities .MuiPaper-outlined.MuiPaper-rounded.MuiCard-root:nth-child(5) > .MuiStack-root > .MuiBox-root > .MuiStack-root > .MuiButton-outlinedError.MuiButton-colorError | roles: admin, owner · states: populated · themes: brand.dark | axe-app |
| de8cb541 | 1.4.3 | color-contrast | serious | entities .MuiPaper-outlined.MuiPaper-rounded.MuiCard-root:nth-child(6) > .MuiStack-root > .MuiBox-root > .MuiStack-root > .MuiButton-outlinedError.MuiButton-colorError | roles: admin, owner · states: populated · themes: brand.dark | axe-app |
| 28163514 | 1.4.3 | color-contrast | serious | entities .MuiPaper-outlined.MuiPaper-rounded.MuiCard-root:nth-child(7) > .MuiStack-root > .MuiBox-root > .MuiStack-root > .MuiButton-outlinedError.MuiButton-colorError | roles: admin, owner · states: populated · themes: brand.dark | axe-app |
| 2b8a0c2f | 1.4.3 | color-contrast | serious | entities .MuiPaper-outlined.MuiPaper-rounded.MuiCard-root:nth-child(8) > .MuiStack-root > .MuiBox-root > .MuiStack-root > .MuiButton-outlinedError.MuiButton-colorError | roles: admin, owner · states: populated · themes: brand.dark | axe-app |
| 733cebed | 1.4.3 | color-contrast | serious | entities .MuiPaper-outlined.MuiPaper-rounded.MuiCard-root:nth-child(9) > .MuiStack-root > .MuiBox-root > .MuiStack-root > .MuiButton-outlinedError.MuiButton-colorError | roles: admin, owner · states: populated · themes: brand.dark | axe-app |
| fe61b410 | 1.4.3 | color-contrast | serious | entity-groups .MuiButton-contained | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand.dark | axe-app |
| 9b74b8b2 | 1.4.3 | color-contrast | serious | entity-groups > .MuiButton-contained.MuiButton-containedPrimary.MuiButton-sizeMedium | roles: admin, owner · states: empty, populated · themes: brand.dark | axe-app |
| 57b76123 | 1.4.3 | color-contrast | serious | job-detail | roles: admin, member, owner · states: populated · themes: brand.dark | axe-app |
| ff4a6bd7 | 1.4.3 | color-contrast | serious | job-detail .MuiChip-label | roles: admin, member, owner · states: populated · themes: brand.dark | axe-app |
| 957be8be | 1.4.3 | color-contrast | serious | jobs .MuiPaper-outlined.MuiPaper-rounded.MuiCard-root:nth-child(1) > .MuiStack-root > .MuiCardActionArea-root > .MuiCardContent-root > .MuiStack-root > .MuiBox-root > .MuiStack-root > .MuiBox-root > .MuiChip-colorError.MuiChip-outlinedError > .MuiChip-label.MuiChip-labelSmall | roles: admin, member, owner · states: populated · themes: brand.dark | axe-app |
| 8e2f8804 | 1.4.3 | color-contrast | serious | jobs .MuiPaper-outlined.MuiPaper-rounded.MuiCard-root:nth-child(2) > .MuiStack-root > .MuiCardActionArea-root > .MuiCardContent-root > .MuiStack-root > .MuiBox-root > .MuiStack-root > .MuiBox-root > .MuiChip-colorError.MuiChip-outlinedError > .MuiChip-label.MuiChip-labelSmall | roles: admin, member, owner · states: populated · themes: brand.dark | axe-app |
| 10600129 | 1.4.3 | color-contrast | serious | jobs .MuiPaper-outlined.MuiPaper-rounded.MuiCard-root:nth-child(3) > .MuiStack-root > .MuiCardActionArea-root > .MuiCardContent-root > .MuiStack-root > .MuiBox-root > .MuiStack-root > .MuiBox-root > .MuiChip-colorError.MuiChip-outlinedError > .MuiChip-label.MuiChip-labelSmall | roles: admin, member, owner · states: populated · themes: brand.dark | axe-app |
| aea92656 | 1.4.3 | color-contrast | serious | station-detail .MuiButton-contained | roles: admin, member, owner · states: populated · themes: brand.dark | axe-app |
| e12f1d65 | 1.4.3 | color-contrast | serious | stations .MuiButton-contained | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand.dark | axe-app |
| 47755595 | 1.4.3 | color-contrast | serious | stations .MuiButton-outlinedError | roles: admin, owner · states: populated · themes: brand.dark | axe-app |
| a828ba65 | 1.4.3 | color-contrast | serious | tags .MuiButton-contained | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand.dark | axe-app |
| 5774ea5a | 1.4.3 | color-contrast | serious | tags > .MuiButton-contained.MuiButton-containedPrimary.MuiButton-sizeMedium | roles: admin, owner · states: empty, populated · themes: brand.dark | axe-app |
| baa13e27 | 1.4.3 | color-contrast | serious | toolpacks :nth-child(5) > :nth-child(2) > .MuiStack-root > .MuiChip-colorWarning.MuiChip-outlinedWarning > .MuiChip-label.MuiChip-labelSmall | roles: admin, owner · states: populated · themes: brand | axe-app |
| 9d9ac2e5 | 1.4.3 | color-contrast | serious | toolpacks :nth-child(6) > :nth-child(2) > .MuiStack-root > .MuiChip-colorWarning.MuiChip-outlinedWarning > .MuiChip-label.MuiChip-labelSmall | roles: admin, owner · states: populated · themes: brand | axe-app |
| f199ce28 | 1.4.3 | color-contrast | serious | toolpacks :nth-child(7) > :nth-child(2) > .MuiStack-root > .MuiChip-colorWarning.MuiChip-outlinedWarning > .MuiChip-label.MuiChip-labelSmall | roles: admin, owner · states: populated · themes: brand | axe-app |
| b741481c | 1.4.3 | color-contrast | serious | toolpacks :nth-child(8) > :nth-child(2) > .MuiStack-root > .MuiChip-colorWarning.MuiChip-outlinedWarning > .MuiChip-label.MuiChip-labelSmall | roles: admin, owner · states: populated · themes: brand | axe-app |
| 82d72217 | 1.4.3 | color-contrast | serious | toolpacks :nth-child(9) > :nth-child(2) > .MuiStack-root > .MuiChip-colorWarning.MuiChip-outlinedWarning > .MuiChip-label.MuiChip-labelSmall | roles: admin, owner · states: populated · themes: brand | axe-app |
| 7c8996ad | 1.4.3 | color-contrast | serious | toolpacks .MuiButton-contained | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand.dark | axe-app |
| 2000c3f3 | 1.4.3 | color-contrast | serious | views .MuiButton-contained | roles: admin, owner · states: error, loading · themes: brand.dark | axe-app |
| ad5f5f23 | 1.4.3 | color-contrast | serious | views > .MuiButton-contained.MuiButton-containedPrimary.MuiButton-sizeMedium | roles: admin, owner · states: empty, populated · themes: brand.dark | axe-app |
| b83de147 | 2.5.3 | label-content-name-mismatch | serious | column-definition-detail | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 8aaa96c9 | 2.5.3 | label-content-name-mismatch | serious | column-definitions | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| ed044dae | 2.5.3 | label-content-name-mismatch | serious | connector-detail | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 3c8df955 | 2.5.3 | label-content-name-mismatch | serious | connectors | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| ee0e3a1b | 2.5.3 | label-content-name-mismatch | serious | entities | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 82c4af79 | 2.5.3 | label-content-name-mismatch | serious | entity-detail | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 2c4e1e1c | 2.5.3 | label-content-name-mismatch | serious | entity-groups | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 2e92b89d | 2.5.3 | label-content-name-mismatch | serious | job-detail | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| a591c7fe | 2.5.3 | label-content-name-mismatch | serious | jobs | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 8a61897c | 2.5.3 | label-content-name-mismatch | serious | portal-results | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| bb3afcca | 2.5.3 | label-content-name-mismatch | serious | record-detail | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| c374f650 | 2.5.3 | label-content-name-mismatch | serious | station-detail | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| cb12c655 | 2.5.3 | label-content-name-mismatch | serious | stations | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| cb0dce9e | 2.5.3 | label-content-name-mismatch | serious | tags | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| be1efea6 | 2.5.3 | label-content-name-mismatch | serious | toolpacks | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| a04d648a | 2.5.3 | label-content-name-mismatch | serious | views | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 16cc2eae | 4.1.2 | aria-command-name | serious | column-definition-detail .Mui-selected | roles: admin, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| c9d85680 | 4.1.2 | aria-command-name | serious | column-definition-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(10) | roles: admin, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| ff46a688 | 4.1.2 | aria-command-name | serious | column-definition-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(11) | roles: admin, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 3a18d239 | 4.1.2 | aria-command-name | serious | column-definition-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(4) | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| c5760811 | 4.1.2 | aria-command-name | serious | column-definition-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(5) | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| ce4f3923 | 4.1.2 | aria-command-name | serious | column-definition-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(6) | roles: admin, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 19b29a77 | 4.1.2 | aria-command-name | serious | column-definition-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(7) | roles: admin, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| c935fc55 | 4.1.2 | aria-command-name | serious | column-definition-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(8) | roles: admin, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| b7c0dd8c | 4.1.2 | aria-command-name | serious | column-definition-detail > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(1) | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 13a46757 | 4.1.2 | aria-command-name | serious | column-definition-detail > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| c3d13c08 | 4.1.2 | aria-command-name | serious | column-definition-detail > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| a6b26253 | 4.1.2 | aria-command-name | serious | column-definitions .Mui-selected | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 943ae99e | 4.1.2 | aria-command-name | serious | column-definitions .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(10) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 89bf32fd | 4.1.2 | aria-command-name | serious | column-definitions .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(11) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 4ac863d0 | 4.1.2 | aria-command-name | serious | column-definitions .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(4) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| ac8e61d9 | 4.1.2 | aria-command-name | serious | column-definitions .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(5) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| e7d6ddde | 4.1.2 | aria-command-name | serious | column-definitions .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(6) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 3120b50d | 4.1.2 | aria-command-name | serious | column-definitions .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(7) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 8ff39ea3 | 4.1.2 | aria-command-name | serious | column-definitions .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(8) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| b5899951 | 4.1.2 | aria-command-name | serious | column-definitions > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(1) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| f318be49 | 4.1.2 | aria-command-name | serious | column-definitions > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| d870d19e | 4.1.2 | aria-command-name | serious | column-definitions > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 2241396b | 4.1.2 | aria-command-name | serious | connector-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(10) | roles: admin, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 605476c8 | 4.1.2 | aria-command-name | serious | connector-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(11) | roles: admin, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| d50aa2e1 | 4.1.2 | aria-command-name | serious | connector-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | roles: owner · states: locked · themes: brand.dark | axe-app |
| 079931a5 | 4.1.2 | aria-command-name | serious | connector-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | roles: owner · states: locked · themes: brand.dark | axe-app |
| ecdd0106 | 4.1.2 | aria-command-name | serious | connector-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(4) | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| c63d6e06 | 4.1.2 | aria-command-name | serious | connector-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(5) | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 01a451b0 | 4.1.2 | aria-command-name | serious | connector-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(6) | roles: admin, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 76b426c5 | 4.1.2 | aria-command-name | serious | connector-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(7) | roles: admin, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| c271932b | 4.1.2 | aria-command-name | serious | connector-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(8) | roles: admin, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| d608feab | 4.1.2 | aria-command-name | serious | connector-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(9) | roles: admin, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 3e827cdf | 4.1.2 | aria-command-name | serious | connector-detail > .MuiListItemButton-root.MuiListItemButton-gutters | roles: owner · states: locked · themes: brand.dark | axe-app |
| b9bdb263 | 4.1.2 | aria-command-name | serious | connector-detail > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(1) | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 8a44661b | 4.1.2 | aria-command-name | serious | connector-detail > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 4d9d519b | 4.1.2 | aria-command-name | serious | connector-detail > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| a2aa5acf | 4.1.2 | aria-command-name | serious | connectors .Mui-selected.MuiListItemButton-root.MuiListItemButton-gutters | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| a06d9d0d | 4.1.2 | aria-command-name | serious | connectors .MuiBox-root > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(1) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 50c1747f | 4.1.2 | aria-command-name | serious | connectors .MuiBox-root > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 4d8f198a | 4.1.2 | aria-command-name | serious | connectors .MuiBox-root > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| c8db2a0b | 4.1.2 | aria-command-name | serious | connectors .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(10) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| ad67f160 | 4.1.2 | aria-command-name | serious | connectors .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(11) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| b8a2f965 | 4.1.2 | aria-command-name | serious | connectors .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | roles: admin, member, owner · states: empty · themes: brand, brand.dark | axe-app |
| fd423724 | 4.1.2 | aria-command-name | serious | connectors .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | roles: admin, member, owner · states: empty · themes: brand, brand.dark | axe-app |
| 817fd44b | 4.1.2 | aria-command-name | serious | connectors .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(4) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 8e08b5cd | 4.1.2 | aria-command-name | serious | connectors .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(5) | roles: member · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| 6b469b6b | 4.1.2 | aria-command-name | serious | connectors .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(6) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 5f50ee00 | 4.1.2 | aria-command-name | serious | connectors .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(7) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 7bc4a8b9 | 4.1.2 | aria-command-name | serious | connectors .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(8) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| e745a19c | 4.1.2 | aria-command-name | serious | connectors .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(9) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 696e1662 | 4.1.2 | aria-command-name | serious | connectors > .MuiListItemButton-root.MuiListItemButton-gutters | roles: admin, member, owner · states: empty · themes: brand, brand.dark | axe-app |
| f079a8e1 | 4.1.2 | aria-command-name | serious | connectors > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(1) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 3dd6b10e | 4.1.2 | aria-command-name | serious | connectors > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 1caaeb9d | 4.1.2 | aria-command-name | serious | connectors > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| fae50cc4 | 4.1.2 | aria-command-name | serious | entities .Mui-selected | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| a3939cea | 4.1.2 | aria-command-name | serious | entities .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(10) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| fd8b6466 | 4.1.2 | aria-command-name | serious | entities .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(11) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 06c48a80 | 4.1.2 | aria-command-name | serious | entities .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(4) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 28284ea4 | 4.1.2 | aria-command-name | serious | entities .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(5) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| ed9193f3 | 4.1.2 | aria-command-name | serious | entities .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(7) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| a1cf664c | 4.1.2 | aria-command-name | serious | entities .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(8) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 56b0a19f | 4.1.2 | aria-command-name | serious | entities .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(9) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 4f412569 | 4.1.2 | aria-command-name | serious | entities > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(1) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 3ac0dd3a | 4.1.2 | aria-command-name | serious | entities > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| b7dd0d40 | 4.1.2 | aria-command-name | serious | entities > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| e3a5a718 | 4.1.2 | aria-command-name | serious | entity-detail .Mui-selected | roles: admin, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 01986568 | 4.1.2 | aria-command-name | serious | entity-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(10) | roles: admin, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| f269231b | 4.1.2 | aria-command-name | serious | entity-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(11) | roles: admin, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| f5743ec6 | 4.1.2 | aria-command-name | serious | entity-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(4) | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 90c9df48 | 4.1.2 | aria-command-name | serious | entity-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(5) | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 1d8e1638 | 4.1.2 | aria-command-name | serious | entity-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(7) | roles: admin, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 01564f4a | 4.1.2 | aria-command-name | serious | entity-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(8) | roles: admin, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 75899cdd | 4.1.2 | aria-command-name | serious | entity-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(9) | roles: admin, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 58c3ae05 | 4.1.2 | aria-command-name | serious | entity-detail > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(1) | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 91c3e142 | 4.1.2 | aria-command-name | serious | entity-detail > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 13155d0a | 4.1.2 | aria-command-name | serious | entity-detail > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 2f9b42a5 | 4.1.2 | aria-command-name | serious | entity-groups .Mui-selected | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 396990fa | 4.1.2 | aria-command-name | serious | entity-groups .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(10) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 76e3f6a7 | 4.1.2 | aria-command-name | serious | entity-groups .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(11) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 8162de3c | 4.1.2 | aria-command-name | serious | entity-groups .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(4) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| b9627261 | 4.1.2 | aria-command-name | serious | entity-groups .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(5) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 88d81ad9 | 4.1.2 | aria-command-name | serious | entity-groups .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(6) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 15c6233c | 4.1.2 | aria-command-name | serious | entity-groups .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(8) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| ff7a020f | 4.1.2 | aria-command-name | serious | entity-groups .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(9) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 3eea5c69 | 4.1.2 | aria-command-name | serious | entity-groups > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(1) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 84609b47 | 4.1.2 | aria-command-name | serious | entity-groups > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 729f010e | 4.1.2 | aria-command-name | serious | entity-groups > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 63045760 | 4.1.2 | aria-command-name | serious | job-detail .Mui-selected | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| fc484eb6 | 4.1.2 | aria-command-name | serious | job-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(10) | roles: admin, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| e3e247cd | 4.1.2 | aria-command-name | serious | job-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(11) | roles: admin, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| 3604a625 | 4.1.2 | aria-command-name | serious | job-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(5) | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| d9259311 | 4.1.2 | aria-command-name | serious | job-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(6) | roles: admin, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| bd6ed027 | 4.1.2 | aria-command-name | serious | job-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(7) | roles: admin, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| 458d80d2 | 4.1.2 | aria-command-name | serious | job-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(8) | roles: admin, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| 95325da4 | 4.1.2 | aria-command-name | serious | job-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(9) | roles: admin, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| 5513d6b6 | 4.1.2 | aria-command-name | serious | job-detail > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(1) | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| fc702d49 | 4.1.2 | aria-command-name | serious | job-detail > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| f9b2bec0 | 4.1.2 | aria-command-name | serious | job-detail > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| eb611c5f | 4.1.2 | aria-command-name | serious | jobs .Mui-selected | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| c7b5425f | 4.1.2 | aria-command-name | serious | jobs .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(10) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 08c2f718 | 4.1.2 | aria-command-name | serious | jobs .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(11) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 7a774cd5 | 4.1.2 | aria-command-name | serious | jobs .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(5) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 1666c324 | 4.1.2 | aria-command-name | serious | jobs .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(6) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| e2b517fc | 4.1.2 | aria-command-name | serious | jobs .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(7) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 426982c5 | 4.1.2 | aria-command-name | serious | jobs .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(8) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 634c2cb0 | 4.1.2 | aria-command-name | serious | jobs .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(9) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 4e061f3d | 4.1.2 | aria-command-name | serious | jobs > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(1) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 3c0d60a9 | 4.1.2 | aria-command-name | serious | jobs > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 3d5b9a62 | 4.1.2 | aria-command-name | serious | jobs > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 70a959c3 | 4.1.2 | aria-command-name | serious | portal-results .Mui-selected | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 19dee7a6 | 4.1.2 | aria-command-name | serious | portal-results .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(10) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 09d917bc | 4.1.2 | aria-command-name | serious | portal-results .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(11) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 4ccd53ce | 4.1.2 | aria-command-name | serious | portal-results .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(4) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| bf69ce54 | 4.1.2 | aria-command-name | serious | portal-results .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(5) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 86c69322 | 4.1.2 | aria-command-name | serious | portal-results .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(6) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 8d20315c | 4.1.2 | aria-command-name | serious | portal-results .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(7) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 133ac960 | 4.1.2 | aria-command-name | serious | portal-results .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(8) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 4070b6b6 | 4.1.2 | aria-command-name | serious | portal-results .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(9) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 8f354353 | 4.1.2 | aria-command-name | serious | portal-results > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(1) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 4f87b5d6 | 4.1.2 | aria-command-name | serious | portal-results > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 44500f03 | 4.1.2 | aria-command-name | serious | portal-results > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 59d44b60 | 4.1.2 | aria-command-name | serious | record-detail .Mui-selected | roles: admin, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| eb4659f7 | 4.1.2 | aria-command-name | serious | record-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(10) | roles: admin, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 90eeaf45 | 4.1.2 | aria-command-name | serious | record-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(11) | roles: admin, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 400772a8 | 4.1.2 | aria-command-name | serious | record-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(4) | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| c648bef2 | 4.1.2 | aria-command-name | serious | record-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(5) | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| d45575ad | 4.1.2 | aria-command-name | serious | record-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(7) | roles: admin, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| bea783d5 | 4.1.2 | aria-command-name | serious | record-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(8) | roles: admin, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 289370f8 | 4.1.2 | aria-command-name | serious | record-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(9) | roles: admin, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| ec1050b8 | 4.1.2 | aria-command-name | serious | record-detail > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(1) | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 6d086994 | 4.1.2 | aria-command-name | serious | record-detail > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 912cc30b | 4.1.2 | aria-command-name | serious | record-detail > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| b056f315 | 4.1.2 | aria-command-name | serious | station-detail .Mui-selected | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| a9db870b | 4.1.2 | aria-command-name | serious | station-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(10) | roles: admin, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| 0e481fc5 | 4.1.2 | aria-command-name | serious | station-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(11) | roles: admin, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| 8a1d5262 | 4.1.2 | aria-command-name | serious | station-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(4) | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| 7965ac6a | 4.1.2 | aria-command-name | serious | station-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(5) | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| cd267195 | 4.1.2 | aria-command-name | serious | station-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(6) | roles: admin, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| d5dc0518 | 4.1.2 | aria-command-name | serious | station-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(7) | roles: admin, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| 76fcaa71 | 4.1.2 | aria-command-name | serious | station-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(8) | roles: admin, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| de513b57 | 4.1.2 | aria-command-name | serious | station-detail .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(9) | roles: admin, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| 72638204 | 4.1.2 | aria-command-name | serious | station-detail > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(1) | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| c067b8f7 | 4.1.2 | aria-command-name | serious | station-detail > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| 6160c0ff | 4.1.2 | aria-command-name | serious | station-detail > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| d5c52c57 | 4.1.2 | aria-command-name | serious | stations .Mui-selected | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| bc82d061 | 4.1.2 | aria-command-name | serious | stations .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(10) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 3138f428 | 4.1.2 | aria-command-name | serious | stations .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(11) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| bc3e6c47 | 4.1.2 | aria-command-name | serious | stations .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(4) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 608bcc2b | 4.1.2 | aria-command-name | serious | stations .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(5) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 67443560 | 4.1.2 | aria-command-name | serious | stations .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(6) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 05bd69a0 | 4.1.2 | aria-command-name | serious | stations .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(7) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 664839d7 | 4.1.2 | aria-command-name | serious | stations .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(8) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 81e68d30 | 4.1.2 | aria-command-name | serious | stations .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(9) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 4c43779d | 4.1.2 | aria-command-name | serious | stations > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(1) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 8485ae80 | 4.1.2 | aria-command-name | serious | stations > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| c3bd8607 | 4.1.2 | aria-command-name | serious | stations > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 658497ca | 4.1.2 | aria-command-name | serious | tags .Mui-selected | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 9c569d9b | 4.1.2 | aria-command-name | serious | tags .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(10) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 22adc448 | 4.1.2 | aria-command-name | serious | tags .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(11) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| ad6229b6 | 4.1.2 | aria-command-name | serious | tags .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(4) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 07031bc2 | 4.1.2 | aria-command-name | serious | tags .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(5) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 47f5bb14 | 4.1.2 | aria-command-name | serious | tags .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(6) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 62e38349 | 4.1.2 | aria-command-name | serious | tags .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(7) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| abd9170f | 4.1.2 | aria-command-name | serious | tags .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(9) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 37275fd3 | 4.1.2 | aria-command-name | serious | tags > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(1) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| e05cce9c | 4.1.2 | aria-command-name | serious | tags > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 933daafc | 4.1.2 | aria-command-name | serious | tags > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 08f59fd4 | 4.1.2 | aria-command-name | serious | toolpacks .Mui-selected | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 1a50d365 | 4.1.2 | aria-command-name | serious | toolpacks .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(11) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| e54a4a8c | 4.1.2 | aria-command-name | serious | toolpacks .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(4) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 5705e86d | 4.1.2 | aria-command-name | serious | toolpacks .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(5) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| d864c0f5 | 4.1.2 | aria-command-name | serious | toolpacks .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(6) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 6bd4f4bf | 4.1.2 | aria-command-name | serious | toolpacks .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(7) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 647d7160 | 4.1.2 | aria-command-name | serious | toolpacks .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(8) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 4019db18 | 4.1.2 | aria-command-name | serious | toolpacks .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(9) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 03423a89 | 4.1.2 | aria-command-name | serious | toolpacks > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(1) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| e444f731 | 4.1.2 | aria-command-name | serious | toolpacks > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 04d19525 | 4.1.2 | aria-command-name | serious | toolpacks > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| e1ba6c5f | 4.1.2 | aria-command-name | serious | views .Mui-selected | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 3ce99bcd | 4.1.2 | aria-command-name | serious | views .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(10) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 4b6341dd | 4.1.2 | aria-command-name | serious | views .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(4) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 51d47451 | 4.1.2 | aria-command-name | serious | views .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(5) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 31032afd | 4.1.2 | aria-command-name | serious | views .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(6) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 6a1009a6 | 4.1.2 | aria-command-name | serious | views .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(7) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| e2228d07 | 4.1.2 | aria-command-name | serious | views .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(8) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 6f4854bd | 4.1.2 | aria-command-name | serious | views .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(9) | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 83dff082 | 4.1.2 | aria-command-name | serious | views > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(1) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| c1f6ab72 | 4.1.2 | aria-command-name | serious | views > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 2b17e1e9 | 4.1.2 | aria-command-name | serious | views > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 6a1a6512 | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/Connector.view.stories.tsx › Default #tabpanel-0 > .MuiBox-root > .MuiStack-root > .MuiBox-root > .MuiBox-root > .MuiBox-root > .MuiSelect-root.MuiInputBase-root > .MuiSelect-select.MuiSelect-outlined | — | jest-axe |
| 96199b68 | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/PaginationToolbar.component.stories.tsx › AllFilterTypes .MuiSelect-select | — | jest-axe |
| a822c0db | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/PaginationToolbar.component.stories.tsx › BooleanFilters .MuiSelect-select | — | jest-axe |
| aa527b3d | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/PaginationToolbar.component.stories.tsx › Default .MuiSelect-select | — | jest-axe |
| 8f3ec953 | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/PaginationToolbar.component.stories.tsx › Interactive .MuiSelect-select | — | jest-axe |
| 229dc18d | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/PaginationToolbar.component.stories.tsx › LastPage .MuiSelect-select | — | jest-axe |
| ea40f6fc | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/PaginationToolbar.component.stories.tsx › MidPage .MuiSelect-select | — | jest-axe |
| e30fb231 | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/PaginationToolbar.component.stories.tsx › NumberAndTextFilters .MuiSelect-select | — | jest-axe |
| 012dc33f | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/PaginationToolbar.component.stories.tsx › SearchOnly .MuiSelect-select | — | jest-axe |
| 436ed46f | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/PaginationToolbar.component.stories.tsx › SortDescending .MuiSelect-select | — | jest-axe |
| 57911860 | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/PaginationToolbar.component.stories.tsx › WithActiveFilters .MuiSelect-select | — | jest-axe |
| 1f91690a | 4.1.2 | aria-input-field-name | serious | apps/web/src/stories/PaginationToolbar.component.stories.tsx › WithSearchValue .MuiSelect-select | — | jest-axe |
| 7dec9afb | 4.1.2 | aria-input-field-name | serious | column-definition-detail .MuiSelect-select | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| fb85e34f | 4.1.2 | aria-input-field-name | serious | column-definitions .MuiSelect-select | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| b9372eb6 | 4.1.2 | aria-input-field-name | serious | connector-detail .MuiSelect-select | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| f736be79 | 4.1.2 | aria-input-field-name | serious | connectors #tabpanel-0 > .MuiBox-root > .MuiStack-root > .MuiBox-root > .MuiBox-root > .MuiBox-root > .MuiSelect-root.MuiInputBase-root > .MuiSelect-select.MuiSelect-outlined | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 989f3e5a | 4.1.2 | aria-input-field-name | serious | entities .MuiSelect-select | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| a8092bdd | 4.1.2 | aria-input-field-name | serious | entity-detail .MuiSelect-select | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 71ea9d54 | 4.1.2 | aria-input-field-name | serious | entity-groups .MuiSelect-select | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| d0cf4e68 | 4.1.2 | aria-input-field-name | serious | jobs .MuiSelect-select | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| a4526a49 | 4.1.2 | aria-input-field-name | serious | portal-results .MuiSelect-select | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 1216a78c | 4.1.2 | aria-input-field-name | serious | station-detail .MuiSelect-select | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 10f6389e | 4.1.2 | aria-input-field-name | serious | stations .MuiSelect-select | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| e0bc0b55 | 4.1.2 | aria-input-field-name | serious | tags .MuiSelect-select | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| a567bc4c | 4.1.2 | aria-input-field-name | serious | toolpacks .MuiSelect-select | roles: admin, owner · states: empty, populated · themes: brand, brand.dark | axe-app |
| 051e8d9c | 4.1.2 | aria-input-field-name | serious | views .MuiSelect-select | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| aad52eaa | best practice | heading-order | moderate | apps/web/src/stories/CuratedViewDetail.view.stories.tsx › Empty h6 | — | jest-axe |
| 3aaf57ae | best practice | heading-order | moderate | column-definition-detail h6 | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| eb4e9b6e | best practice | heading-order | moderate | column-definitions .MuiPaper-outlined.MuiPaper-rounded.MuiCard-root:nth-child(1) > .MuiStack-root > .MuiCardActionArea-root > .MuiCardContent-root > .MuiStack-root > .MuiStack-root > h6 | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 801010ec | best practice | heading-order | moderate | column-definitions h4 | roles: member · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| e53aaaa0 | best practice | heading-order | moderate | column-definitions h6 | roles: admin, owner · states: empty · themes: brand, brand.dark | axe-app |
| 61e3ed44 | best practice | heading-order | moderate | connector-detail h6 | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 0e237e78 | best practice | heading-order | moderate | connectors .MuiPaper-outlined.MuiPaper-rounded.MuiCard-root:nth-child(1) > .MuiStack-root > .MuiCardActionArea-root > .MuiCardContent-root > .MuiStack-root > .MuiStack-root > h6 | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| be6dd0c3 | best practice | heading-order | moderate | connectors .MuiTypography-h6 | roles: owner · states: empty · themes: brand | axe-app |
| 168ecf89 | best practice | heading-order | moderate | connectors h4 | roles: member · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| 781e3a12 | best practice | heading-order | moderate | entities .MuiPaper-outlined.MuiPaper-rounded.MuiCard-root:nth-child(1) > .MuiStack-root > .MuiCardActionArea-root > .MuiCardContent-root > .MuiStack-root > .MuiStack-root > h6 | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 3dfbcfa3 | best practice | heading-order | moderate | entities h4 | roles: member · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| de52f085 | best practice | heading-order | moderate | entities h6 | roles: admin, owner · states: empty · themes: brand, brand.dark | axe-app |
| 8887fdd6 | best practice | heading-order | moderate | entity-groups h4 | roles: member · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 19f78077 | best practice | heading-order | moderate | entity-groups h6 | roles: admin, owner · states: empty, populated · themes: brand, brand.dark | axe-app |
| c9ac4699 | best practice | heading-order | moderate | jobs .MuiPaper-outlined.MuiPaper-rounded.MuiCard-root:nth-child(1) > .MuiStack-root > .MuiCardActionArea-root > .MuiCardContent-root > .MuiStack-root > .MuiStack-root > h6 | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| e0b85c0a | best practice | heading-order | moderate | jobs h6 | roles: admin, member, owner · states: empty · themes: brand, brand.dark | axe-app |
| ff04c15b | best practice | heading-order | moderate | portal-results h6 | roles: admin, member, owner · states: empty, populated · themes: brand, brand.dark | axe-app |
| 145db9d7 | best practice | heading-order | moderate | station-detail h6 | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 944f9d04 | best practice | heading-order | moderate | stations h6 | roles: admin, member, owner · states: empty, populated · themes: brand, brand.dark | axe-app |
| 47d33c7d | best practice | heading-order | moderate | tags h4 | roles: member · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 60fe8bb9 | best practice | heading-order | moderate | tags h6 | roles: admin, owner · states: empty, populated · themes: brand, brand.dark | axe-app |
| cfad970e | best practice | heading-order | moderate | toolpacks h4 | roles: member · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 48b4e9de | best practice | heading-order | moderate | views h6 | roles: admin, member, owner · states: empty, populated · themes: brand, brand.dark | axe-app |
| 267bd827 | best practice | image-redundant-alt | minor | column-definition-detail img | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 798fcc36 | best practice | image-redundant-alt | minor | column-definitions img | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 2218fb61 | best practice | image-redundant-alt | minor | connector-detail img | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 3a84807c | best practice | image-redundant-alt | minor | connectors img | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 5717c49a | best practice | image-redundant-alt | minor | connectors img[alt="E2E Test User"] | roles: owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 1c51a036 | best practice | image-redundant-alt | minor | connectors img[alt="e2e-admin@portalsai.io"] | roles: admin · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| 2e70e1ab | best practice | image-redundant-alt | minor | entities img | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 4bf49d7b | best practice | image-redundant-alt | minor | entity-detail img | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| fdae4f84 | best practice | image-redundant-alt | minor | entity-groups img | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 471a8a54 | best practice | image-redundant-alt | minor | job-detail img | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| b3e82a34 | best practice | image-redundant-alt | minor | jobs img | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| d36d343d | best practice | image-redundant-alt | minor | portal-results img | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 54cf53a4 | best practice | image-redundant-alt | minor | record-detail img | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 34b19411 | best practice | image-redundant-alt | minor | station-detail img | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| e29b0b5b | best practice | image-redundant-alt | minor | stations img | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| ade0227c | best practice | image-redundant-alt | minor | tags img | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| c7e22edd | best practice | image-redundant-alt | minor | toolpacks img | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| bc0c7675 | best practice | image-redundant-alt | minor | views img | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| e8746dac | best practice | jsx-a11y/no-autofocus | — | apps/web/src/components/PaginationToolbar.component.tsx:747 | — | eslint |

<a id="owner-795"></a>

## #795 RegionEditor spreadsheet canvas

| ID | WCAG | Rule | Impact | Location | Seen | Tool |
|---|---|---|---|---|---|---|
| d14872f4 | 2.5.3 | label-content-name-mismatch | serious | layout-plan-edit | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 0ab1a0d8 | 4.1.2 | aria-command-name | serious | layout-plan-edit .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(10) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 46adc28f | 4.1.2 | aria-command-name | serious | layout-plan-edit .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(11) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 00a67b4f | 4.1.2 | aria-command-name | serious | layout-plan-edit .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(4) | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 16b6cfbb | 4.1.2 | aria-command-name | serious | layout-plan-edit .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(5) | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 6b156826 | 4.1.2 | aria-command-name | serious | layout-plan-edit .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(6) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 808d4bda | 4.1.2 | aria-command-name | serious | layout-plan-edit .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(7) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| b1700396 | 4.1.2 | aria-command-name | serious | layout-plan-edit .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(8) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| fd2abedb | 4.1.2 | aria-command-name | serious | layout-plan-edit .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(9) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 04599b40 | 4.1.2 | aria-command-name | serious | layout-plan-edit > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(1) | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| a3f4f427 | 4.1.2 | aria-command-name | serious | layout-plan-edit > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 77541a55 | 4.1.2 | aria-command-name | serious | layout-plan-edit > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| b1b18e83 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/BindingEditorPopover.stories.tsx › EnumColumn | — | jest-axe |
| a403baf9 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/BindingEditorPopover.stories.tsx › ExcludedState | — | jest-axe |
| 18153eba | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/BindingEditorPopover.stories.tsx › NormalizedKeyValidationError | — | jest-axe |
| 5e4f7725 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/BindingEditorPopover.stories.tsx › ReferenceColumn | — | jest-axe |
| 1ddc5be1 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/BindingEditorPopover.stories.tsx › ServerErrorAlert | — | jest-axe |
| 9ef11115 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/BindingEditorPopover.stories.tsx › StringColumn | — | jest-axe |
| a4343a06 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/RegionDrawingStep.stories.tsx › CrosstabSelected | — | jest-axe |
| cd1c22cd | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/RegionDrawingStep.stories.tsx › CrosstabSelected div[data-corner-header=""] | — | jest-axe |
| 1783537b | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/RegionDrawingStep.stories.tsx › DriftSeeded | — | jest-axe |
| b0901a2a | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/RegionDrawingStep.stories.tsx › DriftSeeded div[data-corner-header=""] | — | jest-axe |
| e1bc1d8c | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/RegionDrawingStep.stories.tsx › Empty div[data-corner-header=""] | — | jest-axe |
| d2d1decb | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/RegionDrawingStep.stories.tsx › Interactive div[data-corner-header=""] | — | jest-axe |
| 3ff7c3f3 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/RegionDrawingStep.stories.tsx › MessyPipelineSkipRules | — | jest-axe |
| 4e1d4b51 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/RegionDrawingStep.stories.tsx › MessyPipelineSkipRules div[data-corner-header=""] | — | jest-axe |
| d94fe9e7 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/RegionDrawingStep.stories.tsx › MessyQuartersSkipRules | — | jest-axe |
| be8ccd68 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/RegionDrawingStep.stories.tsx › MessyQuartersSkipRules div[data-corner-header=""] | — | jest-axe |
| 3d1b0e9e | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/RegionDrawingStep.stories.tsx › WithProposedRegions | — | jest-axe |
| 9be89600 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/RegionDrawingStep.stories.tsx › WithProposedRegions div[data-corner-header=""] | — | jest-axe |
| 9edd0cb4 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/RegionEditor.stories.tsx › Interactive div[data-corner-header=""] | — | jest-axe |
| 839ff558 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/RegionEditor.stories.tsx › ModeA_Empty div[data-corner-header=""] | — | jest-axe |
| 2b5cf5b6 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/RegionEditor.stories.tsx › ModeB_DriftHalt | — | jest-axe |
| b9004c93 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/RegionEditor.stories.tsx › ModeB_DriftHalt div[data-corner-header=""] | — | jest-axe |
| 0e6b36ff | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/SheetCanvas.stories.tsx › CrosstabSheet div[data-corner-header=""] | — | jest-axe |
| d289f8e9 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/SheetCanvas.stories.tsx › DriftHighlighted div[data-corner-header=""] | — | jest-axe |
| 1997b0f7 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/SheetCanvas.stories.tsx › Empty div[data-corner-header=""] | — | jest-axe |
| 41496e7a | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/SheetCanvas.stories.tsx › InteractiveDrawing div[data-corner-header=""] | — | jest-axe |
| 3435a62d | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/SheetCanvas.stories.tsx › MessyPipelineSkipRules div[data-corner-header=""] | — | jest-axe |
| d195642c | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/SheetCanvas.stories.tsx › MessyQuartersSkipRules div[data-corner-header=""] | — | jest-axe |
| 8d1d10fa | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/SheetCanvas.stories.tsx › ReadOnly div[data-corner-header=""] | — | jest-axe |
| af687d07 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/modules/RegionEditor/stories/SheetCanvas.stories.tsx › WithRegions div[data-corner-header=""] | — | jest-axe |
| c41579d5 | 4.1.2 | jsx-a11y/no-noninteractive-element-interactions | — | apps/web/src/modules/RegionEditor/RegionDrawingStep.component.tsx:387 | — | eslint |
| b16585e0 | 4.1.2 | jsx-a11y/no-noninteractive-element-interactions | — | apps/web/src/modules/RegionEditor/ReviewStep.component.tsx:509 | — | eslint |
| b00114da | best practice | aria-allowed-role | minor | apps/web/src/modules/RegionEditor/stories/BindingEditorPopover.stories.tsx › EnumColumn form | — | jest-axe |
| 25b65714 | best practice | aria-allowed-role | minor | apps/web/src/modules/RegionEditor/stories/BindingEditorPopover.stories.tsx › ExcludedState form | — | jest-axe |
| 261b2af7 | best practice | aria-allowed-role | minor | apps/web/src/modules/RegionEditor/stories/BindingEditorPopover.stories.tsx › NormalizedKeyValidationError form | — | jest-axe |
| cb641872 | best practice | aria-allowed-role | minor | apps/web/src/modules/RegionEditor/stories/BindingEditorPopover.stories.tsx › ReferenceColumn form | — | jest-axe |
| 35b59002 | best practice | aria-allowed-role | minor | apps/web/src/modules/RegionEditor/stories/BindingEditorPopover.stories.tsx › ServerErrorAlert form | — | jest-axe |
| b9a724ce | best practice | aria-allowed-role | minor | apps/web/src/modules/RegionEditor/stories/BindingEditorPopover.stories.tsx › StringColumn form | — | jest-axe |
| 2caf4198 | best practice | image-redundant-alt | minor | layout-plan-edit img | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |

<a id="owner-796"></a>

## #796 Maps and charts

No automated findings.

<a id="owner-797"></a>

## #797 App shell, navigation and landmarks

| ID | WCAG | Rule | Impact | Location | Seen | Tool |
|---|---|---|---|---|---|---|
| 4179be61 | 1.1.1 | aria-progressbar-name | serious | apps/web/src/modules/D3Widget/stories/D3Widget.stories.tsx › Loading .MuiCircularProgress-root | — | jest-axe |
| d2c4bd30 | 1.1.1 | aria-progressbar-name | serious | apps/web/src/stories/Authorized.stories.tsx › Loading span | — | jest-axe |
| 416af452 | 1.1.1 | aria-progressbar-name | serious | apps/web/src/stories/Authorized.stories.tsx › WithError span | — | jest-axe |
| 8f82c402 | 1.1.1 | aria-progressbar-name | serious | apps/web/src/stories/Connector.view.stories.tsx › Default #tabpanel-0 > .MuiBox-root > .MuiStack-root > .MuiStack-root > .MuiCircularProgress-root.MuiCircularProgress-indeterminate.MuiCircularProgress-colorPrimary | — | jest-axe |
| 3d9d1f15 | 1.1.1 | aria-progressbar-name | serious | apps/web/src/stories/Dashboard.view.stories.tsx › Default .MuiBox-root:nth-child(1) > .MuiPaper-root.MuiPaper-outlined.MuiPaper-rounded > .MuiStack-root > .MuiBox-root > .MuiStack-root > .MuiCircularProgress-root.MuiCircularProgress-indeterminate.MuiCircularProgress-colorPrimary | — | jest-axe |
| 51283d0c | 1.1.1 | aria-progressbar-name | serious | apps/web/src/stories/Dashboard.view.stories.tsx › Default .MuiBox-root:nth-child(2) > .MuiPaper-root.MuiPaper-outlined.MuiPaper-rounded > .MuiStack-root > .MuiBox-root > .MuiStack-root > .MuiCircularProgress-root.MuiCircularProgress-indeterminate.MuiCircularProgress-colorPrimary | — | jest-axe |
| e1edf19c | 1.1.1 | aria-progressbar-name | serious | apps/web/src/stories/Dashboard.view.stories.tsx › Default > .MuiStack-root > .MuiCircularProgress-root.MuiCircularProgress-indeterminate.MuiCircularProgress-colorPrimary | — | jest-axe |
| a9a1eb9d | 1.1.1 | aria-progressbar-name | serious | apps/web/src/stories/DataJobStream.component.stories.tsx › ActiveJob .MuiLinearProgress-root | — | jest-axe |
| f3e05c57 | 1.1.1 | aria-progressbar-name | serious | apps/web/src/stories/DataResult.component.stories.tsx › Loading span | — | jest-axe |
| ce804819 | 1.1.1 | aria-progressbar-name | serious | apps/web/src/stories/DataResult.component.stories.tsx › PartialLoading span | — | jest-axe |
| 5633061c | 1.1.1 | aria-progressbar-name | serious | apps/web/src/stories/FilterSqlPreview.component.stories.tsx › Loading span | — | jest-axe |
| cc69594c | 1.1.1 | aria-progressbar-name | serious | apps/web/src/stories/JobCard.component.stories.tsx › Active .MuiLinearProgress-root | — | jest-axe |
| 95159d9a | 1.1.1 | aria-progressbar-name | serious | apps/web/src/stories/JobCard.component.stories.tsx › ActiveWithStreamProgress .MuiLinearProgress-root | — | jest-axe |
| 3ff7582e | 1.1.1 | aria-progressbar-name | serious | apps/web/src/stories/JobCard.component.stories.tsx › Revalidation .MuiLinearProgress-root | — | jest-axe |
| 0eed0c1e | 1.1.1 | aria-progressbar-name | serious | apps/web/src/stories/Loading.view.stories.tsx › Default span | — | jest-axe |
| c9aa4481 | 1.1.1 | aria-progressbar-name | serious | apps/web/src/stories/Settings.view.stories.tsx › Default .MuiBox-root > .MuiStack-root > .MuiCircularProgress-root.MuiCircularProgress-indeterminate.MuiCircularProgress-colorPrimary | — | jest-axe |
| 7533fcf3 | 1.1.1 | aria-progressbar-name | serious | apps/web/src/workflows/FileUploadConnector/stories/FileUploadConnectorWorkflow.stories.tsx › Step0_FilesSelected .MuiBox-root:nth-child(1) > .MuiBox-root > .MuiBox-root > .MuiLinearProgress-root.MuiLinearProgress-colorPrimary.MuiLinearProgress-determinate | — | jest-axe |
| 8994c266 | 1.1.1 | aria-progressbar-name | serious | apps/web/src/workflows/FileUploadConnector/stories/FileUploadConnectorWorkflow.stories.tsx › Step0_FilesSelected .MuiBox-root:nth-child(2) > .MuiBox-root > .MuiBox-root > .MuiLinearProgress-root.MuiLinearProgress-colorPrimary.MuiLinearProgress-determinate | — | jest-axe |
| 5b8c0e78 | 1.1.1 | aria-progressbar-name | serious | apps/web/src/workflows/FileUploadConnector/stories/FileUploadConnectorWorkflow.stories.tsx › Step0_Uploading | — | jest-axe |
| 91d6c6d2 | 1.1.1 | aria-progressbar-name | serious | apps/web/src/workflows/FileUploadConnector/stories/UploadStep.stories.tsx › ErrorState .MuiLinearProgress-root | — | jest-axe |
| bc0e71c8 | 1.1.1 | aria-progressbar-name | serious | apps/web/src/workflows/FileUploadConnector/stories/UploadStep.stories.tsx › OneFileSelected .MuiLinearProgress-root | — | jest-axe |
| 501b9692 | 1.1.1 | aria-progressbar-name | serious | apps/web/src/workflows/FileUploadConnector/stories/UploadStep.stories.tsx › Parsing | — | jest-axe |
| 0b6dbc61 | 1.1.1 | aria-progressbar-name | serious | apps/web/src/workflows/FileUploadConnector/stories/UploadStep.stories.tsx › Uploading | — | jest-axe |
| 4c66df82 | 1.1.1 | aria-progressbar-name | serious | apps/web/src/workflows/FileUploadConnector/stories/UploadStep.stories.tsx › Uploading .MuiBox-root:nth-child(1) > .MuiBox-root > .MuiBox-root > .MuiLinearProgress-root.MuiLinearProgress-colorPrimary | — | jest-axe |
| a91bc228 | 1.1.1 | aria-progressbar-name | serious | apps/web/src/workflows/FileUploadConnector/stories/UploadStep.stories.tsx › Uploading .MuiBox-root:nth-child(2) > .MuiBox-root > .MuiBox-root > .MuiLinearProgress-root.MuiLinearProgress-colorPrimary | — | jest-axe |
| f57d480d | 1.1.1 | aria-progressbar-name | serious | column-definition-detail .MuiCircularProgress-root | roles: admin, member, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| 3ea0932a | 1.1.1 | aria-progressbar-name | serious | column-definitions .MuiCircularProgress-root | roles: admin, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| 95bd2fd2 | 1.1.1 | aria-progressbar-name | serious | connector-detail .MuiCircularProgress-root | roles: admin, member, owner · states: error, loading, locked · themes: brand, brand.dark | axe-app |
| 3b48dc97 | 1.1.1 | aria-progressbar-name | serious | connectors .MuiCircularProgress-root | roles: admin, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| 087ec78b | 1.1.1 | aria-progressbar-name | serious | connectors #tabpanel-0 > .MuiBox-root > .MuiStack-root > .MuiStack-root > .MuiCircularProgress-root.MuiCircularProgress-indeterminate.MuiCircularProgress-colorPrimary | roles: admin, member, owner · states: empty · themes: brand, brand.dark | axe-app |
| c78a84b8 | 1.1.1 | aria-progressbar-name | serious | entities .MuiCircularProgress-root | roles: admin, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| bbc782a8 | 1.1.1 | aria-progressbar-name | serious | entity-detail .MuiCircularProgress-root | roles: admin, member, owner · states: error, loading, locked · themes: brand, brand.dark | axe-app |
| 2df8e95e | 1.1.1 | aria-progressbar-name | serious | entity-groups .MuiCircularProgress-root | roles: admin, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| 443c853d | 1.1.1 | aria-progressbar-name | serious | job-detail .MuiCircularProgress-root | roles: admin, member, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| d4459b73 | 1.1.1 | aria-progressbar-name | serious | jobs .MuiCircularProgress-root | roles: admin, member, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| 053d87d5 | 1.1.1 | aria-progressbar-name | serious | packages/core/src/stories/MultiSearchableSelect.stories.tsx › Async .MuiCircularProgress-root | — | jest-axe |
| d236f679 | 1.1.1 | aria-progressbar-name | serious | packages/core/src/stories/Progress.stories.tsx › Complete .MuiLinearProgress-root | — | jest-axe |
| ebb40c40 | 1.1.1 | aria-progressbar-name | serious | packages/core/src/stories/Progress.stories.tsx › Default .MuiLinearProgress-root | — | jest-axe |
| 45175ca0 | 1.1.1 | aria-progressbar-name | serious | packages/core/src/stories/Progress.stories.tsx › Error .MuiLinearProgress-root | — | jest-axe |
| 0eebeb0c | 1.1.1 | aria-progressbar-name | serious | packages/core/src/stories/Progress.stories.tsx › NoLabel .MuiLinearProgress-root | — | jest-axe |
| a34bd69a | 1.1.1 | aria-progressbar-name | serious | packages/core/src/stories/Progress.stories.tsx › Thick .MuiLinearProgress-root | — | jest-axe |
| 857337b0 | 1.1.1 | aria-progressbar-name | serious | packages/core/src/stories/Progress.stories.tsx › Zero .MuiLinearProgress-root | — | jest-axe |
| 9ccfec1e | 1.1.1 | aria-progressbar-name | serious | packages/core/src/stories/SearchableSelect.stories.tsx › Async .MuiCircularProgress-root | — | jest-axe |
| e100dfc7 | 1.1.1 | aria-progressbar-name | serious | packages/core/src/stories/StatusMessage.stories.tsx › Loading span | — | jest-axe |
| 852ba083 | 1.1.1 | aria-progressbar-name | serious | portal-results .MuiCircularProgress-root | roles: admin, member, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| f937891f | 1.1.1 | aria-progressbar-name | serious | record-detail .MuiCircularProgress-root | roles: admin, member, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| cb28dc0b | 1.1.1 | aria-progressbar-name | serious | settings .MuiBox-root > .MuiStack-root > .MuiCircularProgress-root.MuiCircularProgress-indeterminate.MuiCircularProgress-colorPrimary | roles: admin, member, owner · states: loading · themes: brand, brand.dark | axe-app |
| 25a0f0d0 | 1.1.1 | aria-progressbar-name | serious | station-detail .MuiCircularProgress-root | roles: admin, member, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| f6016fe7 | 1.1.1 | aria-progressbar-name | serious | stations .MuiBox-root:nth-child(3) > .MuiStack-root > .MuiCircularProgress-root.MuiCircularProgress-indeterminate.MuiCircularProgress-colorPrimary | roles: member, owner · states: loading · themes: brand, brand.dark | axe-app |
| b19c8305 | 1.1.1 | aria-progressbar-name | serious | stations .MuiCircularProgress-root | roles: admin, member, owner · states: empty, error, loading · themes: brand, brand.dark | axe-app |
| 5dcd0dda | 1.1.1 | aria-progressbar-name | serious | stations > .MuiStack-root > .MuiCircularProgress-root.MuiCircularProgress-indeterminate.MuiCircularProgress-colorPrimary | roles: member, owner · states: loading · themes: brand, brand.dark | axe-app |
| 2eeb58ea | 1.1.1 | aria-progressbar-name | serious | tags .MuiCircularProgress-root | roles: admin, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| 351b7f55 | 1.1.1 | aria-progressbar-name | serious | toolpacks .MuiCircularProgress-root | roles: admin, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| b3685984 | 1.3.1 | list | serious | apps/web/src/stories/SidebarNav.component.stories.tsx › Expanded ul | — | jest-axe |
| 53b7fbab | 1.3.1 | list | serious | apps/web/src/stories/SidebarNav.component.stories.tsx › FooterRenderProp ul | — | jest-axe |
| 1f796044 | 1.3.1 | list | serious | apps/web/src/stories/SidebarNav.component.stories.tsx › WithoutFooter ul | — | jest-axe |
| a9988412 | 1.3.1 | list | serious | apps/web/src/stories/SidebarNavItem.component.stories.tsx › ChildSelected ul | — | jest-axe |
| 612abe94 | 1.3.1 | list | serious | apps/web/src/stories/SidebarNavItem.component.stories.tsx › WithChildrenOpen ul | — | jest-axe |
| da163e47 | 1.4.3 | color-contrast | serious | dashboard .MuiButton-root | roles: admin, member, owner · states: populated · themes: brand.dark | axe-app |
| 33ecfb36 | 2.1.1 | jsx-a11y/click-events-have-key-events | — | apps/web/src/components/SidebarNavToggle.component.tsx:54 | — | eslint |
| e459d8d9 | 2.1.1, 4.1.2 | jsx-a11y/no-static-element-interactions | — | apps/web/src/components/SidebarNavToggle.component.tsx:54 | — | eslint |
| d66c4961 | 2.5.3 | label-content-name-mismatch | serious | dashboard | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| bc441873 | 2.5.3 | label-content-name-mismatch | serious | help | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| d84c99ae | 4.1.2 | aria-command-name | serious | apps/web/src/stories/Authorized.layout.stories.tsx › Default .Mui-selected | — | jest-axe |
| e64dc6d8 | 4.1.2 | aria-command-name | serious | apps/web/src/stories/Authorized.layout.stories.tsx › Default .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | — | jest-axe |
| ca0a753a | 4.1.2 | aria-command-name | serious | apps/web/src/stories/Authorized.layout.stories.tsx › Default .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | — | jest-axe |
| dcd162ab | 4.1.2 | aria-command-name | serious | apps/web/src/stories/Authorized.layout.stories.tsx › Default > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(1) | — | jest-axe |
| c0a69aab | 4.1.2 | aria-command-name | serious | apps/web/src/stories/Authorized.layout.stories.tsx › WithLongContent .Mui-selected | — | jest-axe |
| 0f4d59fc | 4.1.2 | aria-command-name | serious | apps/web/src/stories/Authorized.layout.stories.tsx › WithLongContent .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | — | jest-axe |
| 03a7e7dd | 4.1.2 | aria-command-name | serious | apps/web/src/stories/Authorized.layout.stories.tsx › WithLongContent .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | — | jest-axe |
| 0213aeb2 | 4.1.2 | aria-command-name | serious | apps/web/src/stories/Authorized.layout.stories.tsx › WithLongContent > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(1) | — | jest-axe |
| 069dbb1c | 4.1.2 | aria-command-name | serious | apps/web/src/stories/Authorized.layout.stories.tsx › WithMultipleElements .Mui-selected | — | jest-axe |
| 09918b9c | 4.1.2 | aria-command-name | serious | apps/web/src/stories/Authorized.layout.stories.tsx › WithMultipleElements .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | — | jest-axe |
| 155e9c7a | 4.1.2 | aria-command-name | serious | apps/web/src/stories/Authorized.layout.stories.tsx › WithMultipleElements .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | — | jest-axe |
| 64aa4b1c | 4.1.2 | aria-command-name | serious | apps/web/src/stories/Authorized.layout.stories.tsx › WithMultipleElements > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(1) | — | jest-axe |
| 58d9f971 | 4.1.2 | aria-command-name | serious | apps/web/src/stories/SidebarNav.component.stories.tsx › Collapsed .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(1) | — | jest-axe |
| efc15022 | 4.1.2 | aria-command-name | serious | apps/web/src/stories/SidebarNav.component.stories.tsx › Collapsed .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | — | jest-axe |
| 8284c47e | 4.1.2 | aria-command-name | serious | apps/web/src/stories/SidebarNav.component.stories.tsx › Collapsed .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | — | jest-axe |
| e956eae9 | 4.1.2 | aria-command-name | serious | apps/web/src/stories/SidebarNavItem.component.stories.tsx › CollapsedNoChildren .MuiButtonBase-root | — | jest-axe |
| 86e878c5 | 4.1.2 | aria-command-name | serious | apps/web/src/stories/SidebarNavItem.component.stories.tsx › CollapsedWithChildren | — | jest-axe |
| c4d92af0 | 4.1.2 | aria-command-name | serious | dashboard .Mui-selected | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 5f5563a9 | 4.1.2 | aria-command-name | serious | dashboard .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(10) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| c8509b5a | 4.1.2 | aria-command-name | serious | dashboard .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(11) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| cd257c7d | 4.1.2 | aria-command-name | serious | dashboard .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(4) | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| b9bd7aca | 4.1.2 | aria-command-name | serious | dashboard .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(5) | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| a72b69aa | 4.1.2 | aria-command-name | serious | dashboard .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(6) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 901ce19b | 4.1.2 | aria-command-name | serious | dashboard .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(7) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| e9803a1c | 4.1.2 | aria-command-name | serious | dashboard .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(8) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 75a643a5 | 4.1.2 | aria-command-name | serious | dashboard .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(9) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| f5b59fff | 4.1.2 | aria-command-name | serious | dashboard > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(1) | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| f2e11d8d | 4.1.2 | aria-command-name | serious | dashboard > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| deaa37d8 | 4.1.2 | aria-command-name | serious | dashboard > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 5d920bf6 | 4.1.2 | aria-command-name | serious | help .Mui-selected.MuiListItemButton-root.MuiListItemButton-gutters | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| a7b4a925 | 4.1.2 | aria-command-name | serious | help .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(10) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| b40a8213 | 4.1.2 | aria-command-name | serious | help .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(11) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 55d6b52c | 4.1.2 | aria-command-name | serious | help .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(4) | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 655cb168 | 4.1.2 | aria-command-name | serious | help .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(5) | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 1544bba8 | 4.1.2 | aria-command-name | serious | help .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(6) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| c8d86c33 | 4.1.2 | aria-command-name | serious | help .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(7) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| c9d9cb11 | 4.1.2 | aria-command-name | serious | help .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(8) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 2746e98e | 4.1.2 | aria-command-name | serious | help .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(9) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 3b062fd5 | 4.1.2 | aria-command-name | serious | help > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(1) | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 81d6a515 | 4.1.2 | aria-command-name | serious | help > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(2) | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 9f00879e | 4.1.2 | aria-command-name | serious | help > .MuiListItemButton-root.MuiListItemButton-gutters:nth-child(3) | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 91bace2b | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/stories/Dashboard.view.stories.tsx › Default | — | jest-axe |
| 0d02166d | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/stories/HealthCheck.component.stories.tsx › Healthy .MuiBox-root | — | jest-axe |
| 82447310 | 4.1.2 | aria-prohibited-attr | serious | apps/web/src/stories/HealthCheck.component.stories.tsx › UnknownTimestamp .MuiBox-root | — | jest-axe |
| a3752c17 | 4.1.2 | aria-prohibited-attr | serious | dashboard | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 2cdd0850 | best practice | heading-order | moderate | apps/web/src/stories/Authorized.layout.stories.tsx › Default h5 | — | jest-axe |
| 20d60ccf | best practice | heading-order | moderate | apps/web/src/stories/Authorized.layout.stories.tsx › WithMultipleElements .MuiBox-root:nth-child(2) > h6 | — | jest-axe |
| 1404a330 | best practice | heading-order | moderate | apps/web/src/stories/BadRequest.view.stories.tsx › CustomDescription h4 | — | jest-axe |
| 5b143897 | best practice | heading-order | moderate | apps/web/src/stories/BadRequest.view.stories.tsx › Default h4 | — | jest-axe |
| 1a50427c | best practice | heading-order | moderate | apps/web/src/stories/Forbidden.view.stories.tsx › CustomDescription h4 | — | jest-axe |
| 57fa7705 | best practice | heading-order | moderate | apps/web/src/stories/Forbidden.view.stories.tsx › Default h4 | — | jest-axe |
| aa3394c4 | best practice | heading-order | moderate | apps/web/src/stories/Help.view.stories.tsx › Default div[data-testid="getting-started-step-1"] > .MuiCardContent-root > .MuiStack-root > .MuiStack-root > .MuiTypography-subtitle1 | — | jest-axe |
| 4e06bfa6 | best practice | heading-order | moderate | apps/web/src/stories/Help.view.stories.tsx › GlossaryFilteredToAnalytics div[data-testid="getting-started-step-1"] > .MuiCardContent-root > .MuiStack-root > .MuiStack-root > .MuiTypography-subtitle1 | — | jest-axe |
| 75985b47 | best practice | heading-order | moderate | apps/web/src/stories/HttpError.component.stories.tsx › BackButtonOnly h4 | — | jest-axe |
| 2d2cba6d | best practice | heading-order | moderate | apps/web/src/stories/HttpError.component.stories.tsx › Forbidden h4 | — | jest-axe |
| 19b4888c | best practice | heading-order | moderate | apps/web/src/stories/HttpError.component.stories.tsx › NoButtons h4 | — | jest-axe |
| 6d3e05b3 | best practice | heading-order | moderate | apps/web/src/stories/HttpError.component.stories.tsx › NoDescription h4 | — | jest-axe |
| 840314fa | best practice | heading-order | moderate | apps/web/src/stories/HttpError.component.stories.tsx › NotFound h4 | — | jest-axe |
| e2a8d299 | best practice | heading-order | moderate | apps/web/src/stories/HttpError.component.stories.tsx › ServerError h4 | — | jest-axe |
| 91846d9d | best practice | heading-order | moderate | apps/web/src/stories/HttpError.component.stories.tsx › Unauthorized h4 | — | jest-axe |
| b4a03c89 | best practice | heading-order | moderate | apps/web/src/stories/NotFound.view.stories.tsx › CustomDescription h4 | — | jest-axe |
| 7bc155df | best practice | heading-order | moderate | apps/web/src/stories/NotFound.view.stories.tsx › Default h4 | — | jest-axe |
| 54d113c9 | best practice | heading-order | moderate | apps/web/src/stories/ServerError.view.stories.tsx › CustomDescription h4 | — | jest-axe |
| 452d3804 | best practice | heading-order | moderate | apps/web/src/stories/ServerError.view.stories.tsx › Default h4 | — | jest-axe |
| 24e70546 | best practice | heading-order | moderate | apps/web/src/stories/Unauthorized.view.stories.tsx › CustomDescription h4 | — | jest-axe |
| 4d01f629 | best practice | heading-order | moderate | apps/web/src/stories/Unauthorized.view.stories.tsx › Default h4 | — | jest-axe |
| f2c2f90d | best practice | heading-order | moderate | help div[data-testid="getting-started-step-1"] > .MuiCardContent-root > .MuiStack-root > .MuiStack-root > .MuiTypography-subtitle1 | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 0a690f1b | best practice | heading-order | moderate | packages/core/src/stories/PageSection.stories.tsx › Composed .MuiPaper-root.MuiPaper-outlined:nth-child(1) > .MuiStack-root > .MuiBox-root > .MuiStack-root > .MuiCard-root.MuiPaper-root:nth-child(1) > .MuiCardContent-root > h6 | — | jest-axe |
| 4f456216 | best practice | heading-order | moderate | packages/core/src/stories/PageSection.stories.tsx › Composed .MuiPaper-root.MuiPaper-outlined:nth-child(2) > .MuiStack-root > .MuiBox-root > .MuiStack-root > .MuiCard-root.MuiPaper-root:nth-child(1) > .MuiCardContent-root > h6 | — | jest-axe |
| 8b27fd9e | best practice | heading-order | moderate | packages/core/src/stories/PageSection.stories.tsx › Default .MuiCard-root.MuiPaper-root:nth-child(1) > .MuiCardContent-root > h6 | — | jest-axe |
| 99ca1c54 | best practice | heading-order | moderate | packages/core/src/stories/PageSection.stories.tsx › OutlinedVariant .MuiCard-root.MuiPaper-root:nth-child(1) > .MuiCardContent-root > h6 | — | jest-axe |
| f7a1417d | best practice | heading-order | moderate | packages/core/src/stories/PageSection.stories.tsx › WithActions .MuiCard-root.MuiPaper-root:nth-child(1) > .MuiCardContent-root > h6 | — | jest-axe |
| 71667292 | best practice | heading-order | moderate | packages/core/src/stories/PageSection.stories.tsx › WithIcon .MuiCard-root.MuiPaper-root:nth-child(1) > .MuiCardContent-root > h6 | — | jest-axe |
| d8c2f55e | best practice | heading-order | moderate | packages/core/src/stories/PageSection.stories.tsx › WithSecondaryMenu .MuiCard-root.MuiPaper-root:nth-child(1) > .MuiCardContent-root > h6 | — | jest-axe |
| baed5998 | best practice | image-redundant-alt | minor | apps/web/src/stories/Authorized.layout.stories.tsx › Default img | — | jest-axe |
| 6ea28cae | best practice | image-redundant-alt | minor | apps/web/src/stories/Authorized.layout.stories.tsx › WithLongContent img | — | jest-axe |
| 3ac2247e | best practice | image-redundant-alt | minor | apps/web/src/stories/Authorized.layout.stories.tsx › WithMultipleElements img | — | jest-axe |
| 719205ab | best practice | image-redundant-alt | minor | apps/web/src/stories/HeaderMenu.component.stories.tsx › UIWithCustomChildren img | — | jest-axe |
| 862944f5 | best practice | image-redundant-alt | minor | dashboard img | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 612936d1 | best practice | image-redundant-alt | minor | help img | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 84aba4cc | best practice | landmark-one-main | moderate | column-definition-detail html | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 1526e6db | best practice | landmark-one-main | moderate | column-definitions html | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 6173979f | best practice | landmark-one-main | moderate | connector-detail html | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| a6f42efd | best practice | landmark-one-main | moderate | connectors html | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| a22759d9 | best practice | landmark-one-main | moderate | dashboard html | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| ac4cf031 | best practice | landmark-one-main | moderate | entities html | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| be8e2f83 | best practice | landmark-one-main | moderate | entity-detail html | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| c3692f2a | best practice | landmark-one-main | moderate | entity-groups html | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| d5d709ec | best practice | landmark-one-main | moderate | help html | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 5ad192aa | best practice | landmark-one-main | moderate | invitation-accept html | states: populated · themes: brand, brand.dark | axe-app |
| 3a05ad52 | best practice | landmark-one-main | moderate | job-detail html | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| 7d1bab34 | best practice | landmark-one-main | moderate | jobs html | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 870a3a24 | best practice | landmark-one-main | moderate | layout-plan-edit html | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| bd15239f | best practice | landmark-one-main | moderate | login html | states: populated · themes: brand, brand.dark | axe-app |
| 11972de9 | best practice | landmark-one-main | moderate | not-invited html | states: populated · themes: brand, brand.dark | axe-app |
| 650c3b6b | best practice | landmark-one-main | moderate | portal-results html | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 50bb47b1 | best practice | landmark-one-main | moderate | record-detail html | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 25d3f791 | best practice | landmark-one-main | moderate | settings html | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| b909cc41 | best practice | landmark-one-main | moderate | station-detail html | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| e319a9ac | best practice | landmark-one-main | moderate | stations html | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| b1f70221 | best practice | landmark-one-main | moderate | tags html | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 67168e30 | best practice | landmark-one-main | moderate | toolpacks html | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| e3bcb1b0 | best practice | landmark-one-main | moderate | views html | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 261a62ce | best practice | page-has-heading-one | moderate | column-definition-detail html | roles: admin, member, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| e4749c9b | best practice | page-has-heading-one | moderate | connector-detail html | roles: admin, member, owner · states: error, loading, locked · themes: brand, brand.dark | axe-app |
| aef9416a | best practice | page-has-heading-one | moderate | connectors html | roles: admin, member, owner · states: empty, error · themes: brand.dark | axe-app |
| 6f106a1e | best practice | page-has-heading-one | moderate | entity-detail html | roles: admin, member, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| 288bdc87 | best practice | page-has-heading-one | moderate | job-detail html | roles: admin, member, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| ace903bb | best practice | page-has-heading-one | moderate | record-detail html | roles: admin, member, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| 5a76dd7d | best practice | page-has-heading-one | moderate | station-detail html | roles: admin, member, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| f06a09fa | best practice | page-has-heading-one | moderate | toolpacks html | roles: admin, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| fe318447 | best practice | region | moderate | column-definition-detail | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 5f394be2 | best practice | region | moderate | column-definition-detail .MuiSelect-select | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| f27bc44f | best practice | region | moderate | column-definition-detail .MuiTypography-caption | roles: admin, member, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| 8b49c0a9 | best practice | region | moderate | column-definition-detail #_r_7_ | roles: member · states: locked, populated · themes: brand, brand.dark | axe-app |
| a513b185 | best practice | region | moderate | column-definition-detail #_r_8_ | roles: owner · states: populated · themes: brand.dark | axe-app |
| 7312a935 | best practice | region | moderate | column-definition-detail #_r_9_ | roles: admin, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 5b0f12d4 | best practice | region | moderate | column-definition-detail h1 | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| a9c87dab | best practice | region | moderate | column-definition-detail h2 | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| ce4f27c1 | best practice | region | moderate | column-definition-detail h6 | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| e2bd8071 | best practice | region | moderate | column-definitions | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 9f3beadb | best practice | region | moderate | column-definitions .MuiBadge-badge | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| fa37b2c4 | best practice | region | moderate | column-definitions .MuiBox-root:nth-child(3) | roles: admin, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| f9cb40a1 | best practice | region | moderate | column-definitions .MuiSelect-select | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| bcdd1bf5 | best practice | region | moderate | column-definitions .MuiTypography-body1 | roles: member · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 07bc970a | best practice | region | moderate | column-definitions .MuiTypography-caption | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 6200d99d | best practice | region | moderate | column-definitions #_r_5_ | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| de4bf48f | best practice | region | moderate | column-definitions h1 | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| c1272d47 | best practice | region | moderate | column-definitions h4 | roles: member · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 5a5b9dca | best practice | region | moderate | column-definitions h6 | roles: admin, owner · states: empty · themes: brand, brand.dark | axe-app |
| 12d07514 | best practice | region | moderate | connector-detail | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 9d427e3c | best practice | region | moderate | connector-detail .MuiBox-root:nth-child(1) | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 01ec542b | best practice | region | moderate | connector-detail .MuiBox-root:nth-child(2) | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 6ad9033e | best practice | region | moderate | connector-detail .MuiBox-root:nth-child(3) > .MuiTypography-caption.MuiTypography-root | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| c3af7195 | best practice | region | moderate | connector-detail .MuiBox-root:nth-child(4) | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 2e25cb1e | best practice | region | moderate | connector-detail .MuiBox-root:nth-child(5) | roles: member · states: locked, populated · themes: brand, brand.dark | axe-app |
| 366131d0 | best practice | region | moderate | connector-detail .MuiBox-root:nth-child(5) > .MuiTypography-caption.MuiTypography-root | roles: admin, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 14e41c76 | best practice | region | moderate | connector-detail .MuiSelect-select | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 65528169 | best practice | region | moderate | connector-detail .MuiStack-root > .MuiBox-root | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 177b984d | best practice | region | moderate | connector-detail .MuiTypography-caption | roles: admin, member, owner · states: error, loading, locked · themes: brand, brand.dark | axe-app |
| ad7d382e | best practice | region | moderate | connector-detail #_r_7_ | roles: member · states: locked, populated · themes: brand, brand.dark | axe-app |
| 64cf3a45 | best practice | region | moderate | connector-detail #_r_g_ | roles: admin, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| f2b96a2b | best practice | region | moderate | connector-detail h1 | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 82f50e01 | best practice | region | moderate | connector-detail h2 | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 3e462d7b | best practice | region | moderate | connector-detail label:nth-child(1) > .Mui-checked.MuiCheckbox-root.MuiCheckbox-colorPrimary > .PrivateSwitchBase-input[data-indeterminate="false"] | roles: admin, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| eb182948 | best practice | region | moderate | connector-detail label:nth-child(1) > .MuiFormControlLabel-label.MuiTypography-body1 | roles: admin, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 270b1f71 | best practice | region | moderate | connector-detail label:nth-child(2) > .MuiCheckbox-root.MuiCheckbox-colorPrimary.MuiCheckbox-sizeSmall > .PrivateSwitchBase-input[data-indeterminate="false"] | roles: admin, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 6783ad40 | best practice | region | moderate | connector-detail label:nth-child(2) > .MuiFormControlLabel-label.MuiTypography-body1 | roles: admin, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| e9e9987b | best practice | region | moderate | connector-detail label:nth-child(3) > .Mui-checked.MuiCheckbox-root.MuiCheckbox-colorPrimary > .PrivateSwitchBase-input[data-indeterminate="false"] | roles: admin, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| a3f54206 | best practice | region | moderate | connector-detail label:nth-child(3) > .MuiFormControlLabel-label.MuiTypography-body1 | roles: admin, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 9b3ae445 | best practice | region | moderate | connector-detail label:nth-child(4) > .MuiCheckbox-root.MuiCheckbox-colorPrimary.MuiCheckbox-sizeSmall > .PrivateSwitchBase-input[data-indeterminate="false"] | roles: admin, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 4fe3b9d3 | best practice | region | moderate | connector-detail label:nth-child(4) > .MuiFormControlLabel-label.MuiTypography-body1 | roles: admin, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| fca5c43a | best practice | region | moderate | connector-detail pre | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 20afee1e | best practice | region | moderate | connector-detail span[data-mui-internal-clone-element="true"] | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| b54e0e25 | best practice | region | moderate | connectors | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| a2182010 | best practice | region | moderate | connectors .MuiTabs-root | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 9fbb93bb | best practice | region | moderate | connectors .MuiTypography-body1 | roles: member · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| 082d4467 | best practice | region | moderate | connectors .MuiTypography-caption | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| b51c13db | best practice | region | moderate | connectors #tabpanel-0 | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 77cc445b | best practice | region | moderate | connectors h1 | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 9bc39cec | best practice | region | moderate | connectors h4 | roles: member · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| 267e82ac | best practice | region | moderate | dashboard | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| a1e991a1 | best practice | region | moderate | dashboard .MuiBox-root:nth-child(1) > .MuiPaper-outlined.MuiPaper-rounded > .MuiStack-root > .MuiBox-root | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 361e4b0e | best practice | region | moderate | dashboard .MuiBox-root:nth-child(1) > .MuiPaper-outlined.MuiPaper-rounded > .MuiStack-root > .MuiStack-root > .MuiStack-root > h2 | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 354f7b17 | best practice | region | moderate | dashboard .MuiBox-root:nth-child(2) > .MuiPaper-outlined.MuiPaper-rounded > .MuiStack-root > .MuiBox-root | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 7c740987 | best practice | region | moderate | dashboard .MuiBox-root:nth-child(2) > .MuiPaper-outlined.MuiPaper-rounded > .MuiStack-root > .MuiStack-root > .MuiStack-root > h2 | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| c3b215a7 | best practice | region | moderate | dashboard h1 | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| d8dc4c82 | best practice | region | moderate | entities | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 0ee9508c | best practice | region | moderate | entities .MuiBadge-badge | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 67bbde1f | best practice | region | moderate | entities .MuiBox-root:nth-child(3) | roles: admin, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| be6bddc2 | best practice | region | moderate | entities .MuiSelect-select | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| c92dd9ae | best practice | region | moderate | entities .MuiTypography-body1 | roles: member · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| f74e5bba | best practice | region | moderate | entities .MuiTypography-caption | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 295d0fdf | best practice | region | moderate | entities #_r_5_ | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| ed550c93 | best practice | region | moderate | entities h1 | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 66bd9162 | best practice | region | moderate | entities h4 | roles: member · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 83ff7272 | best practice | region | moderate | entities h6 | roles: admin, owner · states: empty · themes: brand, brand.dark | axe-app |
| bbd33873 | best practice | region | moderate | entity-detail | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| 53a707b2 | best practice | region | moderate | entity-detail :nth-child(1) > td:nth-child(1) | roles: admin, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 5ea68085 | best practice | region | moderate | entity-detail :nth-child(1) > td:nth-child(2) | roles: admin, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 1185476f | best practice | region | moderate | entity-detail :nth-child(2) > td:nth-child(1) | roles: admin, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 154c59ef | best practice | region | moderate | entity-detail :nth-child(2) > td:nth-child(2) | roles: admin, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| b10e0d03 | best practice | region | moderate | entity-detail .MuiBadge-badge | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| a5dcf5e6 | best practice | region | moderate | entity-detail .MuiCircularProgress-root | roles: admin · states: locked · themes: brand.dark | axe-app |
| 8a2dd4df | best practice | region | moderate | entity-detail .MuiPaper-outlined.MuiPaper-rounded:nth-child(2) > .MuiStack-root > .MuiStack-root > .MuiStack-root > h2 | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| bf91332a | best practice | region | moderate | entity-detail .MuiPaper-outlined.MuiPaper-rounded:nth-child(3) > .MuiStack-root > .MuiStack-root > .MuiStack-root > h2 | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 612e5bd6 | best practice | region | moderate | entity-detail .MuiPaper-outlined.MuiPaper-rounded:nth-child(4) > .MuiStack-root > .MuiStack-root > .MuiStack-root > h2 | roles: admin, member, owner · states: locked · themes: brand, brand.dark | axe-app |
| 82ad9004 | best practice | region | moderate | entity-detail .MuiSelect-select | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 05d45d4d | best practice | region | moderate | entity-detail .MuiStack-root > .MuiStack-root | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 76698f48 | best practice | region | moderate | entity-detail .MuiTypography-caption | roles: admin, member, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| 25bf09d1 | best practice | region | moderate | entity-detail #_r_5_ | roles: member · states: locked, populated · themes: brand, brand.dark | axe-app |
| 9375b716 | best practice | region | moderate | entity-detail #_r_8_-label | roles: admin · states: locked · themes: brand.dark | axe-app |
| 4b3a70e3 | best practice | region | moderate | entity-detail #_r_b_ | roles: admin, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| e993b663 | best practice | region | moderate | entity-detail #_r_f_ | roles: admin · states: locked · themes: brand.dark | axe-app |
| 55430624 | best practice | region | moderate | entity-detail #_r_k_-label | roles: admin, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| fb4dde88 | best practice | region | moderate | entity-detail h1 | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| a6504773 | best practice | region | moderate | entity-detail tbody | roles: member · states: locked, populated · themes: brand, brand.dark | axe-app |
| ddb9b7e7 | best practice | region | moderate | entity-detail th:nth-child(1) > .MuiTypography-caption.MuiTypography-root | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 599c1bd2 | best practice | region | moderate | entity-detail th:nth-child(2) > .MuiTypography-caption.MuiTypography-root | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 5de76e6e | best practice | region | moderate | entity-detail th:nth-child(3) | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| ddd1e423 | best practice | region | moderate | entity-detail th:nth-child(4) | roles: member · states: locked, populated · themes: brand, brand.dark | axe-app |
| 8dde7aef | best practice | region | moderate | entity-detail th:nth-child(5) > .MuiTypography-caption.MuiTypography-root | roles: member · states: locked, populated · themes: brand, brand.dark | axe-app |
| eeb869d8 | best practice | region | moderate | entity-detail th:nth-child(6) > .MuiTypography-caption.MuiTypography-root | roles: member · states: locked, populated · themes: brand, brand.dark | axe-app |
| 5cd7bc66 | best practice | region | moderate | entity-detail th:nth-child(7) > .MuiTypography-caption.MuiTypography-root | roles: member · states: locked, populated · themes: brand, brand.dark | axe-app |
| 01ee7ce3 | best practice | region | moderate | entity-detail th:nth-child(8) > .MuiTypography-caption.MuiTypography-root | roles: member · states: locked, populated · themes: brand, brand.dark | axe-app |
| 3c94b0f9 | best practice | region | moderate | entity-groups | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 1b2fe722 | best practice | region | moderate | entity-groups .MuiBox-root:nth-child(3) | roles: admin, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| 66258491 | best practice | region | moderate | entity-groups .MuiSelect-select | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| f46138eb | best practice | region | moderate | entity-groups .MuiTypography-body1 | roles: member · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| ae4a7fed | best practice | region | moderate | entity-groups .MuiTypography-caption | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| bf032427 | best practice | region | moderate | entity-groups #_r_5_ | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 2b0fdc42 | best practice | region | moderate | entity-groups h1 | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| e3bcac53 | best practice | region | moderate | entity-groups h4 | roles: member · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 8d9cbf03 | best practice | region | moderate | entity-groups h6 | roles: admin, owner · states: empty, populated · themes: brand, brand.dark | axe-app |
| ffd9146d | best practice | region | moderate | help | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| c38d4b4c | best practice | region | moderate | help .MuiStack-root > .MuiStack-root | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 71b96fb8 | best practice | region | moderate | help .MuiTabs-root | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| b8e06ca8 | best practice | region | moderate | help #tabpanel-0 | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| a70724b1 | best practice | region | moderate | help h1 | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 42339020 | best practice | region | moderate | invitation-accept | states: populated · themes: brand, brand.dark | axe-app |
| a8f0ad5c | best practice | region | moderate | invitation-accept .MuiTypography-caption | states: populated · themes: brand, brand.dark | axe-app |
| 96e25f92 | best practice | region | moderate | job-detail | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| cf11d6b8 | best practice | region | moderate | job-detail .MuiPaper-outlined.MuiPaper-rounded:nth-child(2) > .MuiStack-root > .MuiBox-root | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| a086db3a | best practice | region | moderate | job-detail .MuiPaper-outlined.MuiPaper-rounded:nth-child(2) > .MuiStack-root > .MuiStack-root > .MuiStack-root > h2 | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| f888ac25 | best practice | region | moderate | job-detail .MuiPaper-outlined.MuiPaper-rounded:nth-child(3) > .MuiStack-root > .MuiStack-root | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 30441d21 | best practice | region | moderate | job-detail .MuiTypography-caption | roles: admin, member, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| 3100e271 | best practice | region | moderate | job-detail > .MuiBox-root | roles: member · states: populated · themes: brand, brand.dark | axe-app |
| e25d362f | best practice | region | moderate | job-detail h1 | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| baf94561 | best practice | region | moderate | job-detail h2 | roles: member · states: populated · themes: brand, brand.dark | axe-app |
| c1dd5e17 | best practice | region | moderate | job-detail pre | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| feafc351 | best practice | region | moderate | jobs | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| e507817d | best practice | region | moderate | jobs .MuiBadge-badge | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 09f1cfe5 | best practice | region | moderate | jobs .MuiSelect-select | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| a337f55a | best practice | region | moderate | jobs .MuiTypography-caption | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 3e01e080 | best practice | region | moderate | jobs #_r_5_ | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| fac82013 | best practice | region | moderate | jobs h1 | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| ecbc5b30 | best practice | region | moderate | jobs h6 | roles: admin, member, owner · states: empty · themes: brand, brand.dark | axe-app |
| 7948080f | best practice | region | moderate | layout-plan-edit | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| af95816b | best practice | region | moderate | layout-plan-edit h1 | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| a8b28346 | best practice | region | moderate | login | states: populated · themes: brand, brand.dark | axe-app |
| 1a166d56 | best practice | region | moderate | login .MuiTypography-caption | states: populated · themes: brand, brand.dark | axe-app |
| 8ffdd5d4 | best practice | region | moderate | not-invited | states: populated · themes: brand, brand.dark | axe-app |
| c2ea8d4d | best practice | region | moderate | not-invited .MuiTypography-caption | states: populated · themes: brand, brand.dark | axe-app |
| c18ae6e5 | best practice | region | moderate | portal-results | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 188a04d6 | best practice | region | moderate | portal-results .MuiSelect-select | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| f665c601 | best practice | region | moderate | portal-results .MuiTypography-caption | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| b758413d | best practice | region | moderate | portal-results #_r_5_ | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 28f260d2 | best practice | region | moderate | portal-results h1 | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| c3062945 | best practice | region | moderate | portal-results h6 | roles: admin, member, owner · states: empty, populated · themes: brand, brand.dark | axe-app |
| 45f61e3b | best practice | region | moderate | record-detail | roles: admin, member, owner · states: error, loading, locked, populated · themes: brand, brand.dark | axe-app |
| f327694c | best practice | region | moderate | record-detail .MuiTypography-caption | roles: admin, member, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| 9627a220 | best practice | region | moderate | record-detail h1 | roles: admin, member, owner · states: locked, populated · themes: brand, brand.dark | axe-app |
| 1a0e5fa9 | best practice | region | moderate | settings .MuiTabs-root | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| 58c784ab | best practice | region | moderate | settings .MuiTypography-caption | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| de2f8f16 | best practice | region | moderate | settings #tabpanel-0 | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| 92f268cf | best practice | region | moderate | settings h1 | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| c9180b2e | best practice | region | moderate | station-detail | roles: admin, member, owner · states: error, loading, populated · themes: brand, brand.dark | axe-app |
| f12908a5 | best practice | region | moderate | station-detail .MuiBox-root:nth-child(1) > .MuiTypography-caption.MuiTypography-root | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 6e679f67 | best practice | region | moderate | station-detail .MuiBox-root:nth-child(2) > .MuiTypography-caption.MuiTypography-root | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| ca21813a | best practice | region | moderate | station-detail .MuiBox-root:nth-child(3) | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| b69f6692 | best practice | region | moderate | station-detail .MuiBox-root:nth-child(4) | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 147b45dd | best practice | region | moderate | station-detail .MuiBox-root:nth-child(5) | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 481e06c2 | best practice | region | moderate | station-detail .MuiChip-colorPrimary.MuiChip-outlinedPrimary:nth-child(1) > .MuiChip-label.MuiChip-labelSmall | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 78e58d5d | best practice | region | moderate | station-detail .MuiChip-colorPrimary.MuiChip-outlinedPrimary:nth-child(2) > .MuiChip-label.MuiChip-labelSmall | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| b55c4ccf | best practice | region | moderate | station-detail .MuiChip-colorPrimary.MuiChip-outlinedPrimary:nth-child(3) > .MuiChip-label.MuiChip-labelSmall | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| f245826d | best practice | region | moderate | station-detail .MuiChip-colorPrimary.MuiChip-outlinedPrimary:nth-child(4) > .MuiChip-label.MuiChip-labelSmall | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| a4a7d402 | best practice | region | moderate | station-detail .MuiSelect-select | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 5be9ebca | best practice | region | moderate | station-detail .MuiTypography-caption | roles: admin, member, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| 6f6b05e8 | best practice | region | moderate | station-detail #_r_m_ | roles: member · states: populated · themes: brand, brand.dark | axe-app |
| b67efb17 | best practice | region | moderate | station-detail #_r_n_ | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| d7eaaa98 | best practice | region | moderate | station-detail > .MuiTypography-body2 | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| cdfcb63d | best practice | region | moderate | station-detail h1 | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 9528c71b | best practice | region | moderate | station-detail h2 | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 59614a15 | best practice | region | moderate | station-detail h6 | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 55af038b | best practice | region | moderate | stations | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 18d5b141 | best practice | region | moderate | stations .MuiBox-root:nth-child(3) | roles: admin, member, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| d22ec858 | best practice | region | moderate | stations .MuiSelect-select | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 683db8c3 | best practice | region | moderate | stations .MuiStack-root > .MuiStack-root | roles: admin, member, owner · states: populated · themes: brand, brand.dark | axe-app |
| 583ee6ca | best practice | region | moderate | stations #_r_6_ | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| d1e0e98f | best practice | region | moderate | stations h1 | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 8af57ec9 | best practice | region | moderate | stations h6 | roles: admin, member, owner · states: empty · themes: brand, brand.dark | axe-app |
| 1211227f | best practice | region | moderate | tags | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| b13388a5 | best practice | region | moderate | tags .MuiBox-root:nth-child(3) | roles: admin, owner · states: error, loading · themes: brand, brand.dark | axe-app |
| 9d464737 | best practice | region | moderate | tags .MuiSelect-select | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 9b989a57 | best practice | region | moderate | tags .MuiTypography-body1 | roles: member · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 68284887 | best practice | region | moderate | tags .MuiTypography-caption | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| aed9daf4 | best practice | region | moderate | tags #_r_5_ | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 98e30cf2 | best practice | region | moderate | tags h1 | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| b88909f2 | best practice | region | moderate | tags h4 | roles: member · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 42382178 | best practice | region | moderate | tags h6 | roles: admin, owner · states: empty, populated · themes: brand, brand.dark | axe-app |
| 0d3250c8 | best practice | region | moderate | toolpacks | roles: admin, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 39e8653f | best practice | region | moderate | toolpacks :nth-child(1) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 0df46619 | best practice | region | moderate | toolpacks :nth-child(10) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| bec2cafc | best practice | region | moderate | toolpacks :nth-child(11) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 4b8313db | best practice | region | moderate | toolpacks :nth-child(11) > :nth-child(2) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 9bd97a59 | best practice | region | moderate | toolpacks :nth-child(11) > :nth-child(4) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 4156eed8 | best practice | region | moderate | toolpacks :nth-child(11) > :nth-child(5) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| c7799d21 | best practice | region | moderate | toolpacks :nth-child(12) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 9922ca63 | best practice | region | moderate | toolpacks :nth-child(12) > :nth-child(2) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 0648c43a | best practice | region | moderate | toolpacks :nth-child(12) > :nth-child(4) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| adb7b81d | best practice | region | moderate | toolpacks :nth-child(12) > :nth-child(5) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| e1884e65 | best practice | region | moderate | toolpacks :nth-child(13) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| c4bd8c41 | best practice | region | moderate | toolpacks :nth-child(13) > :nth-child(2) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| a6555b90 | best practice | region | moderate | toolpacks :nth-child(13) > :nth-child(4) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| e3f9e714 | best practice | region | moderate | toolpacks :nth-child(13) > :nth-child(5) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| acd1a7f4 | best practice | region | moderate | toolpacks :nth-child(14) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| a5ef33b1 | best practice | region | moderate | toolpacks :nth-child(14) > :nth-child(2) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 160e207d | best practice | region | moderate | toolpacks :nth-child(14) > :nth-child(3) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 78dbd50b | best practice | region | moderate | toolpacks :nth-child(14) > :nth-child(4) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 846b4e39 | best practice | region | moderate | toolpacks :nth-child(14) > :nth-child(5) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| b6e5fba6 | best practice | region | moderate | toolpacks :nth-child(15) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 486adc58 | best practice | region | moderate | toolpacks :nth-child(15) > :nth-child(2) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| c1e22b2b | best practice | region | moderate | toolpacks :nth-child(15) > :nth-child(4) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| c51796a2 | best practice | region | moderate | toolpacks :nth-child(15) > :nth-child(5) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| f5e3ad3f | best practice | region | moderate | toolpacks :nth-child(16) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 4812b340 | best practice | region | moderate | toolpacks :nth-child(16) > :nth-child(2) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| a81163be | best practice | region | moderate | toolpacks :nth-child(16) > :nth-child(4) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 46d77726 | best practice | region | moderate | toolpacks :nth-child(16) > :nth-child(5) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 0b581a7d | best practice | region | moderate | toolpacks :nth-child(17) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| f04d96ad | best practice | region | moderate | toolpacks :nth-child(17) > :nth-child(2) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 1130d41e | best practice | region | moderate | toolpacks :nth-child(17) > :nth-child(4) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| bf7a633f | best practice | region | moderate | toolpacks :nth-child(17) > :nth-child(5) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 2726ca58 | best practice | region | moderate | toolpacks :nth-child(18) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| fee200d9 | best practice | region | moderate | toolpacks :nth-child(18) > :nth-child(2) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 0ff9134f | best practice | region | moderate | toolpacks :nth-child(18) > :nth-child(4) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| de1fc4e4 | best practice | region | moderate | toolpacks :nth-child(18) > :nth-child(5) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 81411777 | best practice | region | moderate | toolpacks :nth-child(19) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| ce641d1b | best practice | region | moderate | toolpacks :nth-child(19) > :nth-child(2) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 1496fcf5 | best practice | region | moderate | toolpacks :nth-child(19) > :nth-child(4) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 43f77b06 | best practice | region | moderate | toolpacks :nth-child(19) > :nth-child(5) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| cd6dd9e2 | best practice | region | moderate | toolpacks :nth-child(2) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 8cbb2da4 | best practice | region | moderate | toolpacks :nth-child(20) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 784537ab | best practice | region | moderate | toolpacks :nth-child(20) > :nth-child(2) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 9a982a8d | best practice | region | moderate | toolpacks :nth-child(20) > :nth-child(4) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 35ff84ef | best practice | region | moderate | toolpacks :nth-child(20) > :nth-child(5) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 2a4ec89d | best practice | region | moderate | toolpacks :nth-child(3) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 8ce61dff | best practice | region | moderate | toolpacks :nth-child(4) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| e528442f | best practice | region | moderate | toolpacks :nth-child(5) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| a6236c9f | best practice | region | moderate | toolpacks :nth-child(6) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 0de2e7c6 | best practice | region | moderate | toolpacks :nth-child(7) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 06955dfa | best practice | region | moderate | toolpacks :nth-child(8) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| 4a75bb0c | best practice | region | moderate | toolpacks :nth-child(9) | roles: admin, owner · states: populated · themes: brand, brand.dark | axe-app |
| c47419a7 | best practice | region | moderate | toolpacks .MuiSelect-select | roles: admin, owner · states: empty, populated · themes: brand, brand.dark | axe-app |
| f1584f8e | best practice | region | moderate | toolpacks .MuiTypography-body1 | roles: member · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 8b9916da | best practice | region | moderate | toolpacks .MuiTypography-caption | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 0c7f4dd7 | best practice | region | moderate | toolpacks #_r_a_ | roles: admin, owner · states: empty, populated · themes: brand, brand.dark | axe-app |
| 609c48ec | best practice | region | moderate | toolpacks h1 | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| a5bc854f | best practice | region | moderate | toolpacks h4 | roles: member · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 01244cc2 | best practice | region | moderate | toolpacks tbody | roles: admin, owner · states: empty · themes: brand, brand.dark | axe-app |
| 67cf5980 | best practice | region | moderate | toolpacks th:nth-child(3) | roles: admin, owner · states: empty, populated · themes: brand, brand.dark | axe-app |
| aa05cc5e | best practice | region | moderate | toolpacks th:nth-child(5) | roles: admin, owner · states: empty, populated · themes: brand, brand.dark | axe-app |
| 76eacd51 | best practice | region | moderate | toolpacks th:nth-child(6) | roles: admin, owner · states: empty, populated · themes: brand, brand.dark | axe-app |
| 2b9b4f28 | best practice | region | moderate | views | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 38577993 | best practice | region | moderate | views .MuiSelect-select | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| fed35c56 | best practice | region | moderate | views .MuiTypography-caption | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 07be0cdb | best practice | region | moderate | views #_r_5_ | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| d66ac43e | best practice | region | moderate | views h1 | roles: admin, member, owner · states: empty, error, loading, populated · themes: brand, brand.dark | axe-app |
| 00c04403 | best practice | region | moderate | views h6 | roles: admin, member, owner · states: empty, populated · themes: brand, brand.dark | axe-app |

<a id="owner-798"></a>

## #798 Marketing site

| ID | WCAG | Rule | Impact | Location | Seen | Tool |
|---|---|---|---|---|---|---|
| e95f417a | 1.4.3 | color-contrast | serious | / .site-header__actions > .button--primary.button[href$="app-dev.portalsai.io"] | themes: brand.dark | axe-site |
| 21a03d6c | 1.4.3 | color-contrast | serious | / p:nth-child(3) > .button--primary.button[href$="app-dev.portalsai.io"] | themes: brand.dark | axe-site |
| 8e75bafa | 1.4.3 | color-contrast | serious | /404.html .button.button--primary[href="/"] | themes: brand.dark | axe-site |
| 51df4785 | 1.4.3 | color-contrast | serious | /404.html a[href$="app-dev.portalsai.io"] | themes: brand.dark | axe-site |
| 9d5b4a5a | 1.4.3 | color-contrast | serious | /contact/ .button--primary.button[href$="mailto:qa@portalsai.io"] | themes: brand.dark | axe-site |
| 42caa4b6 | 1.4.3 | color-contrast | serious | /contact/ a[href$="app-dev.portalsai.io"] | themes: brand.dark | axe-site |
| 6d27e9de | 1.4.3 | color-contrast | serious | /features/ .button | themes: brand.dark | axe-site |
| dc177e7d | 1.4.3 | color-contrast | serious | /pricing/ .card:nth-child(1) > .button--primary.button[href$="app-dev.portalsai.io"] | themes: brand.dark | axe-site |
| 8784c3a9 | 1.4.3 | color-contrast | serious | /pricing/ .card:nth-child(2) > .button--primary.button[href$="app-dev.portalsai.io"] | themes: brand.dark | axe-site |
| 0091aabc | 1.4.3 | color-contrast | serious | /pricing/ .card:nth-child(3) > .button--primary.button[href$="app-dev.portalsai.io"] | themes: brand.dark | axe-site |
| 15931e8f | 1.4.3 | color-contrast | serious | /pricing/ .site-header__actions > .button--primary.button[href$="app-dev.portalsai.io"] | themes: brand.dark | axe-site |
| 44b56cbe | 1.4.3 | color-contrast | serious | /privacy/ .button | themes: brand.dark | axe-site |
| 9d1d3479 | 1.4.3 | color-contrast | serious | /security/ .button | themes: brand.dark | axe-site |
| b281f766 | 1.4.3 | color-contrast | serious | /terms/ .button | themes: brand.dark | axe-site |
| 52ca06eb | 1.4.3 | color-contrast | serious | /use-cases/ .button--primary | themes: brand.dark | axe-site |
| d05cc57e | 1.4.3 | color-contrast | serious | /use-cases/analysts/ .site-header__actions > .button--primary.button[href$="app-dev.portalsai.io"] | themes: brand.dark | axe-site |
| 09732b38 | 1.4.3 | color-contrast | serious | /use-cases/analysts/ p:nth-child(5) > .button--primary.button[href$="app-dev.portalsai.io"] | themes: brand.dark | axe-site |
| f832fe26 | 1.4.3 | color-contrast | serious | /use-cases/founders/ .site-header__actions > .button--primary.button[href$="app-dev.portalsai.io"] | themes: brand.dark | axe-site |
| 12d43909 | 1.4.3 | color-contrast | serious | /use-cases/founders/ p:nth-child(5) > .button--primary.button[href$="app-dev.portalsai.io"] | themes: brand.dark | axe-site |
| b2a20acc | 1.4.3 | color-contrast | serious | /use-cases/operations/ .site-header__actions > .button--primary.button[href$="app-dev.portalsai.io"] | themes: brand.dark | axe-site |
| 12934678 | 1.4.3 | color-contrast | serious | /use-cases/operations/ p:nth-child(5) > .button--primary.button[href$="app-dev.portalsai.io"] | themes: brand.dark | axe-site |

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

The script for each of the flows above is walked with **VoiceOver + Safari** (macOS) and **NVDA + Firefox** (Windows).

| ID | Flow | Step | WCAG | Observed | AT | Owner |
|---|---|---|---|---|---|---|
