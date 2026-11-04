/**
 * The Playwright config as a pure function of the target (#489), so the
 * artifact rules are unit-testable.
 *
 * A run whose artifacts can be published (any CI run: this repo is public, so
 * its workflow artifacts are downloadable by anyone; and any deployed target)
 * records nothing that holds a typed value:
 * - no trace: it captures typed values, DOM snapshots and request headers;
 * - no HTML report: its step titles read `Fill "<value>"`, the password
 *   included;
 * - no `error-context.md`: Playwright's failure snapshot of the page copies
 *   every input's value, a password field's too (`PLAYWRIGHT_NO_COPY_PROMPT`,
 *   set by playwright.config.ts).
 * - no video: it records every frame of the typing (#963).
 * Failure screenshots stay. A sign-in failure leaves the page on about:blank
 * first (`signIn`), since a password typed into the wrong field would show
 * on it in the clear.
 */

import type { PlaywrightTestConfig } from "@playwright/test";

import type { E2eTarget } from "./target.js";

/** Where `setup` saves the walk's session; `core-loop` loads it. Never under
 *  test-results/, which CI uploads. */
export const SESSION_STORAGE_STATE = "./.auth/ci.storageState.json";

/** The whole sign-in, Auth0 round trip included, fits well inside this; the
 *  default 30s could time a slow Auth0 out mid-form. `SIGN_IN_DEADLINE_MS`
 *  (sign-in.ts) must stay under it, so a hung sign-in blanks its page before
 *  the test timeout's screenshot (#963). */
const TEST_TIMEOUT_MS = 180_000;

/** Whether this run's artifacts may end up somewhere public. */
export function artifactsArePublishable(
  target: E2eTarget,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return target.deployed || !!env.CI;
}

export function buildConfig(
  target: E2eTarget,
  env: NodeJS.ProcessEnv = process.env
): PlaywrightTestConfig {
  const publishable = artifactsArePublishable(target, env);
  const login = {
    // Signs in itself, in a fresh context, against any target. A flake here
    // must be visible, so it never retries.
    name: "login",
    testMatch: /specs\/login\.spec\.ts$/,
    retries: 0,
  };
  return {
    testDir: "./src",
    outputDir: `./test-results/${target.name}`,
    forbidOnly: !!env.CI,
    workers: 1,
    timeout: TEST_TIMEOUT_MS,
    reporter: publishable
      ? [["list"]]
      : [
          ["list"],
          ["html", { open: "never", outputFolder: "playwright-report" }],
        ],
    use: {
      baseURL: target.baseUrl,
      trace: publishable ? "off" : "on-first-retry",
      screenshot: "only-on-failure",
      // A video holds every frame of the typing, a password typed into the
      // wrong field included (#963), so a publishable run records none.
      video: publishable ? "off" : "retain-on-failure",
      headless: true,
    },
    // A deployed target runs the login check alone: the other projects
    // create data, and only the ephemeral stack is theirs to write to.
    projects: target.deployed
      ? [login]
      : [
          {
            name: "setup",
            testMatch: /setup\/session\.setup\.ts$/,
            retries: 0,
          },
          {
            name: "core-loop",
            testMatch: /specs\/core-loop\.spec\.ts$/,
            dependencies: ["setup"],
            retries: 1,
            use: { storageState: SESSION_STORAGE_STATE },
          },
          login,
          {
            // The owner invites an admin and a member into the walk's org,
            // and each role's split is checked. An accepted invite can't be
            // replayed on the same database, so a retry would fail for the
            // wrong reason.
            name: "roles",
            testMatch: /specs\/roles\.spec\.ts$/,
            dependencies: ["setup"],
            retries: 0,
            use: { storageState: SESSION_STORAGE_STATE },
          },
          // The accessibility walks (#792): report-only, so they never fail
          // on a finding and never retry. `a11y` signs in per role from
          // .auth/<role>.storageState.json (npm run e2e:auth:all) against the
          // dev stack; `a11y-site` walks the built marketing site under
          // `astro preview`. CI's explicit --project list never names them.
          {
            name: "a11y",
            testMatch: /a11y\/app\.a11y\.ts$/,
            retries: 0,
          },
          {
            name: "a11y-site",
            testMatch: /a11y\/site\.a11y\.ts$/,
            retries: 0,
            use: { baseURL: env.E2E_SITE_BASE_URL || "http://localhost:3002" },
          },
        ],
  };
}
