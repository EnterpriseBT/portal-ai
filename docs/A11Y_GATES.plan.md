# Accessibility gates in CI — Plan

> **Amendment (2026-11-13): axe now runs only in unit tests.** After implementation, the story sweep (`a11y:stories`) and the Playwright axe walks (`a11y:axe`, `a11y:axe:site`) proved slow and flaky, and the sweep's load crashed the dev container. They're removed, along with the `/smoke-walk` axe audit, the `a11y:report` inventory generator and `@axe-core/playwright`. Playwright itself stays: the E2E specs, `verify-login` and the agent sessions are unchanged. Two gates remain: jsx-a11y in `lint`, and the component-axe guards, which make every component test run `expectNoAxeViolations` in jsdom. `docs/A11Y_AUDIT.md` records the last automated run and keeps the hand-walked passes. Anything below about the sweep, the walks, the inventory or the `/smoke-walk` audit is superseded.

**This plan sequences #799 test-first.** It turns three in-repo accessibility checks into gates that fail CI:
- jsx-a11y in `lint`;
- axe over every story in Unit Tests;
- a guard that every paired component test runs axe.

`/smoke-walk` also gains a per-step axe audit. Each gate turns on only after what it checks is already clean.

Spec: `docs/A11Y_GATES.spec.md`. Discovery: `docs/A11Y_GATES.discovery.md`. Issue: #799 (epic #791). It builds on the six area children (#793–#798), all merged into `epic/a11y-conformance`: the latest full `a11y:report` is clean except the two job-detail rows slice 1 fixes.

