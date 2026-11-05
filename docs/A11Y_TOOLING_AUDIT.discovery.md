# Accessibility tooling and audit inventory — Discovery

**Issue:** [EnterpriseBT/portal-ai#792](https://github.com/EnterpriseBT/portal-ai/issues/792) · first child of epic [#791](https://github.com/EnterpriseBT/portal-ai/issues/791) · branch `feat/792-a11y-audit` → `epic/a11y-conformance`

**Why this exists.** The epic commits Portals AI to WCAG 2.2 AA. Today nothing in the repo measures accessibility: no `axe`, `jest-axe`, `@axe-core/*` or `jsx-a11y` anywhere under `apps/`, `packages/`, `scripts/` or `.github/`. The six area children (#793–#798) need a list of what is broken, who owns it, and where it was seen. Without one they would each guess. The gates child (#799) needs the tools already wired, so that "turn on the gate" means changing a flag, not building the tooling.

This is the ticket that installs three report-only tools, runs them across `apps/web`, `apps/site` and `packages/core` as owner, admin and member, in each view's states and both themes, adds a keyboard-only pass and a user-walked screen-reader pass, and writes the result to `docs/A11Y_AUDIT.md` with every finding mapped to a WCAG criterion and an owning child. It turns on no gate.

## The current shape

### Lint

| Package | Config | `lint` script | Note |
|---|---|---|---|
| `apps/web` | `apps/web/eslint.config.js:1-122` (flat, type-aware) | `--max-warnings 0` (`package.json:11`) | react, react-hooks, ts-eslint |
| `packages/core` | `packages/core/eslint.config.js:7-92` | `--max-warnings 0` (`package.json:71`) | same plugin set |
| `apps/site` | `apps/site/eslint.config.js:15-54`, `astro.configs.recommended` (`:18`) | `--max-warnings 0` (`package.json:11`) | eslint-plugin-astro 1.7.0 ships `jsx-a11y-recommended` / `jsx-a11y-strict` configs that load a user-installed `eslint-plugin-jsx-a11y` (peer `^6.5.1`), not enabled |

ESLint 9.39 everywhere, no root config; root `lint` is `turbo run lint`. Because every `lint` is zero-warning, adding a11y rules to an existing config **at any severity** would fail Static Checks (#427). The report has to run from a config the `lint` script never loads.

### Unit tests

Web and core both run Jest 29 in ESM mode with jsdom (`apps/web/jest.config.js:3-35`, `packages/core/jest.config.js:3-29`). Matchers are registered in `src/__tests__/setup.ts:1` in each package (`import "@testing-library/jest-dom"`). Web's `apps/web/src/__tests__/test-utils.tsx` exports `renderWithProviders` as `render` (`:38`, `:101-102`). Core's `packages/core/src/__tests__/test-utils.ts` holds only model factories (`:14-41`), so a DOM helper there would be its first. Tests already query by role heavily: about 1,507 `*ByRole` queries in web and 202 in core.

Storybook 8.6.19 in both packages, with 66 web stories and 29 core stories, and decorators in `.storybook/preview.tsx` (web `:67`, core `:30`). Per the Component File Policy, stories render the pure `…UI` components, so they already exercise every reusable surface with no SDK or router.

### Browser harness

`packages/e2e` uses Playwright 1.62.1. `buildConfig()` (`src/lib/playwright-config.ts:42-106`) defines the projects `setup`, `core-loop`, `login` and `roles`, with `workers: 1`. Per-role sessions live in `.auth/<identity>.storageState.json` (`src/lib/target.ts:139-151`), and `e2e:seed` provisions the `e2e-fixture` org with an owner, an admin, a member and all toolpacks. **CI names its projects explicitly** (`.github/workflows/e2e-test.yml`, `--project=setup --project=core-loop --project=login --project=roles`), so adding a project changes nothing CI runs. Nothing targets `apps/site`. `scripts/e2e-stack.sh` boots only the API and web.

`apps/site` builds without the API: when `SITE_CONFIG_URL` is unset, the build reads the committed `site-config.fixture.json` (`src/lib/site-config.ts:17,29,61`). `astro preview` serves the build on :3002. `scripts/verify-pages.mjs:114-116` already checks for exactly one `<h1>` per page.

### Surfaces the audit has to reach

| Area child | Primary code | Already known from the survey |
|---|---|---|
| #797 shell | `layouts/Authorized.layout.tsx`, `SidebarNav.component.tsx:149` | no `<main>`, no `<nav>`, no skip link, no per-route `document.title` (static `index.html:14`), no route-change focus, mobile overlay uses `pointerEvents:none` without `inert` (`:63`). `Loading.view` spinner has no label |
| #793 dialogs/forms | `packages/core/src/ui/Modal.tsx`, ~50 `*Dialog.component.tsx` | strongest existing contract (#789), so expect the fewest findings |
| #794 tables | `packages/core/src/ui/DataTable.tsx` (custom MUI `Table`, `onRowClick` `:85`, dnd-kit reorder `:211`), `PaginationToolbar` | whether whole-row click is keyboard-operable; drag-only reorder (WCAG 2.5.7) |
| #795 RegionEditor | `modules/RegionEditor/SheetCanvas.component.tsx` (DOM grid virtualized via `useVirtualizer` `:869`, pointer-driven `:1188`) | no `role="grid"`; region drawing is drag-only |
| #796 maps/charts | `modules/MapWidget` (MapLibre), `modules/D3Widget/D3SandboxFrame.component.tsx:189` (D3 in sandboxed iframe) | axe can't see into the sandboxed iframe's generated SVG; there's no text alternative contract |
| #798 site | `apps/site/src/layouts/{Base,Page}.astro`, `SiteHeader.astro` | already has skip link, `<main>`, labelled navs, `aria-current`, focus-visible, reduced motion |

States render through shared pieces: `DataResult` → `StatusMessage` (spinner plus text, with no `role` or `aria-live`), `PageEmptyState`, `HttpError`, and the lock alert `ConnectorInstanceLockAlertUI` (`ConnectorInstanceLockAlert.component.tsx:73`, an MUI `Alert` with no live region, used on four detail views). Role differences come from `ActionGate` (`packages/core/src/ui/ActionGate.ts:15-21`): a `disable` gate renders `aria-disabled` and stays focusable (`GatedButton.tsx:40-64`), a `hide` gate removes the control, and the Settings tabs differ per role (`Settings.view.tsx:240-245`).

## The design space

### Decision 1 — How jsx-a11y runs without touching `lint`

- **A. A sibling config per package**: `eslint.a11y.config.js` spreads the package's own config and adds `jsxA11y.flatConfigs.strict` (the Astro preset in the site), run by an `a11y:lint` script with a JSON formatter and no `--max-warnings`.
- **B. CLI `--rule` overrides** on the existing config: there's no way to add a plugin's rules from the command line in flat config.
- **C. Rules at `warn` in the real config**, with `lint` changed to tolerate them, which breaks the zero-warning gate CLAUDE.md requires.

| | A | B | C |
|---|---|---|---|
| CI unchanged | yes | yes | no |
| #799's switch-on | merge the sibling into the main config | n/a | flip to error |
| Feasible | yes | no | violates policy |

**Lean: A**, with the `strict` preset. The inventory should measure the bar the gate will hold, and #799 can drop a strict-only rule with a recorded reason more easily than discover one later.

### Decision 2 — Where the `jest-axe` helper lives and what it disables

- **A. `expectNoAxeViolations(container, options?)`** in each package's `src/__tests__/` (web `test-utils.tsx`, a new core `axe.util.ts`), with `toHaveNoViolations` registered in each `setup.ts`.
- **B. One shared helper exported from core**, which would put `jest-axe` on core's import path for a test-only need.

Both disable two rules that jsdom can't evaluate truthfully: `color-contrast`, because jsdom has no layout or computed colour, and `region`, because a component rendered alone is never inside a landmark. Those two are measured in the browser instead (Decision 4).

**Lean: A.** The helper is about 15 lines, and duplicating it is cheaper than a cross-package test dependency. Both copies read the disabled rules from one exported constant per package, with a comment that names the other copy.

### Decision 3 — How `jest-axe` contributes to the inventory

The helper alone finds nothing until a test calls it, and adding calls to existing tests is the area children's work. The inventory still needs a component-level sweep.

- **A. A stories sweep:** an `a11y:stories` script in web and core. It runs `composeStories` (Storybook 8.6's portable stories, with `setProjectAnnotations` from each `.storybook/preview.tsx`) over every `*.stories.tsx`, renders each story, runs axe, and writes JSON. It sits outside `test:unit`, so CI is unchanged. A story that can't render outside Storybook is recorded as skipped, not dropped.
- **B. Browser-only:** skip the component sweep and rely on Decision 4.
- **C. Storybook's a11y addon / test-runner**, which needs a running Storybook and adds a second runner alongside Jest.

| | A | B | C |
|---|---|---|---|
| Covers states the app rarely shows (disabled gates, error props) | yes, stories set them | only if reachable | yes |
| New runtime | none (Jest) | none | storybook test-runner |
| Becomes #799's per-component gate | directly | no | yes, but a new CI service |

**Lean: A.** The 95 stories already enumerate the UI components and their prop states, which is the coverage a route walk misses.

### Decision 4 — The browser axe walk

- **A. A Playwright `a11y` project** in `packages/e2e`, with one spec that iterates a route manifest × role × state × theme and runs `@axe-core/playwright` with tags `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa`. It writes JSON and **records, never asserts**, so it can't go red. CI never names the project, so it doesn't run there.
- **B. An agent walk via Playwright MCP / `/smoke-walk`.** It can't be repeated byte-for-byte, and #799 can't reuse it.

**Lean: A.** The route manifest becomes #799's gate input unchanged. A second project, `a11y-site`, uses `baseURL: http://localhost:3002` against `astro preview` of a fixture build, with no auth.

### Decision 5 — Producing the states without changing the stack

- **A. Network interception:** `page.route` on the view's list or detail endpoints. Fulfilling an empty page gives the **empty** state, a 500 gives **error**, a held response gives **loading** (axe runs while the request is pending), and a fixture running job on the running-jobs endpoint gives **locked**.
- **B. Seed every state for real**: empty orgs, broken connectors, and a non-terminal `jobs` row.

| | A | B |
|---|---|---|
| Deterministic | yes | locked state races the reaper (#391) |
| Touches seed or schema | no | yes |
| Fidelity | renders the real components from a faked response | full |

**Lean: A.** The audit inspects markup, and the markup comes from the same components either way. The populated state still uses the real `e2e-fixture` data.

### Decision 6 — Theme coverage

Contrast is the WCAG failure most likely to differ between `brand` and `brand.dark`, and #798's site bridges the same palettes. **Lean:** walk every route in both themes by setting `localStorage["portalai-theme"]` before navigation. For non-contrast rules the second theme's findings are deduplicated against the first.

### Decision 7 — Turning three tools' output into one inventory

`scripts/a11y-inventory.mjs` reads the JSON results (from a gitignored `a11y-results/` directory in each package) and normalizes each finding to `{tool, rule, wcag[], location, role, state, theme, owner}`.
- **WCAG criterion:** axe results carry the criterion in their `wcagNNN` tags. jsx-a11y rules don't, so the script holds a static rule-to-criterion map, and a rule missing from the map fails the script.
- **Owner:** a path-prefix table assigns it (RegionEditor → #795, MapWidget/D3Widget → #796, layouts/SidebarNav → #797, `apps/site` → #798, `*Dialog`/`Modal`/form utils → #793, DataTable/PaginationToolbar/TableWidget → #794). Anything unmatched goes to an `unassigned` bucket, never to a guessed owner.
- **Output:** the script rewrites only the generated section of `docs/A11Y_AUDIT.md`, between marker comments. The keyboard and screen-reader findings sit in hand-written sections it never touches.

**Lean: as described.** It's the one caller-driven piece of infrastructure, and both this ticket (the inventory) and #799 (an empty inventory is the gate's precondition) use it.

## Tradeoff comparison

| | D1 sibling config | D2 per-pkg helper | D3 stories sweep | D4 Playwright project | D5 interception | D6 both themes | D7 normalizer |
|---|---|---|---|---|---|---|---|
| Changes CI result | no | no | no | no | no | no | no |
| Reused by #799 | yes | yes | yes | yes | yes | yes | yes |
| Spread to spec | yes | yes | yes | yes | yes | yes | yes |

## Recommendation

1. Install `eslint-plugin-jsx-a11y` (root dev dep). Add `eslint.a11y.config.js` to `apps/web` and `packages/core` (base config plus `flatConfigs.strict`) and to `apps/site` (base config plus eslint-plugin-astro's `jsx-a11y-strict`). Each package gets an `a11y:lint` script writing `a11y-results/eslint.json`.
2. Install `jest-axe` (plus types) in web and core. Register `toHaveNoViolations` in each `setup.ts`, and export `expectNoAxeViolations` with `color-contrast` and `region` disabled for jsdom.
3. Add `a11y:stories` to web and core: a Jest config outside `test:unit` that composes every story with the preview annotations, runs axe, and writes `a11y-results/stories.json`, recording unrenderable stories as skipped.
4. Add `@axe-core/playwright` and two Playwright projects, `a11y` (app: route manifest × owner/admin/member × populated/empty/error/loading/locked × brand/brand.dark, with states produced by `page.route`) and `a11y-site` (the built site on :3002, both themes). Both record and never assert, and CI's explicit project list stays as it is.
5. Add a root `a11y:report` script that runs the per-package scripts, then `scripts/a11y-inventory.mjs`. The script normalizes, maps criteria and owners, and rewrites the generated section of `docs/A11Y_AUDIT.md`.
6. Add a keyboard-only checklist per core flow, walked by the agent through Playwright MCP, and a screen-reader script per flow that the user walks with VoiceOver and NVDA. Both sets of findings go in the hand-written sections of the inventory.
7. Append each area child's slice of the inventory to its issue body, linking to the anchored section of `docs/A11Y_AUDIT.md`.

## Open questions

1. **Which routes count as "core flows" for the keyboard and screen-reader passes?** The axe walk can cover every leaf route (about 26), but a manual pass of all of them in two screen readers is more than one sitting. Lean: the manual passes cover sign-in, CSV import → records, station → portal → pin, a curated view, Settings → Members and the marketing site's home → pricing → contact; axe covers every route.
2. **Is the RegionEditor reachable by the browser walk?** It needs an uploaded workbook in a draft session. Lean: drive it through the existing `core-loop` upload steps reused as a fixture, and if that proves brittle, rely on its stories plus the manual pass and record the gap in the inventory.
3. **Can axe see the D3 iframe?** It's sandboxed `allow-scripts` without `allow-same-origin`, so the content is cross-origin to axe. Lean: record the frame-level result (title and name) and add a manual finding for the missing text alternative. Fixing that is #796's.
4. **Do the WCAG 2.2-only criteria need anything beyond axe?** 2.4.11 (focus not obscured), 2.5.7 (dragging), 3.3.7 (redundant entry) and 3.3.8 (accessible authentication) aren't automatable. axe covers only 2.5.8 (target size). Lean: these four get explicit rows in the keyboard checklist, so they're never skipped by default.
5. **Should `a11y-results/` be committed?** Lean: no. It's gitignored, and the inventory doc is the committed record. Raw axe output can include page text from seeded data and is noisy in diffs.

## Enterprise-scale considerations

- **Concurrency & correctness**: N/A because the tooling runs on demand against a local stack; `workers: 1` matches the harness.
- **Accuracy & auditability**: Lean: the inventory doc is the record of truth that #800's ACR is built from. Every row names its tool, rule, criterion, role, state and theme, so a buyer's question traces back to evidence, and the generator makes a rerun reproducible.
- **Failure modes**: Lean: the scripts fail on their own setup problems (no stack, an unmapped jsx-a11y rule, an unparseable result) and record findings without failing. A silently empty report would read as "conformant", so an empty result set is reported as an error unless every tool ran.
- **Scale & unbounded growth**: Lean: about 26 routes × 3 roles × ≤5 states × 2 themes is roughly 780 axe runs, minutes not hours. Interception keeps it from growing with seed size.
- **Multi-tenancy**: N/A because the walk runs only in the seeded `e2e-fixture` org on a local stack. Deployed QA sessions aren't used here.
- **Contract stability**: Lean: the route manifest and the normalized finding shape are what #799 consumes, so they're defined once in `packages/e2e/src/lib/` and `scripts/a11y-inventory.mjs`, not re-derived per gate.
- **Data lifecycle**: Lean: `docs/A11Y_AUDIT.md` lives for the epic's lifetime, and #800 folds it into the ACR or deletes it at close-out (recorded in #792's PRD). Raw results are gitignored and disposable.

## What this doesn't decide

- Fixing any finding (#793–#798).
- Which tools gate CI, and at what scope (#799). This ticket leaves each one switch-on-ready.
- ACR format and edition (#800).
- Running axe against deployed app-dev/prod. Local-only keeps seed data and QA credentials out of reports.

## Next step

`/spec 792` turns the recommendation into the contract: script names, the route manifest's shape, the normalized finding schema, the `docs/A11Y_AUDIT.md` layout and marker contract, and acceptance. `/plan 792` then slices it roughly as (1) jsx-a11y report, (2) jest-axe helper + stories sweep, (3) Playwright `a11y` + `a11y-site` projects with interception states, (4) normalizer + inventory generation, (5) keyboard and screen-reader passes plus issue-body slices.
