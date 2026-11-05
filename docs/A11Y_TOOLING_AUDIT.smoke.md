# A11Y_TOOLING_AUDIT — Smoke Suite

Smoke test for [#792](https://github.com/EnterpriseBT/portal-ai/issues/792): the report-only accessibility tooling (jsx-a11y report, jest-axe stories sweep, axe walks of the app and the marketing site) and the generated inventory in `docs/A11Y_AUDIT.md`. **Branch under test:** `feat/792-a11y-audit` (PR [#967](https://github.com/EnterpriseBT/portal-ai/pull/967)).

Every section is independent after preflight. The change ships no app UI, so most steps run commands against the running stack and are tagged `— backend`. The untagged ones a browser session can check.

## Preflight

### Environment
- [ ] `git checkout feat/792-a11y-audit && git pull --ff-only && npm install`. No migration.
- [ ] `npm run dev` boots cleanly (web :3000, API :3001)
- [ ] The site is built and previewed on :3002: `npm run build -w @portalai/site && npm run preview -w @portalai/site`

### Fixtures
- [ ] The `e2e-fixture` org is demo-seeded (`npx portalai demo seed --org <id> --rows 2000 --env local --yes`)
- [ ] `npm run e2e:auth:all -w @portalai/e2e` has run, and each identity's active org is `e2e-fixture`

### Reset between runs
- [ ] `git checkout docs/A11Y_AUDIT.md`. The result files under `*/a11y-results/` are git-ignored and are simply overwritten.

## §1 — jsx-a11y report (`a11y:lint`)
- [ ] `npm run a11y:lint -w @portalai/web -w @portalai/core -w @portalai/site` exits 0 and writes `a11y-results/eslint.json` in each of the three packages, although findings exist. — backend
- [ ] `npm run lint` still passes with zero warnings in web, core and site: the strict jsx-a11y preset is never loaded by `lint`. — backend

## §2 — jest-axe stories sweep (`a11y:stories`)
- [ ] `npm run a11y:stories -w @portalai/web -w @portalai/core` exits 0 and writes `a11y-results/stories.json` in both. Expected: core 177 of 177 rendered; web 281 of 286, with the 5 FAQList/GlossaryList stories recorded as skipped with their reason. — backend
- [ ] `npm run test:unit -w @portalai/core -- --testPathPattern axe.util` and `npm run test:unit -w @portalai/web -- --testPathPattern test-utils.axe` pass: `expectNoAxeViolations` fails on a real violation and passes on clean markup. — backend
- [ ] `npm run test:unit -w @portalai/web` never runs the sweep (no `*.a11y.tsx` in its output). — backend

## §3 — Browser walks (`a11y:axe`, `a11y:axe:site`)
- [ ] `npm run a11y:axe -w @portalai/e2e` exits 0 and prints `N page state(s) checked, M skipped`. Expected: about 414 checked; every skip is a drill into a route with no data in the fixture org (entity-group, portal, portal-result, view detail). — backend
- [ ] `packages/e2e/a11y-results/app.json` holds runs for owner, admin and member (and `null` for the sign-in pages), in both `brand` and `brand.dark`, across populated, empty, error, loading and locked states. Node HTML is absent: only `target` selectors are recorded. — backend
- [ ] `npm run a11y:axe:site -w @portalai/e2e` exits 0 and writes `site.json` with 24 of 24 runs ok (12 pages × 2 themes). — backend
- [ ] `npx playwright test --list` in `packages/e2e` without `E2E_A11Y` lists no `a11y` or `a11y-site` project, so CI's E2E Tests never runs the walk. — backend

## §4 — Report and inventory (`a11y:report`)
- [ ] `npm run a11y:report` from the repo root runs all four steps and rewrites only the section between the `a11y-inventory` markers in `docs/A11Y_AUDIT.md`. — backend
- [ ] Running `npm run a11y:inventory` again on the same results leaves the doc byte-identical (`git diff --stat` shows nothing new). — backend
- [ ] `npm run lint:a11y-inventory` passes (35 self-test cases). — backend
- [ ] Open `docs/A11Y_AUDIT.md` on the PR's file view. The Coverage table lists all 7 result files with ok and skipped counts, and every skipped run is listed with its reason.
- [ ] Every row in the per-owner tables names a WCAG criterion (or sits under Best practice), an element, where it was seen, and the roles, states and themes. The Summary's **Unassigned** row reads 0 for automated rows.
- [ ] Each of #793–#798 has a section. #797 holds the shell rows (sidebar, header, landmarks), not #794.

## §5 — Keyboard and screen-reader passes
- [ ] The Keyboard pass table lists KB-01 to KB-10, each with a WCAG criterion and an owner from #793–#798. — manual
- [ ] The Screen-reader pass holds the script for the six flows, and its findings table records the VoiceOver and NVDA walk (findings owned, or a recorded "no findings" line). — manual

## §6 — Area children's slices
- [ ] Each of #793–#798's issue bodies carries its slice of the inventory (its rows plus its KB/SR findings), with a link back to `docs/A11Y_AUDIT.md`. — manual

## §7 — CI and docs unchanged elsewhere
- [ ] `git diff epic/a11y-conformance...HEAD --stat -- .github/` is empty: no workflow changes. — backend
- [ ] On PR #967, Static Checks, Unit Tests, Integration Tests and E2E Tests are green. — manual
- [ ] `CLAUDE.md` (Accessibility Requirements), `apps/web/README.md` (Accessibility testing) and `packages/e2e/README.md` (Accessibility audit) describe the commands above, including the active-org precondition. — backend

## Sign-off
- [ ] Every section above verified
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template
Section: · Expected: · Got: · Repro: · Identifiers (org/job/entity ids):
