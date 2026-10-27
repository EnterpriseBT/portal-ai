import { defineConfig } from "@playwright/test";

import {
  artifactsArePublishable,
  buildConfig,
} from "./src/lib/playwright-config.js";
import { resolveTarget } from "./src/lib/target.js";

/**
 * Playwright specs and the agent-guided harness (#304, #489).
 *
 * `E2E_TARGET` (default `local`) picks the stack; see src/lib/target.ts. The
 * projects (src/lib/playwright-config.ts): `setup` signs in once, `core-loop`
 * walks a freshly provisioned org through the app's core loop on the
 * ephemeral stack (`scripts/e2e-stack.sh`), and `login` signs in against any
 * target — the post-deploy check runs it alone against app-dev / prod.
 *
 * Browser lockstep: a Playwright launches only the browser revision it
 * bundles, and `@playwright/mcp` releases bundle Playwright alphas — so this
 * package's `@playwright/test` pin and the `.mcp.json` MCP pin can never share
 * one browser build. The devcontainer `Dockerfile` therefore bakes one build
 * per consumer, each installed via its own pin. Bumping `@playwright/test`
 * here or `@playwright/mcp` in `.mcp.json` means updating the matching
 * Dockerfile RUN line and rebuilding the container (CI installs the
 * `@playwright/test` browser itself, cached by version).
 */
const target = resolveTarget();
// Playwright's failure snapshot (`error-context.md`) copies every input's
// value, a password field's too, so a run whose artifacts may be published
// never writes one. Set here, before the workers fork, so they inherit it.
if (artifactsArePublishable(target))
  process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

export default defineConfig(buildConfig(target));
