# Accessibility gates in CI — Discovery

**Issue:** [EnterpriseBT/portal-ai#799](https://github.com/EnterpriseBT/portal-ai/issues/799) · Feature · `full`. Child of epic #791; branch `feat/799-a11y-gates` → `epic/a11y-conformance`.

**Why this exists.** Epic #791 audited the app and the marketing site with four report-only tools, and the six area children (#793–#798) fixed what they found. Each tool records findings into `docs/A11Y_AUDIT.md` and never fails. So nothing stops the next PR from bringing a finding back:
- jsx-a11y lint;
- axe over every story;
- the Playwright axe walk over the app;
- the same walk over the site.

#799 turns the in-repo tools into gates, with no baseline list: a finding is fixed or carries an in-file reason before its gate turns on. The gates are jsx-a11y in `lint`, axe over every story, and a guard that every component test runs the shared axe assertion. `/smoke-walk` also marks a step `mismatch` when axe finds something on it. The Playwright browser walks stay report-only for `a11y:report` (decided at discovery review): lint plus the jsdom axe gates are the enforcement, and colour contrast is held by `theme-contrast.test.ts`.

The latest full `a11y:report` (2026-11-13) is clean everywhere except two rows on the job detail page. They are fixed first. This is the ticket that makes the epic's result stick.

## The current shape

### The four tools today

| Tool | Script | Config / entry | Fails on | Latest |
|---|---|---|---|---|
| jsx-a11y lint | `a11y:lint` (web, core, site) | `apps/web/eslint.a11y.config.js:15-46`, `packages/core/eslint.a11y.config.js`, `apps/site/eslint.a11y.config.js` | exit ≥ 2 only (`[ $s -le 1 ]`, `apps/web/package.json:13`) | 0 findings (956 / 344 / 33 files) |
| Story axe | `a11y:stories` (web, core) | `jest.a11y.config.js` → `apps/web/src/__tests__/__a11y__/stories.a11y.tsx` | runs = 0 (`:169-170`) | web 301 ok / 5 skipped, core 177 ok, 0 violations |
| App walk | `a11y:axe` (`E2E_A11Y=1`, project `a11y`) | `packages/e2e/src/a11y/app.a11y.ts`, `src/lib/a11y-routes.ts`, `a11y-states.ts`, `a11y-walk.ts:22,75` | setup only: an expired session, a missing `.auth/<role>.storageState.json`, the wrong active org (`:178-197`), ok = 0 | 426 ok / 60 skipped; 2 rows (6 instances) on job-detail |
| Site walk | `a11y:axe:site` (project `a11y-site`) | `packages/e2e/src/a11y/site.a11y.ts`, `SITE_PAGES` | setup only | 24 ok, 0 findings |

- **Projects:** they exist only when `E2E_A11Y` is set and the target is local (`packages/e2e/src/lib/playwright-config.ts:104-121`).
- **Inventory:** `scripts/a11y-inventory.mjs` reads the seven result files (`:37-45`) and rewrites the generated block of `docs/A11Y_AUDIT.md` (`:48-49`, `replaceGenerated` `:543`).
  - It exits 1 only on a setup problem: a missing input, no ok run, an unmapped rule or bad markers. Never on a finding.
  - Its self-test (`lint:a11y-inventory`) runs in no workflow.

### Lint
- **The main configs have no jsx-a11y.**
  - Web and core (`apps/web/eslint.config.js`, `packages/core/eslint.config.js`) load js, typescript, react and react-hooks only.
  - Site's main config uses `astro.configs.recommended` (`apps/site/eslint.config.js:18`).
- **The a11y configs:**
  - Web and core spread the main config and add `jsxA11y.flatConfigs.strict.rules` on `src/**/*.tsx`, ignoring tests and stories.
  - Web overrides one rule: `no-noninteractive-element-interactions` also allows `form: ["onKeyDown"]`, for #789's Enter delegation (`:29-37`).
  - Settings: `polymorphicPropName: "component"`; `Button` and `IconButton` map to `button`.
  - Site uses `astro.configs["flat/jsx-a11y-strict"]`.
- **Ready to fold in:** each a11y config's header already says #799 folds it into `lint`. `lint` is already a zero-warning gate in Static Checks (`static-checks.yml:71-104`).

### Story axe
- **How it runs:**
  - The harness globs `*.stories.tsx`.
  - It renders through `test-utils`' providers (web; the Storybook preview's Auth0 throws in jsdom) or `setProjectAnnotations(preview)` (core).
  - It runs jest-axe and writes `a11y-results/stories.json` (`:150`).
