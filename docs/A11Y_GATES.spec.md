# Accessibility gates in CI — Spec

This spec pins the contract for turning the in-repo accessibility checks into gates that fail CI. It follows the decisions in [`docs/A11Y_GATES.discovery.md`](A11Y_GATES.discovery.md) for [#799](https://github.com/EnterpriseBT/portal-ai/issues/799) (epic #791).

> **Amendment (2026-11-13): axe now runs only in unit tests.** After implementation, the story sweep (`a11y:stories`) and the Playwright axe walks (`a11y:axe`, `a11y:axe:site`) proved slow and flaky, and the sweep's load crashed the dev container. They're removed, along with the `/smoke-walk` axe audit, the `a11y:report` inventory generator and `@axe-core/playwright`. Playwright itself stays: the E2E specs, `verify-login` and the agent sessions are unchanged. Two gates remain: jsx-a11y in `lint`, and the component-axe guards, which make every component test run `expectNoAxeViolations` in jsdom. `docs/A11Y_AUDIT.md` records the last automated run and keeps the hand-walked passes. Anything below about the sweep, the walks, the inventory or the `/smoke-walk` audit is superseded.

## Key decisions (flag for review)

1. **jsx-a11y moves into `lint` itself.** Each package's main eslint config gains the jsx-a11y strict block, and the three `eslint.a11y.config.js` files are deleted.
   - `a11y:lint` runs the main config with the JSON formatter. The inventory already reads only `jsx-a11y/*` and `astro/jsx-a11y/*` rules (`scripts/a11y-inventory.mjs:177,228`), so the other rules in the main config don't reach it.
   - This replaces discovery's "shared block" lean: with one config left, there is nothing to share.
2. **Story axe fails by default.**
   - `a11y:stories` fails on any violation, and on any skip not listed in `SKIPPED` (story → reason, starts empty).
   - `a11y:report` sets `A11Y_REPORT_ONLY=1` for its story step, so a regenerated report still records instead of stopping halfway.
   - The default is fail-closed; recording is the opt-out.
3. **Unit Tests runs two new steps:** `npm run a11y:stories` (a cacheable turbo task) and `npm run lint:a11y-inventory`. No new workflow and no new required check: both ride the required `Unit Tests` job.
4. **Component guard covers paired tests only.** A web `*.component.tsx` / `*.layout.tsx`, or a core `src/ui/*.tsx`, that has a test file of its own must have that file call the shared axe assertion. Views are out: the route walk covers them.
5. **The browser walks stay report-only.** `a11y:axe` and `a11y:axe:site` are unchanged apart from documentation.
6. **The two job-detail findings are fixed in the theme:**
   - **Contrast:** code-token colours move into a new `palette.code`, following `palette.sheet`'s precedent from #996.
   - **Keyboard:** `HighlightedCode`'s scrolling `pre` becomes a focusable, named region.
7. **`/smoke-walk` runs axe-core on the page each step leaves**, with `AXE_TAGS`. A violation marks the step `mismatch`.

## Scope

### In scope
- **Fixes first:** the job-detail contrast and scroll-focus fixes; the 5 FAQList and GlossaryList stories that fail to render.
- **Gates:** jsx-a11y strict in `lint` for web, core and site; the story gate and its CI steps; the component-axe guard in web and core.
- **Backfill:** the axe assertion added to every paired component test that lacks it (~100 web and ~25 core).
- **Skill:** the `/smoke-walk` axe step.
- **Docs:** CLAUDE.md (Accessibility Requirements, Dialog & Form Test Checklist, CI gating), `packages/e2e/README.md`, and `docs/A11Y_AUDIT.md`'s preamble.

### Out of scope
- Gating the Playwright walks, locally or in CI.
- A Copilot mirror (there is none).
- Manual walks.
- The ACR (#800).

## Surface

### 1. Code-token palette (core)

`packages/core/src/types/theme.ts` gains this interface, next to `SheetPalette`:

```ts
/** Syntax-highlight token colours for `HighlightedCode` (#799). Every token is
 *  AA (4.5:1) on `background`, which is opaque so the ratio is fixed. */
export interface CodePalette {
  background: string;
  text: string;
  keyword: string; builtin: string; type: string; string: string;
  number: string; comment: string; function: string; attr: string;
  meta: string; literal: string;
}
```

- **Typing:** the module augmentation adds `code: CodePalette` to `Palette` and `code?: CodePalette` to `PaletteOptions`.
- **Theme JSON:** both `packages/core/src/assets/themes/brand-theme.json` and `brand-theme-dark.json` define `palette.code`. Values are literals, following the "Styling lives in the theme" rule. The dark theme keeps today's dark hues where they already pass.

### 2. `HighlightedCode` (web)

`apps/web/src/components/HighlightedCode.component.tsx`:
- **Colours:** the inline `tokenColors` objects, the `isDark` branch and the `action.hover` background are removed. The `pre` carries `data-code-block`, and core's `codeBlockRules(palette, ring)` (`ui/ThemeProvider.tsx`, spread into `MuiCssBaseline` like `sheetCanvasRules`) colours it from `palette.code`: background, text, each highlight.js token class, and the inset focus ring. Nothing in `apps/web` styles a colour.
- **New required prop:** `label: string`. It names the scroll region ("Result", "Metadata", "Request body"…), so the type checker forces every caller to name its block.
- **The `pre`:** while it overflows (`useScrollOverflow`, `utils/use-scroll-overflow.util.ts`: axe's own scroll comparison, re-measured on resize and on new `code`) it renders `tabIndex={0}`, `role="region"` and `aria-label={label}`; a block that fits is none of these, so short snippets add no tab stops or landmarks (code review). Callers make `label` distinct on its page (`${tool.name} parameters`, `Signature verification, TypeScript: example`). Its focus ring is `codeBlockRules`' `:focus-visible` rule, never an `sx` outline.
- **Callers that pass `label`:**
  - `JobDetail.view.tsx` (Result and Metadata);
  - `PreviewPane.component.tsx`;
  - `RegisterToolpackDialog.component.tsx`;
  - `ToolpackMetadataModal.component.tsx`;
  - `ConnectorInstance.view.tsx`.

### 3. Story fixes

The FAQList and GlossaryList stories (`apps/web/src/stories/` or the components' story files) pass `expandedSlugs` (`new Set()` or a seeded set) and `onToggle`, so all 5 render.

### 4. Lint gate

- **`apps/web/eslint.config.js` and `packages/core/eslint.config.js`** append one block, moved verbatim from the deleted a11y configs:
  - `files: ["src/**/*.tsx"]`;
  - the same `ignores` (tests, stories);
  - `plugins: { "jsx-a11y": jsxA11y }`;
  - `jsxA11y.flatConfigs.strict.rules`. Web adds the `no-noninteractive-element-interactions` `form: ["onKeyDown"]` override, and `no-noninteractive-tabindex` with `roles: ["tabpanel", "region"]` (a scrollable region needs a tab stop, WCAG 2.1.1 and axe's `scrollable-region-focusable`; `HighlightedCode` is the case); core has no override.
  - `settings["jsx-a11y"] = { polymorphicPropName: "component", components: { Button: "button", IconButton: "button" } }`.
- **`apps/site/eslint.config.js`** spreads `...astro.configs["flat/jsx-a11y-strict"]` after `...astro.configs.recommended`.
- **Deleted:** `apps/web/eslint.a11y.config.js`, `packages/core/eslint.a11y.config.js`, `apps/site/eslint.a11y.config.js`.
- **`a11y:lint`** in each of the three packages becomes:
  ```
  sh -c 'eslint src --format json --output-file a11y-results/eslint.json; s=$?; [ $s -le 1 ]'
  ```
  It stays report-only, for the inventory. `lint` is the gate.
- **The inventory** (`scripts/a11y-inventory.mjs:556-566`) resolves its enabled-rule list from the same presets, so it is unchanged. Its header comment drops the `eslint.a11y.config.js` reference.

### 5. Story gate

`apps/web/src/__tests__/__a11y__/stories.a11y.tsx` and `packages/core/src/__tests__/__a11y__/stories.a11y.tsx` change as follows:
- **Web is sharded.** One test file took ~8 minutes in CI, so web's harness is `story-sweep.tsx`, which defines a shard. `stories-1…4.a11y.tsx` each sweep a round-robin quarter of the story files in parallel workers (`maxWorkers: "100%"`), and `gate-helpers.a11y.tsx` holds the helper fixtures plus a check that one file exists per shard. Each shard writes `a11y-results/stories.shard-<n>.json`; `jest.a11y.config.js`'s `globalSetup` (`scripts/a11y-stories.setup.mjs`) clears old results and its `globalTeardown` (`scripts/a11y-stories.teardown.mjs`) merges the shards into `stories.json`, sorted by file. Each shard gates its own runs, with `SKIPPED` filtered to its files. Core (17 seconds) stays one file.
- **Allowlist:** each package holds `const SKIPPED: Record<string, string> = {}`. The key is `"<repo file>#<story>"` and the value is the reason. It starts empty and only shrinks.
- **Results file:** written first, exactly as today.
- **Then, unless `process.env.A11Y_REPORT_ONLY === "1"`:**
  - one `expect({ violating, unlistedSkips, staleSkips })` against three empty lists, so a failing run lists every problem at once (separate asserts stopped at the first);
  - `violating`: each entry is `"<file>#<story>: <rule ids>"`;
  - `unlistedSkips`: each entry is `"<file>#<story>: <error>"`;
  - `staleSkips`: each `SKIPPED` key that didn't skip (it renders now, or is gone), so the allowlist can't rot.
- **Unchanged:** the existing `runs > 0` and `ok > 0` assertions stay.

Wiring:
- **Root `package.json`:** `a11y:report`'s story step becomes `A11Y_REPORT_ONLY=1 npm run a11y:stories -w @portalai/web -w @portalai/core`, using the env prefix the shell already supports in that npm script.
- **`turbo.json`:** a new `a11y:stories` task with `dependsOn: ["^build"]`, `cache: true` and no outputs, the same shape as `test:unit`, plus `env: ["A11Y_REPORT_ONLY"]` so a report-only pass is never restored for a gating run. Root `package.json` adds `"a11y:stories": "turbo run a11y:stories"`.
- **`.github/workflows/unit-test.yml`:** two steps before "Run unit tests":
  - `Check the a11y inventory script` → `npm run lint:a11y-inventory`;
  - `Run axe over every story` → `npm run a11y:stories`.

  `lint:ci-cache` rule 1 already holds: the job has the `TURBO_*` secrets.

### 6. Component-axe guard

- **New files:** `apps/web/src/__tests__/component-axe.guard.test.ts` and `packages/core/src/__tests__/component-axe.guard.test.ts`.
- **Exports** (unit-tested against fixtures):
  - `runsAxe(source: string): boolean`: comment-stripped `\bexpectNoAxeViolations\(`.
  - `pairedTests(componentPath: string, tests: string[]): string[]`:
    - web: `<Name>.test.tsx`, or `<Name>.<kind>.test.tsx` for the component's own kind (`component`, `view`, `layout`). A test inside `modules/<X>/` or `workflows/<X>/` pairs only with that folder's components, so RegionEditor's and RestApi's `ReviewStep` can't pass on each other's test (183 paired when written);
    - core: `<Name>.test.tsx` under `src/__tests__/ui/`.
- **What it scans:**
  - web: every `*.component.tsx` and `*.layout.tsx` under `src/`;
  - core: every `src/ui/**/*.tsx`, recursive so `searchable-select/` is covered (39 paired when written).
- **Per file:**
  - `if (path in AXE_EXEMPT) return;`
  - if it has paired tests, at least one of them runs axe.
- **Allowlist:** `const AXE_EXEMPT: Record<string, string> = {}`. It starts empty and only shrinks.
- **Floor:** the paired count must be ≥ 170 for web and ≥ 34 for core, so the guard can't pass vacuously.
- **R6:** `dialog-contract.guard.test.ts` keeps R6 (its dialog-specific "a test of its own that runs axe on the open dialog"). In web, `runsAxe`, `pairedTests` and `withoutComments` live in `src/__tests__/component-axe.util.ts`, imported by both guards so the two can't drift (a test file can't be imported without registering its tests twice). Core's guard keeps its own copies, since core has no R6.

### 7. Component tests

- **The assertion:** every paired test the guard lists gains at least one `await expectNoAxeViolations(container)` on the component's primary rendered state.
  - Web imports it from `test-utils`.
  - Core imports it from `__tests__/axe.util`.
- **When a test finds a violation,** the component is fixed in the same slice. A violation is never exempted for convenience. `AXE_EXEMPT` takes only a case jsdom can't render, with the reason.

### 8. `/smoke-walk`

`.claude/skills/smoke-walk/SKILL.md` gains a step between "Observe" and "Capture" in §3: **"Audit."**
- **How** (spiked live in slice 7: `addScriptTag({ path })` works, axe 4.14.0, and a planted unnamed button reported `button-name`): after observing, run `mcp__playwright__browser_run_code_unsafe`. It calls `page.addScriptTag({ path: "/workspace/node_modules/axe-core/axe.min.js" })`, then `page.evaluate(() => axe.run(document, { runOnly: { type: "tag", values: [...] } }))`.
- **The tags are listed verbatim** in the skill and must equal `AXE_TAGS` (`packages/e2e/src/lib/a11y-walk.ts`).
- **Classification:**
  - Any violation makes the step `mismatch`, and the report row names `rule · impact · first target`.
  - A step that can't be audited (a third-party page) stays as classified, with `axe: not run (<reason>)`.
- **Report format:** each `verified` row also carries `axe: 0`.

New test `packages/e2e/src/__tests__/smoke-walk-axe.test.ts`: the tag list in SKILL.md (between `<!-- axe-tags:start -->` / `<!-- axe-tags:end -->`) equals `AXE_TAGS`.

### 9. Docs

- **CLAUDE.md:**
  - **Accessibility Requirements:** the WCAG bullet now says the gates are on. It covers:
    - jsx-a11y strict in `lint`;
    - `a11y:stories` in Unit Tests;
    - the component-axe guard;
    - the walks, which are report-only by design.
  - **Dialog & Form Test Checklist:** the axe line references the guard.
  - **CI gating:** lists the new Unit Tests steps.
- **`packages/e2e/README.md`:** "until #799 turns them into gates" becomes "report-only by design".
- **`docs/A11Y_AUDIT.md`:** the preamble above the generated block states which tools gate.

## Migration
## Seed

None. There is no schema or seed change.

## TDD test plan

Run from each package with `npm run test:unit` (and `npm run a11y:stories` for §5). Never invoke jest directly.

### Core (`packages/core`)
- `src/__tests__/ui/theme-contrast.test.ts`: `palette.code`. Every token, plus `text`, is ≥ 4.5:1 on `code.background` in both themes; `background` is opaque. (12 tokens × 2 themes ≈ **24**.)
- `src/__tests__/component-axe.guard.test.ts`: self-tests for `runsAxe` (comment-stripped call / commented-out / absent) and `pairedTests` (≈ **5**), the floor (**1**), and the per-file `it.each` (~37 cases).
- About 25 `src/__tests__/ui/*.test.tsx` gain an axe assertion (each a case).

### Web (`apps/web`)
- `src/__tests__/HighlightedCode.test.tsx` (≈ **4**):
  - the `pre` is a region named by `label`;
  - it's focusable;
  - token spans take `palette.code` colours (light and dark);
  - axe is clean.
- `src/__tests__/JobDetail*.test.tsx` (≈ **1**): Result and Metadata regions are named.
- `src/__tests__/component-axe.guard.test.ts`: self-tests (≈ **6**, including `.layout.test.tsx` pairing), the floor (**1**), and the per-file `it.each` (~185 cases).
- `src/__tests__/dialog-contract.guard.test.ts`: R6 is unchanged in behaviour and imports the shared helpers.
- About 100 paired tests gain an axe assertion (each a case).
- `a11y:stories`: 306 renders, 0 skipped, 0 violations. Fixture checks inside the harness's pure helpers (≈ **3**: violating, unlisted skip, stale skip).

### Site (`apps/site`)
- `npm run lint` is clean with `flat/jsx-a11y-strict` on.
- No new unit test: the lint run is the check.

### e2e (`packages/e2e`)
- `src/__tests__/smoke-walk-axe.test.ts` (**1**).

### Lint (all three)
- A deliberate violation (`<div onClick>`) in a scratch file fails `npm run lint`. This is a smoke step, not a committed test.

**Totals ≈ 50 new self-test cases, ~225 guard cases, ~125 assertions added to existing tests.**

## Acceptance criteria

- [ ] `npm run lint` fails on a new jsx-a11y violation in web, core or site.
- [ ] A component's test file without `expectNoAxeViolations` fails Unit Tests (the component-axe guard).
- [ ] A new axe violation in any story, or a story that stops rendering, fails Unit Tests.
- [ ] `npm run a11y:report` still runs end to end and records without stopping on a finding.
- [ ] Job detail's Result and Metadata blocks are keyboard-reachable named regions, and every code token is AA in both themes.
- [ ] `/smoke-walk` marks a step `mismatch` when axe finds a violation on it.
- [ ] Static Checks and Unit Tests are green on the epic branch with every gate on, and a fresh `a11y:report` records zero findings.

## Risks & rollback

- **The backfill finds real violations.** About 125 newly asserted components may surface findings jsdom can see but the story sweep didn't render. They're fixed in the slice that adds the assertion, which may make the web backfill the largest slice. They're detected by that slice's test run.
- **Story time in CI.** About 480 renders run on each Unit Tests miss. This is mitigated by turbo caching per package. If it goes past ~5 minutes, shard by story directory. It's detected in the Unit Tests timing.
- **Strict jsx-a11y on test files.** The block's `ignores` keep tests and stories out, as today. A rule firing on `.storybook/` would show up at the lint slice.
- **Rollback.** Each gate is one commit and reverts independently: a lint block, a CI step, a guard file. The fail mode is closed. A failing gate blocks merge, and an allowlist entry needs a written reason.

## Files touched

- **New:**
  - `apps/web/src/__tests__/component-axe.guard.test.ts`
  - `packages/core/src/__tests__/component-axe.guard.test.ts`
  - `packages/e2e/src/__tests__/smoke-walk-axe.test.ts`
- **Deleted:**
  - `apps/web/eslint.a11y.config.js`
  - `packages/core/eslint.a11y.config.js`
  - `apps/site/eslint.a11y.config.js`
- **Edited, core:**
  - `packages/core/src/types/theme.ts`
  - `src/assets/themes/brand-theme.json`
  - `src/assets/themes/brand-theme-dark.json`
  - `src/__tests__/ui/theme-contrast.test.ts`
  - `eslint.config.js`
  - `package.json`
  - `src/__tests__/__a11y__/stories.a11y.tsx`
  - ~25 `src/__tests__/ui/*.test.tsx`
- **Edited, web:**
  - `HighlightedCode.component.tsx` and its 5 callers
  - `HighlightedCode.test.tsx`
  - the FAQList and GlossaryList stories
  - `eslint.config.js`
  - `package.json`
  - `src/__tests__/__a11y__/stories.a11y.tsx`
  - `dialog-contract.guard.test.ts`
  - ~100 component tests
- **Edited, site:** `eslint.config.js`, `package.json`.
- **Edited, repo:**
  - root `package.json`
  - `turbo.json`
  - `.github/workflows/unit-test.yml`
  - `scripts/a11y-inventory.mjs` (comment only)
  - `.claude/skills/smoke-walk/SKILL.md`
  - `CLAUDE.md`
  - `packages/e2e/README.md`
  - `docs/A11Y_AUDIT.md`

## Next step

`docs/A11Y_GATES.plan.md` sequences this into about 6 TDD slices on `feat/799-a11y-gates`:
1. The code palette, `HighlightedCode` and the story fixes.
2. The lint gate.
3. The story gate and its CI steps.
4. The component guard plus the core backfill.
5. The web backfill (possibly split by directory).
6. `/smoke-walk` axe and the docs.

Every gate turns on only after what it checks is already clean.
