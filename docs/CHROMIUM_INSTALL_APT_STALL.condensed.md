# Chromium install stalls on a slow apt mirror — Condensed design (#965)

**Issue:** [EnterpriseBT/portal-ai#965](https://github.com/EnterpriseBT/portal-ai/issues/965) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** CI's Chromium install runs `playwright install --with-deps chromium`. Because of `--with-deps`, every run calls `apt-get` against Ubuntu's Azure mirror. Chromium itself comes from the `actions/cache` hit, and `apt-get` has nothing to cache it. On `ubuntu-26.04` every library Chromium needs is already present, so all `apt-get` actually installs is 9 font packages (~22 MB). On 2026-11-04 the mirror served them at 46 kB/s, which stretched prod `verify-login` to 8m13s against a 15-minute job timeout. The fix drops `apt-get` from the CI install. It touches the CI composite action and one `packages/e2e` script.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Install script | `packages/e2e/package.json:17` (`playwright:install`) | `playwright install --with-deps chromium`. Its only caller is the action below. |
| CI browser action | `.github/actions/playwright-browsers/action.yml:16-24` | Caches `~/.cache/ms-playwright`, keyed on `ImageOS` and the Playwright version (#904), then runs the script on every run, even on a cache hit. |
| Callers | `deploy-dev.yml:704`, `deploy-prod.yml:684` (`verify-login`), `e2e-test.yml:90` | All three jobs run on `ubuntu-26.04`. |
| Devcontainer install | `Dockerfile:117` | `npx playwright@1.62.1 install --with-deps chromium`. It doesn't use the script and keeps `--with-deps`, because the base image lacks the libraries. Out of scope. |
| Visual assertions | none in `packages/e2e/src` (no `toHaveScreenshot` / `toMatchSnapshot`) | Missing CJK, Thai or unifont fonts can't change any assertion. |

## Decision — how CI gets Chromium's OS libraries

- **A. Keep `--with-deps` and bound the step with `timeout-minutes`.** Runs still pay the `apt-get` round-trip, and a slow mirror still turns the check red. It only fails sooner.
- **B. Cache the `.deb`s or `apt` state.** That means a second cache to key and invalidate, kept around to install fonts nothing needs.
- **C. Drop `--with-deps` in CI.** The libraries come from the pinned runner image.

**Decision: C.** CI calls a new `playwright:install:ci` script (`playwright install chromium`). The general `playwright:install` keeps `--with-deps` for hosts that lack the libraries. The `ubuntu-26.04` label pins the OS, but GitHub refreshes the image under it every week with no commit here, so a library can disappear without a reviewed change. The action therefore launches Chromium once right after installing it. A missing library then fails in that step, named as such, instead of showing up as a failed sign-in after a deploy. The install runs under `timeout 300`, because composite-action steps don't accept `timeout-minutes`. A timeout exit (124) prints an `::error::` naming the stall.

## Plan — one slice

**Files**
- Edit `packages/e2e/package.json`: add `playwright:install:ci` (`playwright install chromium`) and leave `playwright:install` unchanged.
- Edit `.github/actions/playwright-browsers/action.yml`:
  - Run `playwright:install:ci` under `timeout 300`, with an `::error::` on exit 124.
  - Add a **Check Chromium launches** step.
  - Add comments recording why.

**Tests.** No unit surface; the CI runs on the branch are the test.
- `npm run lint:ci-cache` must still pass, since it parses the workflows and actions.
- `npm run format:check` must pass for `package.json`.
- The branch push runs `E2E Tests`, which launches Chromium through the changed action. That is the real check that the image's libraries are enough.

## Smoke (manual, against CI)

1. Push the branch. In the `E2E Tests` run, open the **Playwright browsers → Install Chromium** log. Expected: no `Installing dependencies...` and no `Switching to root user`, and the step takes a few seconds.
2. In the same run, the specs launch Chromium and pass, with no `Host system is missing dependencies` error.
3. After merge, check the `deploy-dev` run's `verify-login`. Expected: the **Playwright browsers** step runs in under ~15s with no `apt` output, and **Verify login** is green.
4. On the next prod release, check that prod `verify-login`'s browser step also skips `apt`. This is observed when the release happens, not walked now.

## Out of scope

- The devcontainer `Dockerfile` install, which needs `--with-deps` on its base image.
- Raising `verify-login`'s 15-minute job timeout. With `apt-get` gone, the timeout isn't the problem.
- Other `apt`-dependent CI steps (none found in the three callers).