- **Skips:** any load or render error is recorded `skipped` (`:106-113`, `:135-141`), and there is no allowlist.
- **The 5 web skips** are FAQList ×3 and GlossaryList ×2. Their stories never pass the required `expandedSlugs` set (`FAQList.component.tsx:19,53`, `GlossaryList.component.tsx:73,108`).
- **Not in `test:unit` today:** its `testMatch` (`src/__tests__/__a11y__/**/*.a11y.tsx`) is outside the main jest config, so Unit Tests never runs it.

### The component axe assertion
- **The helper:** `expectNoAxeViolations` lives at `apps/web/src/__tests__/test-utils.tsx:115`, mirrored at `packages/core/src/__tests__/axe.util.ts:17`. Both disable `color-contrast` and `region` (jsdom can't measure them).
- **Coverage today:**

| Package | Components | With a paired test | That test runs axe |
|---|---|---|---|
| web `*.component.tsx` | 211 | 183 | 83 |
| web `*.view.tsx` | 33 | 4 | 0 |
| core `src/ui/*.tsx` | 39 | 37 | 12 |

- **The model:** `dialog-contract.guard.test.ts` R6.
  - `runsAxe` (`:263`) is a comment-stripped regex.
  - `pairedTests` (`:268-281`) maps `Name.component.tsx` → `Name.test.tsx` / `.component.test.tsx` / `.view.test.tsx`.
  - `AXE_EXEMPT: Record<path, reason> = {}` only shrinks.
  - A floor of ≥ 55 paired files (`:574-578`) keeps it from passing vacuously.
  - It has fixture self-tests (`:489-510`).
- **Core:** it has no `*.component.tsx`; its components are `src/ui/<Name>.tsx`, tested at `src/__tests__/ui/<Name>.test.tsx`.

### CI constraints (`scripts/check-ci-cache.mjs:24-56`)
- **Required names:** exactly `Unit Tests`, `Integration Tests` and `Static Checks` (rule 3). A matrix's required name sits on a non-matrix summary job.
- **Concurrency groups** start with a literal (rule 4).
- **Turbo jobs** carry the three `TURBO_*` secrets (rule 1).
- **Site stays uncached** (rule 5).
- **Runners are pinned** (rule 7).

### `/smoke-walk`
- **No axe today:** `.claude/skills/smoke-walk/SKILL.md` never runs axe. It classifies steps `verified` / `mismatch` / `could-not-automate`, recording a mismatch and continuing (`:55`, `:87`).
- **No direct reuse:** `analyze()` (`a11y-walk.ts:75`) needs a Playwright `Page` through `@axe-core/playwright`, which the MCP walk doesn't expose.
- **What can be reused:** `AXE_TAGS` (`:22`) and `trimViolations` (`a11y-record.ts:58`).

### The two job-detail rows
- **Where:** `JobDetail.view.tsx:177-192` renders `HighlightedCode` (`components/HighlightedCode.component.tsx`) twice, for Result and Metadata.
- **Contrast:** token colours are hardcoded in an `sx` (`:101-125`). This also breaks the "styling lives in the theme" rule. The light `number` (`#098658`) fails contrast at 12px on `action.hover`.
- **Keyboard:** the `pre` scrolls (`overflow: auto`, `:129-143`) but has no `tabIndex`, role or name, which fails `scrollable-region-focusable` in both themes.
- **No prior pattern:** nothing else in web or core sets one up, so this sets the precedent.
- **Other callers inherit the fix:** `PreviewPane`, `RegisterToolpackDialog`, `ToolpackMetadataModal` and `ConnectorInstance.view`.

## The design space

### Decision 1 — Where jsx-a11y runs as a gate

- **A. Fold into each main config.** `lint` gains jsx-a11y strict (plus the one recorded override and the settings). `a11y:lint` keeps producing the inventory's JSON from a config that shares the same rule block.
- **B. A separate `a11y:lint` gate step** in Static Checks. Flip the script's exit rule, and keep two configs.
- **C. Fold the rules in and delete the a11y configs.** `a11y:lint` would then run the main config with a JSON formatter.

| | A | B | C |
|---|---|---|---|
| One `lint` fails on a new violation (acceptance) | Yes | No: `npm run lint` stays blind | Yes |
| Rule set can drift between gate and inventory | No (shared block) | Yes | No |
| Inventory sees only a11y rules | Yes | Yes | It must ignore every other rule (an unmapped rule exits 1) |

**Lean: A.** The acceptance criterion names `npm run lint`. Each package exports its jsx-a11y block once, and both configs spread it.

### Decision 2 — Story axe as a gate

- **A. Run `a11y:stories` as its own step in the Unit Tests job.** The harness fails on any violation, and on any skip that isn't in a `SKIPPED: Record<story, reason>` allowlist.
- **B. Fold the harness into `test:unit`'s jest config.** It joins every turbo `test:unit` run, local runs included.
- **C. Gate violations only.** Skips stay recorded.

| | A | B | C |
|---|---|---|---|
| Local `test:unit` time | Unchanged | +the story render pass | Unchanged |
| A story that stops rendering | Fails | Fails | Passes silently (a coverage hole) |
| Turbo caching | Its own task, cacheable | Same as unit | Same as A |

**Lean: A.** Add an `a11y:stories` turbo task (cacheable, with the TURBO secrets already in scope) and a Unit Tests step. A skip is a failure unless allowlisted with a reason. The five FAQList/GlossaryList stories get their `expandedSlugs`, so the allowlist starts empty. `lint:a11y-inventory` (the inventory's self-test) joins the same job.

### Decision 3 — What the component-test guard requires

- **A. Every paired test runs axe.** A component with a test file must call `expectNoAxeViolations`; a component without one isn't required to have one.
- **B. Every component has a test that runs axe.** That adds 28 web test files beyond A.
- **C. A, plus views and layouts.**

| | A | B | C |
|---|---|---|---|
| Matches the issue ("every component test file") | Yes | Goes further | Goes further |
| Test files to touch now | ~100 web + ~25 core | A + 28 new | A + views (most views are tested through containers) |
| Views covered by | the browser walk | the browser walk | jsdom too |

**Lean: A.** Extend R6's mechanics into a standalone `component-axe.guard.test.ts` in web (`*.component.tsx`, `*.layout.tsx`) and in core (`src/ui/*.tsx`). It keeps a floor, fixture self-tests and an `AXE_EXEMPT` that only shrinks.
- R6 then keeps only its dialog-specific half: an open dialog runs axe.
- Views stay with the browser walk, which already covers every route × role × state × theme.
- About 125 test files gain an assertion. The plan splits that across slices by package.

### Decision 4 — The browser walk (decided at review: stays report-only)

The Playwright walks (`a11y:axe`, `a11y:axe:site`) are **not** gated. Running the app walk in CI would need per-role sessions, a demo-seeded org and a ~26-minute run on live Auth0. jsx-a11y in `lint` plus the jsdom axe gates (stories and component tests) already fail a regression on a required check. What jsdom can't measure (colour contrast) is held by `theme-contrast.test.ts`, and the walk stays in `a11y:report` and the ACR's evidence.

### Decision 4b — axe inside `/smoke-walk`

- **A. Inject axe-core through the MCP's `browser_run_code_unsafe`.** Call `page.addScriptTag` with the installed `axe-core/axe.min.js`, then `axe.run` with `AXE_TAGS` after each step's observation.
- **B. A small e2e script (`a11y:check-url`).** The skill shells out with the step's URL and the role's session. It renders separately from the walk's page state, so it misses dialogs that are open.
- **C. Note axe in the evidence only.** A finding doesn't change the step's classification (this fails the deliverable).

**Lean: A.** It audits the exact page state the step left, open dialogs included. A finding marks the step `mismatch` with the rule, impact and target in the report. If the MCP sandbox can't load the file (it's a spike in the first walk slice), fall back to evaluating the axe source string.

## Tradeoff comparison

|  | D1: fold lint (A) | D2: stories step (A) | D3: paired tests (A) | D4: walk stays report-only | D4b: inject axe (A) |
|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes |
| New pattern | No | No | No (R6 generalised) | No | Yes (skill step) |
| Touches CI | Static Checks (via lint) | Unit Tests | Unit Tests | No | No |

## Recommendation

1. **Fix the job-detail rows first.**
   - Move `HighlightedCode`'s token palette into the theme (both theme JSONs, read through `theme.palette`), with every token meeting AA on `action.hover` in both themes. Add it to `theme-contrast.test.ts`.
   - Make the scrolling `pre` a named region: `tabIndex={0}`, `role="region"` and an `aria-label` the caller passes ("Result", "Metadata").
2. **Fix the five FAQList and GlossaryList stories** by giving them `expandedSlugs`.
3. **Lint gate.** Each package's main eslint config spreads one exported jsx-a11y strict block (web's form `onKeyDown` override and settings included; site through `astro` `flat/jsx-a11y-strict`). The a11y config spreads the same block for the inventory.
4. **Story gate.**
   - `stories.a11y.tsx` fails on any violation and on any skip not in `SKIPPED`, which starts empty.
   - The Unit Tests job runs `a11y:stories` and `lint:a11y-inventory`.
