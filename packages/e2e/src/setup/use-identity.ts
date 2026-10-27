/**
 * `e2e:use <owner|admin|member> [--env <local|app-dev|prod>]` (#620, #489):
 * make that identity's captured session the one the env's Playwright MCP
 * server loads, then restart the MCP session.
 */
import { useIdentity } from "../lib/use-identity.js";
import { resolveTarget } from "../lib/target.js";

const argv = process.argv.slice(2);
const envIdx = argv.indexOf("--env");
const envArg = envIdx >= 0 ? argv[envIdx + 1] : undefined;
const identity = argv.find(
  (a, i) => !a.startsWith("--") && (envIdx < 0 || i !== envIdx + 1)
);

try {
  if (!identity) {
    throw new Error(
      "usage: npm run --workspace @portalai/e2e e2e:use -- <owner|admin|member> [--env <local|app-dev|prod>]"
    );
  }
  const target = resolveTarget(
    envArg ? { ...process.env, E2E_TARGET: envArg } : process.env
  );
  useIdentity(target, identity);
  const server =
    target.name === "local" ? "playwright" : `playwright-${target.name}`;
  console.log(
    `active ${target.name} identity: ${identity.toLowerCase()} (restart the MCP session so ${server} loads it)`
  );
} catch (err) {
  console.error(
    `[e2e:use] ${err instanceof Error ? err.message : String(err)}`
  );
  process.exit(1);
}
