# Scheduled npm audit workflow — Condensed design (#545)

**Issue:** [EnterpriseBT/portal-ai#545](https://github.com/EnterpriseBT/portal-ai/issues/545) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The monorepo has one root `package-lock.json` and **no dependency-vulnerability scanning in CI** — `static-checks`, `unit-test`, `integration-test` cover build/lint/type/test only, and there is no Dependabot config. A newly-disclosed advisory against an already-merged dependency surfaces to nobody. This adds one self-contained GitHub Actions workflow (`.github/`) that runs `npm audit`, writes the result to the run's step summary, and is **always green** — visibility, never a gate. No application contract, no branch-protection change.

## Current shape

| Piece | Location | Note |
|---|---|---|
| CI workflows | `.github/workflows/{static-checks,unit-test,integration-test}.yml` | All trigger on `push: branches-ignore: [main]` + `workflow_call`; **none** use `pull_request` |
| Trigger + concurrency idiom | `static-checks.yml:14`, `:50` | Literal concurrency group (`"static-checks-…"`), `cancel-in-progress: true` |
| Composite setup | `.github/actions/setup/action.yml` | checkout + node 22 + `npm ci`; heavier than an audit needs |
| Required checks | `CLAUDE.md` → "CI gating" / "Branch protection" | Matched by **job name**; only `Unit Tests`/`Integration Tests`/`Static Checks` gate `main` |
| Cache guard | `scripts/check-ci-cache.mjs` (`npm run lint:ci-cache`) | Only constrains workflows that **run turbo**; this one doesn't, so it's out of scope of all five rules |
| Audit baseline | root `package-lock.json` | Today: 18 vulns (13 moderate / 3 high / 2 critical), all requiring breaking major upgrades — see Out of scope |

## Decision — trigger, never-fail, and lightness

- **Trigger:** `schedule` (weekly, `0 9 * * 1` — Mon 09:00 UTC) + `workflow_dispatch` + `push: branches-ignore: [main]`. The push trigger IS the "informational PR-time run" — it matches the house idiom and fires per branch commit, so no new `pull_request` event (nothing else uses one). `schedule` covers the default branch that `branches-ignore` excludes.
- **Never fail:** `npm audit` exits non-zero when it finds anything, so the step runs `|| true` (with `continue-on-error: true` as belt-and-braces). The severity counts + full table go to `$GITHUB_STEP_SUMMARY`; the check stays green even on critical findings. **Not** added to required checks — no `main` branch-protection change, so it can never wedge a PR.
- **Lightweight:** `npm audit --package-lock-only` reads the lockfile with no `npm ci` and no Turbo — so the job is checkout + `setup-node` (not the `./.github/actions/setup` composite, which installs everything) + audit. Fast, and independent of the remote-cache wiring.

## Plan — 1 slice

**Files**
- New `.github/workflows/npm-audit.yml`: `on:` = `schedule`/`workflow_dispatch`/`push: branches-ignore:[main]`; `concurrency:` literal group `npm-audit-${{ github.ref }}` + `cancel-in-progress: true`; one job `npm-audit` (name **not** a required check) — `actions/checkout@v4`, `actions/setup-node@v4` (node 22), then a step running `npm audit --package-lock-only` piped to a plain-text block plus a severity-count header appended to `$GITHUB_STEP_SUMMARY`, guarded so a non-zero exit never reds the run. Header comment records: why always-green, why not `pull_request`, why not a required check, why no Turbo env.

**Tests** — a workflow YAML has no jest surface. Validation is: (a) `node -e "require('js-yaml')…"` / `python3 -c 'import yaml,sys;yaml.safe_load(...)'` parses the file locally; (b) `npm run lint:ci-cache` still passes (proves the new file trips none of the five turbo-cache rules); (c) the live `workflow_dispatch` in Smoke is the real proof — a workflow can only be exercised once it's on a branch GitHub can see.

## Smoke (manual, against GitHub Actions)

1. Push `feat/npm-audit-workflow`. In the repo **Actions** tab, confirm an **npm audit** run appears for the push (the `branches-ignore:[main]` trigger).
2. Open that run → the `npm-audit` job → **Summary**: confirm it renders the severity counts (currently `13 moderate / 3 high / 2 critical`) and the advisory table.
3. Confirm the run/check is **green** despite the high+critical findings, and that it does **not** show up as a required check on any open PR.
4. Trigger it manually: **Actions → npm audit → Run workflow** (`workflow_dispatch`) on the branch; confirm the same green run + summary.
5. `npm run lint:ci-cache` locally → passes (new workflow trips no cache rule).

## Out of scope

- **Remediating the 18 findings** — every fix is a breaking major upgrade (astro 5→7, maplibre-gl 4→6, uuid 9→14, csv-parse 6→7, testcontainers 11→12) or a bogus downgrade npm suggests (drizzle-kit, storybook, exceljs). `npm audit fix` (non-breaking) resolves **zero**. These are triaged from the first report into their own validation-carrying upgrade tickets (confirmed on #545).
- Auto-filing/updating a GitHub issue on findings; failing the run or gating merges on any severity; Dependabot / automated bumps; per-package audit fan-out (one root lockfile is audited as a whole).