5. **Component-test guard.**
   - `component-axe.guard.test.ts` in web and core requires every paired component test to call the shared assertion.
   - Its `AXE_EXEMPT` (path → reason) starts empty and only shrinks.
   - R6 keeps only its dialog-open check.
6. **Browser walks stay report-only.** `a11y:axe` and `a11y:axe:site` keep feeding `a11y:report`; no workflow runs them.
7. **`/smoke-walk`.** After each step's observation it runs axe-core (with `AXE_TAGS`) in the walked page, and a violation marks the step `mismatch`.
8. **Docs.**
   - Rewrite CLAUDE.md's Accessibility Requirements and the Dialog & Form Test Checklist as the enforced convention.
   - Update the CI gating section (the new Unit Tests steps), the e2e README ("report-only until #799" becomes "report-only by design") and `docs/A11Y_AUDIT.md`'s preamble.

## Open questions

1. **Disabled rules.** jsdom tests disable `color-contrast` and `region`, and the browser walk that measures them isn't a gate. **Lean:** keep them disabled. Contrast is held by `theme-contrast.test.ts` over the palettes (and, after slice 1, the code-token palette); landmarks are owned by the layouts, which the shell's tests and the report-only walk cover.
2. **Where the guard's floor sits.** A floor keeps the guard from passing vacuously. **Lean:** set it a little under today's paired count (web ~180, core ~35), so deleting a batch of tests trips it while normal churn doesn't.