Seven slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/799-a11y-gates`**: one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly, per `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit && npm run a11y:stories
cd apps/web && npm run test:unit -- --testPathPattern <file> && npm run a11y:stories
cd apps/site && npm run lint
cd packages/e2e && npm run test:unit
```

Each slice:
1. Write the failing tests.
2. Make the smallest change that turns them green.
3. Run the focused tests.
4. Run `npm run lint && npm run type-check` in each touched package.
5. Move to the next slice.

Locally, run only the touched test files. The full suite is CI's job.

**Sequencing rationale.** Fixes come before gates, and each gate's helpers live with the gate:
- **Slice 1:** the only open findings (job detail) and the 5 stories that fail to render. These are leaf fixes with no gate yet. Every later gate depends on this slice being clean.
- **Slice 2:** the lint gate. It's independent of the rest, and the latest results show 0 jsx-a11y findings in all three packages.
- **Slice 3:** the story gate, plus its two Unit Tests steps. It needs slice 1, or the 5 skips and the job-detail palette would fail it.
- **Slice 4:** the core component guard plus core's backfill. Core is small (~37 paired, ~25 to backfill), so its guard ships whole.
- **Slice 5:** web backfill, part one: `src/components/` (135 files, ~75 of them paired without axe). No guard yet; the added assertions are this slice's tests.
- **Slice 6:** web backfill, part two: `modules/`, `workflows/` and the layouts (~25). Then the web guard turns on, and R6 imports its helpers.
- **Slice 7:** the `/smoke-walk` axe step and the docs (CLAUDE.md, the e2e README, `docs/A11Y_AUDIT.md`).

**#800 unblocks after slice 7.**

There is no migration and no seed.

---

## Slice 1 — Code-token palette, `HighlightedCode`, story fixes

This clears the two job-detail rows (spec §1–§3) and the 5 story skips.

**Files**

- Edit: `packages/core/src/types/theme.ts`. Add `CodePalette` and the `Palette.code` / `PaletteOptions.code` augmentation.
- Edit: `packages/core/src/assets/themes/brand-theme.json` and `brand-theme-dark.json`. Add `palette.code`: opaque `background`, `text`, and 10 tokens.
- Edit: `packages/core/src/__tests__/ui/theme-contrast.test.ts`. Add a `palette.code` describe.
- Edit: `apps/web/src/components/HighlightedCode.component.tsx`:
  - drop `tokenColors` and `isDark`;
  - read `palette.code`;
  - add a required `label`;
  - make the `pre` `tabIndex={0}`, `role="region"`, `aria-label={label}`.
- Edit: the focus ring for the region, through `a11yComponents()` or the theme JSON (never an `sx` outline).
- Edit: the five callers, which pass `label`:
  - `JobDetail.view.tsx` (Result, Metadata);
  - `PreviewPane.component.tsx`;
  - `RegisterToolpackDialog.component.tsx`;
  - `ToolpackMetadataModal.component.tsx`;
  - `ConnectorInstance.view.tsx`.
- Edit: the FAQList and GlossaryList stories, which pass `expandedSlugs` and `onToggle`.
- Edit: `apps/web/src/__tests__/HighlightedCode.test.tsx` and the JobDetail test.

**Steps**

1. **Tests (spec TDD → Core `theme-contrast` ≈24; Web `HighlightedCode` ≈4; JobDetail ≈1).**
   - **Contrast:** every `palette.code` token and `text` is ≥ 4.5:1 on `code.background` in both themes, and `background` is opaque.
   - **Region:** the `pre` is `getByRole("region", { name: label })`, it's focusable, and token spans use the palette colours.
   - **axe:** `expectNoAxeViolations` is clean.
   - **Job detail:** the Result and Metadata regions are named.

   Run them and watch them fail.
2. **Implement** the palette, then the component, then the callers (tsc lists any caller missing `label`), then the stories. Turn the tests green.
3. **Rebuild core** (web reads core's `dist`), then run the focused web tests. Run `a11y:stories` in web and check for **0 skipped** and **0 violations**.
4. Run lint and type-check in core and web.

**Done when:**
- the contrast cases pass in both themes;
- `HighlightedCode`'s region tests pass;
- web's `a11y:stories` reports 306 ok, 0 skipped.

**Risk:**
- **Contrast tuning.** The dark hues already mostly pass, and the light `number`, `comment` and `literal` need darkening. Tune by the test, not by eye.
- **Visual change.** It's slight: the code background becomes an opaque palette colour instead of `action.hover`.

---

## Slice 2 — The lint gate

jsx-a11y strict joins each package's `lint` (spec §4).

**Files**

- Edit: `apps/web/eslint.config.js` and `packages/core/eslint.config.js`. Append the jsx-a11y block (rules, ignores, settings, and web's form `onKeyDown` override).
- Edit: `apps/site/eslint.config.js`. Spread `astro.configs["flat/jsx-a11y-strict"]`.
- Delete: the three `eslint.a11y.config.js`.
- Edit: `a11y:lint` in `apps/web`, `packages/core` and `apps/site` `package.json`, which drops `--config`.
- Edit: the `scripts/a11y-inventory.mjs` header comment.

**Steps**

1. **Test first.** Put `<div onClick={() => {}} />` in a scratch `src/__scratch__.tsx` (and a `<div onclick>` in a scratch `.astro` for site). Today, `npm run lint` passes on both. Run it and confirm.
2. **Implement** the config changes. `npm run lint` now fails on each scratch file. Delete the scratch files, and `npm run lint` is clean in all three packages.
3. Run `npm run a11y:lint` in each package, then `npm run lint:a11y-inventory`. The JSON is written, and the inventory self-test passes.
4. Type-check is untouched, and lint is the check.

**Done when:**
- `npm run lint` is green in web, core and site with jsx-a11y on;
- a scratch violation fails it;
- the a11y configs are gone.

**Risk:**
- **A rule fires where the report config didn't look.** The main configs lint more paths (web lints `.storybook/`). The block keeps `files: ["src/**/*.tsx"]` and the same `ignores`, so its scope is identical.

---

## Slice 3 — The story gate and its CI steps

`a11y:stories` fails by default on a violation, an unlisted skip or a stale `SKIPPED` entry (spec §5).

**Files**

- Edit: `apps/web/src/__tests__/__a11y__/stories.a11y.tsx` and `packages/core/src/__tests__/__a11y__/stories.a11y.tsx`:
  - add `SKIPPED` (empty);
  - add pure helpers `violatingRuns(runs)`, `unlistedSkips(runs, skipped)` and `staleSkips(runs, skipped)`;
  - assert all three are empty unless `A11Y_REPORT_ONLY=1`.
- Edit: `turbo.json`. Add an `a11y:stories` task (`dependsOn: ["^build"]`, `cache: true`).
- Edit: root `package.json`. Add `"a11y:stories": "turbo run a11y:stories"`, and set `A11Y_REPORT_ONLY=1` on `a11y:report`'s story step.
- Edit: `.github/workflows/unit-test.yml`. Add the `npm run lint:a11y-inventory` and `npm run a11y:stories` steps before "Run unit tests".

**Steps**

1. **Tests (spec TDD → Web `a11y:stories` fixtures ≈3).** Fixture runs for each helper: a violating run is listed, an unlisted skip is listed, and a `SKIPPED` key that rendered ok is stale.
   - The harness file is one jest test, so the fixture checks sit in a `describe` beside the sweep in the same `.a11y.tsx`. They only run under `a11y:stories`.
   - Run with a temporary violation (an unnamed `<button>` story) and see the gate fail.
2. **Implement** the helpers and the assertions. Remove the temporary story. Green in web and core.
3. **Check report mode.** `A11Y_REPORT_ONLY=1 npm run a11y:stories -w @portalai/web` passes with the temporary story present.
4. Run `npm run lint:ci-cache`. It's green, since the Unit Tests job already carries the `TURBO_*` secrets.

**Done when:**
- `npm run a11y:stories` fails on a planted violation and on a planted render error;
- it passes clean;
- report mode records without failing;
- Unit Tests runs both new steps.

**Risk:**
- **CI time.** About 480 renders run on a cache miss. This slice's push shows the Unit Tests timing. If the stories step passes ~5 minutes, split it by package into two steps (turbo already runs them in parallel).

---

## Slice 4 — Core component-axe guard and core backfill

Every core `src/ui/*.tsx` with a paired test runs axe (spec §6–§7, core).

**Files**

- New: `packages/core/src/__tests__/component-axe.guard.test.ts`, containing `runsAxe`, `pairedTests`, `AXE_EXEMPT` (empty), the floor (≥ 34) and the per-file `it.each`.
- Edit: about 25 `packages/core/src/__tests__/ui/*.test.tsx`, which add `await expectNoAxeViolations(container)` on the primary render.
- Edit: any core component a new assertion finds a violation in.

**Steps**

1. **Tests (spec TDD → Core guard ≈5 self-tests + floor + ~37 per-file).** Write the guard and run it. It fails, listing the ~25 files without axe.
2. **Backfill** each listed test, one file at a time. Run it, fix any component violation it surfaces, and repeat until the guard is green.
3. Run lint and type-check, then `npm run build` in core (web consumes `dist`).

**Done when:**
- the core guard is green with an empty `AXE_EXEMPT`;
- the floor holds.

**Risk:**
- **jsdom renders differently from stories.** A component may render differently in its test than in its story, which can surface new findings. Fix the component; an exemption takes only a case jsdom can't render, with its reason.

---

## Slice 5 — Web backfill: `src/components/`

This adds the axe assertion to every paired test of a `src/components/*.component.tsx` that lacks it (~75). There's no guard yet: these assertions are the slice's tests, and each one is red until any violation it finds is fixed.

**Files**

- Edit: the paired tests in `apps/web/src/__tests__/` (and `src/components/__tests__/`), which add `await expectNoAxeViolations(container)`. A dialog's test asserts on the open dialog (`await screen.findByRole("dialog")`), as R6 already requires.
- Edit: any component a new assertion finds a violation in.

**Steps**

1. **List the work.** Draft the web guard's scan as a local script to list the components paired without axe. It isn't committed until slice 6.
2. **Work through the list.** For each file, add the assertion and run it. If it's red, fix the component, then go green.
3. Run lint and type-check.

**Done when:** every `src/components/` paired test runs axe, and web `test:unit` is green.

**Risk:**
- **Size.** This is the largest slice by file count. If the fixes it surfaces are substantial, split it alphabetically into 5a and 5b; both still leave the tree green.

---

## Slice 6 — Web backfill: modules, workflows, layouts; web guard on

This finishes the web backfill and turns the guard on (spec §6–§7, web).

**Files**

- Edit: the paired tests under `src/modules/*/__tests__/`, `src/workflows/*/__tests__/` and the layout tests (~25).
- New: `apps/web/src/__tests__/component-axe.guard.test.ts`, containing `runsAxe`, `pairedTests` (with `.layout.test.tsx`), `AXE_EXEMPT` (empty), the floor (≥ 170) and the per-file `it.each`.
- Edit: `apps/web/src/__tests__/dialog-contract.guard.test.ts`. Its R6 imports `runsAxe` and `pairedTests` from the new guard, and its local copies are deleted.

**Steps**

1. **Tests (spec TDD → Web guard ≈6 self-tests + floor + ~185 per-file).** Write the guard. It fails, listing the remaining module, workflow and layout files.
2. **Backfill** them as in slice 5, fixing what each surfaces. Then move R6 onto the shared helpers and run the dialog guard, which stays green.
3. Run lint and type-check.

**Done when:**
- the web guard and R6 are green with empty allowlists;
- the floor holds.

**Risk:**
- **Pairing breaks a test name R6 matched.** The shared `pairedTests` adds `.layout.test.tsx`; R6 never scans layouts, so its result is unchanged. The dialog guard proves this.

---

## Slice 7 — `/smoke-walk` axe and the docs

**Files**

- Edit: `.claude/skills/smoke-walk/SKILL.md`. Add the §3 "Audit" step (`browser_run_code_unsafe` → `addScriptTag` axe-core → `axe.run` with the tags between the `axe-tags` markers), plus the `mismatch` rule and the report-row `axe:` field.
- New: `packages/e2e/src/__tests__/smoke-walk-axe.test.ts`, which checks the SKILL.md tags equal `AXE_TAGS`.
- Edit: `CLAUDE.md`:
  - Accessibility Requirements: the gates are on, and the walks are report-only by design;
  - Dialog & Form Test Checklist: the axe line names the guard;
  - CI gating: the two new Unit Tests steps.
- Edit: `packages/e2e/README.md`, where the walks become "report-only by design".
- Edit: `docs/A11Y_AUDIT.md`'s preamble, which names the tools that gate.

**Steps**

1. **Tests (spec TDD → e2e 1).** Write `smoke-walk-axe.test.ts`. It fails, because there are no markers yet.
2. **Implement** the skill step with the tags. Green.
3. **Spike the injection live:** one `browser_run_code_unsafe` call against `localhost:3000` returns axe results. If `addScriptTag({ path })` is refused, switch the skill to passing the file's source through `page.evaluate`, and record which form works.
4. Write the docs. Then run `npm run lint:doc-pointers`, plus `permission-copy` (the guard scans CLAUDE.md and the durable docs) through web's `test:unit` for that file.

**Done when:**
- the e2e test is green;
- one live audit returns results;
- CLAUDE.md, the README and the audit preamble describe the gates as they are.

**Risk:** none beyond the injection spike.

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | `palette.code`, `HighlightedCode` region, story fixes | theme-contrast, HighlightedCode tests, web `a11y:stories` 0 skipped |
| 2 | jsx-a11y in `lint` (web, core, site) | `npm run lint` fails on a scratch violation, clean without |
| 3 | story gate + Unit Tests steps | `a11y:stories` fails on a planted violation, passes clean |
| 4 | core guard + core backfill | core guard green, empty allowlist |
| 5 | web `components/` backfill | web `test:unit` green |
| 6 | web modules/workflows/layouts backfill + web guard + R6 on shared helpers | web guard and dialog guard green |
| 7 | `/smoke-walk` axe + docs | e2e test green, one live audit |

## Cross-slice notes

- **Core `dist`.** Web reads core's `dist`, so rebuild core after slices 1 and 4 before running web tests (memory: stale dep dist).
- **Run the full root build before pushing slice 1.** A new required prop (`label`) and a palette type ripple into typed fixtures that per-package type-check can miss.
- **Never exempt to make a slice green.** `AXE_EXEMPT` and `SKIPPED` start and end empty. A finding is fixed in the slice that surfaces it.
- **Prettier.** The pre-commit hook formats staged `src/**`. Markdown (`docs/`, the skill) isn't formatted.
- **Docs in the same PR.** Slice 7 carries CLAUDE.md, the e2e README and the audit preamble. The `a11y:report` command change (slice 3) is also documented there.
- **After slice 7,** regenerate `npm run a11y:report` (all report-only paths still work) as the smoke's last step. It should record zero findings.

## Next step

Implementation begins on `feat/799-a11y-gates` with slice 1, tests first and one commit per slice, once discovery, spec and plan are confirmed.
