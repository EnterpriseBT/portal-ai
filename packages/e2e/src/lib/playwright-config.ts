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
 * Screenshots and video stay; a password field renders masked in both.
 */

import type { PlaywrightTestConfig } from "@playwright/test";

import type { E2eTarget } from "./target.js";

/** Where `setup` saves the walk's session; `core-loop` loads it. Never under
 *  test-results/, which CI uploads. */
export const SESSION_STORAGE_STATE = "./.auth/ci.storageState.json";

/** The whole sign-in, Auth0 round trip included, fits well inside this; the
 *  default 30s could time a slow Auth0 out mid-form. */
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
      video: "retain-on-failure",
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
        ],
  };
}
