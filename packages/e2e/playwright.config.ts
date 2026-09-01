import { defineConfig } from "@playwright/test";

/**
 * Playwright harness for agent-guided browser sessions (#304).
 *
 * The agent drives the running dev stack through the Playwright MCP server
 * (see repo-root `.mcp.json`); this config is the shared source of truth for
 * baseURL, the reused auth `storageState`, and failure artifacts. Automated
 * `*.spec.ts` and the CI runner are deferred (a follow-up prod / app-dev
 * login-verification ticket) — `testDir` is empty by design for now, and
 * `test:unit` / `test:integration` are no-ops in this package's scripts.
 *
 * Browser lockstep: a Playwright launches only the browser revision it
 * bundles, and `@playwright/mcp` releases bundle Playwright alphas — so this
 * package's `@playwright/test` pin and the `.mcp.json` MCP pin can never share
 * one browser build. The devcontainer `Dockerfile` therefore bakes one build
 * per consumer, each installed via its own pin. Bumping `@playwright/test`
 * here or `@playwright/mcp` in `.mcp.json` means updating the matching
 * Dockerfile RUN line and rebuilding the container.
 */
export default defineConfig({
  testDir: "./src/specs",
  outputDir: "./test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    storageState: "./.auth/storageState.json",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    headless: true,
  },
});