## Enterprise-scale considerations

- **Concurrency & correctness.** N/A because the gates are deterministic jsdom and lint runs with no shared state.
- **Accuracy & auditability.** `docs/A11Y_AUDIT.md` stays the record of what's out, regenerated by the report-only `a11y:report`. The ACR (#800) cites the gates and that report as its evidence.
- **Failure modes.** Lean: fail closed. A finding, an unexplained story skip or an unasserted component test is a red required check, and an allowlist entry needs a written reason.
- **Scale & unbounded growth.** The story pass grows with the story count (~480 renders today). Lean: it's its own cacheable turbo task, so an unchanged package restores from cache.
- **Multi-tenancy.** N/A because no runtime behaviour changes.
- **Contract stability.** N/A because there's no API or schema change.
- **Data lifecycle.** N/A because the result files are local and gitignored.

## What this doesn't decide

- **Manual screen-reader and keyboard walks.** They stay in each ticket's smoke (issue: out of scope).
- **The ACR's content.** That's #800, which describes the gated result.
- **Gating the browser walks** (app or site, local or deployed). Decided at review: they stay report-only.

## Next step

Write `docs/A11Y_GATES.spec.md` and `docs/A11Y_GATES.plan.md`. Each slice clears what it gates before the gate turns on, so no gate ever starts over a finding. A likely six slices:
1. The job-detail fixes plus the story fixes.
2. The lint gate.
3. The story gate.
4. The component guard plus web assertions.
5. Core assertions.
6. `/smoke-walk` axe plus the docs.
