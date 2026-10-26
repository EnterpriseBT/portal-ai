/**
 * The Playwright config as a pure function of the target (#489), so the
 * deployed-target rules are unit-testable.
 *
 * A deployed run (the post-deploy login check) records no trace and writes no
 * HTML report: a trace captures typed values and request headers, which for a
 * deployed target means the QA password and a live token, and the failure
 * artifacts are uploaded to CI. Screenshots and video stay; the password
 * field renders masked.
 */

import type { PlaywrightTestConfig } from "@playwright/test";

import type { E2eTarget } from "./target.js";

/** Where `setup` saves the walk's session; `core-loop` loads it. Never under
 *  test-results/, which CI uploads. */
export const SESSION_STORAGE_STATE = "./.auth/ci.storageState.json";

export function buildConfig(target: E2eTarget): PlaywrightTestConfig {
  return {
    testDir: "./src",
    outputDir: `./test-results/${target.name}`,
    forbidOnly: !!process.env.CI,
    workers: 1,
    reporter: target.deployed
      ? [["list"]]
      : [
          ["list"],
          ["html", { open: "never", outputFolder: "playwright-report" }],
        ],
    use: {
      baseURL: target.baseUrl,
      trace: target.deployed ? "off" : "on-first-retry",
      screenshot: "only-on-failure",
      video: "retain-on-failure",
      headless: true,
    },
    projects: [
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
      {
        // Signs in itself, in a fresh context, against any target. A flake
        // here must be visible, so it never retries.
        name: "login",
        testMatch: /specs\/login\.spec\.ts$/,
        retries: 0,
      },
    ],
  };
}
