/**
 * Switch the identity an env's Playwright MCP server signs in as (#620,
 * #489): copy that identity's captured state over the env's active one. The
 * server loads it at start, so the session restarts afterwards.
 */

import { chmodSync, copyFileSync, existsSync } from "node:fs";

import {
  activeStorageStatePath,
  E2eConfigError,
  normalizeIdentity,
  storageStatePath,
  type E2eTarget,
} from "./target.js";

/** Returns the active path it wrote. */
export function useIdentity(
  target: E2eTarget,
  identity: string,
  root: string = process.cwd()
): string {
  const name = normalizeIdentity(target, identity);
  const from = storageStatePath(target, name, root);
  if (!existsSync(from)) {
    const flags = [
      target.deployed ? `--env ${target.name}` : "",
      name === "owner" ? "" : `--identity ${name}`,
    ]
      .filter(Boolean)
      .join(" ");
    throw new E2eConfigError(
      `no ${name} session for ${target.name} yet: run ` +
        `npm run --workspace @portalai/e2e e2e:auth${flags ? ` -- ${flags}` : ""}`
    );
  }
  const to = activeStorageStatePath(target, root);
  copyFileSync(from, to);
  chmodSync(to, 0o600);
  return to;
}
