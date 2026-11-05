# Accessibility tooling and audit inventory — Plan

**This plan implements the report-only accessibility tooling and the inventory it produces, test-first. The generator comes first, then the three tools from the cheapest up, then the real runs that fill `docs/A11Y_AUDIT.md`.**

Spec: `docs/A11Y_TOOLING_AUDIT.spec.md`. Discovery: `docs/A11Y_TOOLING_AUDIT.discovery.md`. Issue: #792 (epic #791). It builds on the shipped `@portalai/e2e` harness (#304/#489), which provides per-role `storageState`, `e2e:seed` and `buildConfig`.

There are seven slices. Each sits behind a green test suite and leaves the repo compilable, and each lands as **one commit on `feat/792-a11y-audit`** (PR #967 → `epic/a11y-conformance`).

Run checks from each package with the npm scripts. Never invoke jest, eslint or playwright directly (`feedback_use_npm_test_scripts`):

```bash
npm run lint:a11y-inventory                                  # root, slice 1+
cd packages/e2e && npm run test:unit                         # slices 4–5
cd apps/web && npm run test:unit -- --testPathPattern=axe    # slice 3
cd packages/core && npm run test:unit -- --testPathPattern=axe
```

Each slice follows the same loop:
1. Write the failing tests.
2. Make the smallest change that turns them green.
3. Run the focused tests.
4. At the boundary, run `npm run lint && npm run type-check && npm run format:check` in each touched package. For any slice that adds a dependency, also run the full root `npm run build` (the `core model change` memory: a per-package check misses web and site fixtures).
5. Move to the next slice.

**Sequencing rationale.** Each later slice needs the format or tool an earlier one produced:

| Slice | Why it sits here |
|---|---|
| **1. Generator and doc skeleton** | Pure Node with embedded fixtures. It fixes the raw and normalized formats that every tool slice writes to, so no later slice invents a format. |
| **2. jsx-a11y report** | The cheapest tool. Its JSON is ESLint's native format, which slice 1 already parses. |
| **3. jest-axe helper and stories sweep** | Needs only jsdom. It is the first writer of slice 1's `RawResultFile`. |
| **4. e2e libraries** | Manifest, state transforms and record trimming. Pure and unit-tested, with no browser. |
| **5. Playwright projects and specs** | Wires slice 4 into a browser. It is the first slice that needs a running stack, but only for its run-level check, not its unit tests. |
| **6. First full run and keyboard pass** | `a11y:report` end to end. Generates the inventory and adds the agent's keyboard findings. |
| **7. Screen-reader pass, issue slices and doc sync** | Needs your VoiceOver and NVDA walk. **The area children #793–#798 unblock when this slice merges into the epic.** |

No migration, seed or workflow change.

---

## Slice 1 — Inventory generator and `docs/A11Y_AUDIT.md` skeleton

**Files**

- New:
  - `scripts/a11y-inventory.mjs`: input reading, normalization, `JSX_A11Y_WCAG` (empty until slice 2 adds the rules), the owner table, dedupe, the marker rewrite and the `--self-test` fixtures.
  - `docs/A11Y_AUDIT.md`: purpose, how to regenerate, lifecycle, the Coverage heading, the start and end markers with an empty generated section, and the Keyboard pass and Screen-reader pass headings, with the six flows listed.
- Edit:
  - root `package.json`: `a11y:inventory` and `lint:a11y-inventory`.
  - `.gitignore`: `a11y-results/`.

**Steps**

1. **Tests.** Write the generator self-test cases from the spec (≈16), before the logic exists:
   - `wcag143`→`1.4.3`, and the Best-practice bucket;
   - owner precedence, rules 1–5 plus `unassigned`, and the route-owner fallback;
   - theme dedupe, with `color-contrast` kept per theme;
   - a marker rewrite that leaves the manual sections byte-identical;
   - exit 1 on a missing marker, a missing input, zero ok runs, and an unmapped jsx-a11y rule (the fixture uses a made-up rule name).

   `npm run lint:a11y-inventory` fails.
2. **Implement** the generator until the self-test is green.
3. Run the root checks: `lint:doc-pointers` (the new durable doc), plus lint and type-check.

**Done when:** `npm run lint:a11y-inventory` passes, and `npm run a11y:inventory` exits 1 naming the first missing result file, since there are no results yet. That is the designed behaviour.

**Risk:** the normalized `id` hash must be stable across runs, or the rows churn on every regeneration. The self-test asserts the same input gives the same id.

---

## Slice 2 — jsx-a11y report configs and `a11y:lint`

**Files**

- New: `{apps/web,packages/core,apps/site}/eslint.a11y.config.js`.
- Edit:
  - `{apps/web,packages/core,apps/site}/package.json`: the `eslint-plugin-jsx-a11y` devDependency and the `a11y:lint` script.
  - `scripts/a11y-inventory.mjs`: fill `JSX_A11Y_WCAG` with every rule in `flatConfigs.strict`, plus the Astro preset's rules once the `astro/` prefix is stripped.

**Steps**

1. **Tests.** Add a self-test case: every rule key the strict preset enables is present in `JSX_A11Y_WCAG`. It reads the installed plugin, so a plugin upgrade that adds a rule fails the self-test, not the report. It fails until the map is filled.
2. **Implement.**
   - Write the three configs and scripts. Confirm the Astro flat preset's export name against the installed eslint-plugin-astro (spec, Key decision 3 flag).
   - Fill in the map.
   - Run `a11y:lint` in each package. It writes `a11y-results/eslint.json` and exits 0 despite the findings.
   - Run each package's `lint` to prove it doesn't load the new config.
3. Run the boundary checks plus the full root `npm run build` (new dependency).

**Done when:** all three `a11y:lint` scripts write results, `lint` is unchanged and zero-warning, and the self-test is green.

**Risk:** ESLint exit 2 inside `sh -c`. To check it, temporarily point `--config` at a missing file, confirm the script goes red, then revert.

---

## Slice 3 — jest-axe helper and `a11y:stories`

**Files**

- New:
  - `packages/core/src/__tests__/axe.util.ts` and `axe.util.test.tsx`.
  - `{apps/web,packages/core}/jest.a11y.config.js`.
  - `{apps/web,packages/core}/src/__tests__/__a11y__/stories.a11y.tsx`.
- Edit:
  - `{apps/web,packages/core}/package.json`: `jest-axe` and `@types/jest-axe`, plus `a11y:stories`.
  - both `src/__tests__/setup.ts` files: register `toHaveNoViolations`.
  - `apps/web/src/__tests__/test-utils.tsx`: `JSDOM_DISABLED_AXE_RULES` and `expectNoAxeViolations`.
  - a web test for the helper, `apps/web/src/__tests__/test-utils.axe.test.tsx`.

**Steps**

1. **Tests** (spec web and core unit, ≈8):
   - a clean fragment passes;
   - a missing `alt` fails with `image-alt`;
   - a low-contrast fragment passes because the rule is disabled;
   - `disableRules` is honoured.

   They fail.
2. **Implement** the helper and the setup registration. Green.
3. **The sweep.**
   - Write `stories.a11y.tsx` and its config.
   - Run `npm run a11y:stories` in each package. It writes `a11y-results/stories.json`, with every story either `ok` or `skipped`, and at least one `ok`.
   - Run `npm run a11y:inventory`. It now gets past the stories inputs and exits 1 on the e2e files, as expected.
4. Run the boundary checks, the full `test:unit` in web and core (the setup change touches every suite), and the full build.

**Done when:** the helper tests pass, both sweeps write results, and no existing unit test changes outcome.

**Risk:** web preview's no-op `localStorage` and router decorator under jsdom. If `setProjectAnnotations(preview)` breaks the whole sweep rather than single stories, fall back to the package's own provider wrapper in the sweep, and record that in the file.

---

## Slice 4 — e2e manifest, state transforms and record trimming

**Files**

- New:
  - `packages/e2e/src/lib/a11y-routes.ts`, `a11y-states.ts` and `a11y-record.ts`.
  - `packages/e2e/src/fixtures/a11y-error.json` (captured from a real 500 envelope) and `a11y-running-job.json`.
  - `packages/e2e/src/__tests__/a11y-routes.test.ts`, `a11y-states.test.ts` and `a11y-record.test.ts`.

**Steps**

1. **Tests** (spec e2e unit, the manifest, states and record cases, ≈11):
   - manifest ↔ route-file coverage, and the signed-out list;
   - `SITE_PAGES` ↔ `apps/site/src/pages`;
   - unique ids;
   - locked states on exactly the four lock-alert views;
   - the empty and locked transforms;
   - fixture parsing against core's job schema;
   - the `html` field is trimmed.

   They fail.
2. **Implement** the three libraries and the fixtures. Green.
3. Boundary checks in `packages/e2e`.

**Done when:** the e2e unit suite is green, and nothing imports the libraries yet.

**Risk:** the route-coverage test reads `apps/web/src/routes` from the e2e package. Use a path relative to the repo root, as `target.ts` resolves its root, not a cross-package import.

---

## Slice 5 — Playwright `a11y` and `a11y-site` projects

**Files**

- New: `packages/e2e/src/a11y/app.a11y.ts` and `site.a11y.ts`.
- Edit:
  - `packages/e2e/src/lib/playwright-config.ts`: the two projects, local targets only.
  - `packages/e2e/src/__tests__/playwright-config.test.ts`.
  - `packages/e2e/package.json`: `@axe-core/playwright`, `a11y:axe` and `a11y:axe:site`.
  - `packages/e2e/README.md`: an "Accessibility audit" section covering preconditions (dev stack, `e2e:seed`, `e2e:auth:all`, `npm run -w @portalai/site build && npm run -w @portalai/site preview`), both scripts and the results location.

**Steps**

1. **Tests** (spec e2e unit, the config cases, ≈3): a local target has both projects; a deployed target has neither; `E2E_SITE_BASE_URL` overrides the site baseURL. They fail.
2. **Implement** the projects and both specs:
   - per-role contexts from `storageStatePath`;
   - a theme init script;
   - state interception from slice 4;
   - `drillFrom` id resolution;
   - `AxeBuilder.withTags`;
   - one `RawResultFile` written in `afterAll`.

   The config tests go green.
3. **Run-level check:**
   - Run `npm run a11y:axe` against the dev stack. Then run `npm run a11y:axe:site` against the site preview.
   - Confirm both write results with ok runs.
   - Confirm a removed `.auth/member.storageState.json` fails setup with the `e2e:auth:all` message.
4. Boundary checks, plus a check that `.github/workflows/e2e-test.yml` is unchanged.

**Done when:** both projects run locally and record, and CI's project list is untouched.

**Risk:**
- The `loading` state's held request can time out the test. Release it in a `finally`, after axe or after 10s.
- RegionEditor's drill needs a file-upload connector in the fixture org. When there isn't one, the run is `skipped` with the reason (spec).

---

## Slice 6 — First full `a11y:report` and the keyboard pass

**Files**

- Edit:
  - root `package.json`: `a11y:report`.
  - `docs/A11Y_AUDIT.md`: the generated section, the Coverage section (versions, runs, skipped runs and gaps), and the Keyboard pass findings (`KB-nn`).

**Steps**

1. **Tests.** There are no new automated cases. The gate is that `npm run a11y:report` exits 0, and that a rerun with no code change leaves `git diff docs/A11Y_AUDIT.md` empty, which proves the ids are stable.
2. **Run and inspect.**
   - Work down `unassigned` to zero, by extending the owner table (a code change with a self-test case for each new rule) or by giving a recorded reason.
   - Walk the six flows keyboard-only through Playwright MCP, as owner and as member, covering the checklist rows including 2.4.11, 2.5.7, 3.3.7 and 3.3.8.
   - Record each finding with its owner.
   - Add the D3 iframe content finding.
3. Run `lint:a11y-inventory`, `lint:doc-pointers` and the root lint.

**Done when:** the generated section is populated and deterministic, the keyboard findings are recorded, and every row has an owner or a reason.

**Risk:** the size of the findings. The doc may get long. If a per-owner table runs past about 200 rows, the generator groups identical `rule × location-pattern` rows. That would be a spec amendment, raised before it's done, not done quietly.

---

## Slice 7 — Screen-reader pass, issue slices and doc sync

**Files**

- Edit:
  - `docs/A11Y_AUDIT.md`: the Screen-reader pass script for each of the six flows (steps plus the expected announcement), written **first** and handed to you, then the `SR-nn` findings you report back.
  - `CLAUDE.md` → "Accessibility Requirements (apps/web)": a pointer to `npm run a11y:report` and `docs/A11Y_AUDIT.md`, and a note that a new component test can call `expectNoAxeViolations`.
  - `apps/web/README.md` testing section: the same pointer.
  - GitHub: the bodies of #793–#798 (`## Audit inventory (#792)`), and the Status row of parent #791 when the PR merges into the epic.

**Steps**

1. **Script first.** Commit the screen-reader script, and you walk it with VoiceOver + Safari and NVDA + Firefox.
2. **Record** your findings as `SR-nn` rows with owners, and rerun `a11y:inventory` so the summary counts include them.
3. **Issue slices.** For each of #793–#798, write the full body to a file, assert it is non-empty and changed, then `gh issue edit` (the issue-body guard).
4. Run the boundary checks: `lint:doc-pointers` and the permission-copy guards, which scan durable docs.

**Done when:** all six flows have both assistive-technology results, each area child carries its slice, and CLAUDE.md and the web README point at the tooling.

**Risk:** the slice depends on your walk, so it can wait on it. Slices 1–6 can be reviewed (`/code-review`, `/security-review`) while you walk.

---

## Sequence summary

| # | Lands | Gating check |
|---|---|---|
| 1 | generator, self-test, doc skeleton | `lint:a11y-inventory` green |
| 2 | jsx-a11y configs and `a11y:lint` ×3 | results written; `lint` unchanged |
| 3 | jest-axe helper and `a11y:stories` ×2 | helper tests; full `test:unit` unchanged |
| 4 | e2e manifest, states and record libraries | e2e `test:unit` green |
| 5 | Playwright `a11y` / `a11y-site` | config tests; local run records; workflow untouched |
| 6 | `a11y:report`, generated inventory, keyboard pass | report exits 0; rerun diff empty |
| 7 | screen-reader pass, issue slices, CLAUDE.md and README | both assistive technologies recorded; six issue bodies updated |

## Cross-slice notes

- **No CI result may change** (spec acceptance). No `.github/workflows/**` edit, and no `eslint.config.js` or `jest.config.js` edit, in any slice. Check `git diff epic/a11y-conformance --stat -- .github` at every boundary.
- **The two `setup.ts` edits (slice 3) touch every web and core suite.** That's the one slice where the full `test:unit` runs locally, not just the touched files.
- **Formats are owned by slice 1.** If a tool slice needs a field the raw or normalized format lacks, amend the spec and slice 1's self-test in that commit. Don't let the writer drift from the reader.
- **Dependency slices (2, 3, 5)** commit `package-lock.json` with the `package.json` change, and run the full root build before pushing.
- **Doc sync** is slice 5 (e2e README) and slice 7 (CLAUDE.md and the web README). `docs/A11Y_AUDIT.md` is the durable artifact, and #800 decides its fate at close-out.

## Next step

Implementation starts on `feat/792-a11y-audit` with slice 1, tests first, one commit per slice, once this plan is confirmed.
