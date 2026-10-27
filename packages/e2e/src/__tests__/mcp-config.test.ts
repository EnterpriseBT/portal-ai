/**
 * Guard on the repo-root `.mcp.json` (#489). Every deployed env gets its own
 * Playwright MCP server, so a prod walk is named in every tool call
 * (`mcp__playwright-prod__*`) rather than implied by which state file was
 * copied last. Each one is in-memory, reads that env's own session, keeps
 * its artifacts under the git-ignored test-results/, and lists the origins
 * that env's app needs. `--allowed-origins` keeps a walk from wandering; it
 * is not the security boundary (it doesn't cover redirects). The boundary is
 * the QA identities' one membership, enforced by the API.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { BUILTIN_ENVIRONMENTS } from "@portalai/cli-env";

interface McpServer {
  command: string;
  args: string[];
}

const mcp = JSON.parse(
  readFileSync(path.join(process.cwd(), "../../.mcp.json"), "utf8")
) as { mcpServers: Record<string, McpServer> };

const DEPLOYED = ["app-dev", "prod"] as const;

/** Each env's Auth0 tenant: Universal Login runs there. */
const AUTH0_DOMAIN: Record<(typeof DEPLOYED)[number], string> = {
  "app-dev": "https://portalsai-staging.us.auth0.com",
  prod: "https://portalsai.us.auth0.com",
};

const flag = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

describe(".mcp.json", () => {
  it("leaves the local server as it was (#304)", () => {
    const args = mcp.mcpServers["playwright"].args;
    expect(flag(args, "--storage-state")).toBe(
      "packages/e2e/.auth/storageState.json"
    );
    expect(args).not.toContain("--allowed-origins");
  });

  it("has no Playwright server for an env it doesn't know", () => {
    const names = Object.keys(mcp.mcpServers).filter((n) =>
      n.startsWith("playwright")
    );
    expect(names.sort()).toEqual(
      ["playwright", ...DEPLOYED.map((e) => `playwright-${e}`)].sort()
    );
  });

  describe.each(DEPLOYED)("playwright-%s", (env) => {
    const server = mcp.mcpServers[`playwright-${env}`];
    const args = server?.args ?? [];
    const def = BUILTIN_ENVIRONMENTS[env];

    it("pins the same MCP release as the local server", () => {
      const pin = (a: string[]) =>
        a.find((x) => x.startsWith("@playwright/mcp@"));
      expect(pin(args)).toBe(pin(mcp.mcpServers["playwright"].args));
    });

    it("runs headless and in memory", () => {
      expect(args).toEqual(
        expect.arrayContaining(["--headless", "--isolated"])
      );
    });

    it("loads the env's own active session and writes under test-results/", () => {
      expect(flag(args, "--storage-state")).toBe(
        `packages/e2e/.auth/${env}/storageState.json`
      );
      expect(flag(args, "--output-dir")).toBe(
        `packages/e2e/test-results/${env}`
      );
    });

    it("allows only https origins, including the env's app, API and Auth0 tenant", () => {
      const origins = (flag(args, "--allowed-origins") ?? "").split(";");
      for (const o of origins) {
        expect(o).toMatch(/^https:\/\/[a-z0-9.-]+$/);
      }
      expect(origins).toEqual(
        expect.arrayContaining([
          new URL(def.webBaseUrl!).origin,
          new URL(def.apiBaseUrl).origin,
          AUTH0_DOMAIN[env],
        ])
      );
      // Never another env's app or tenant.
      for (const other of DEPLOYED.filter((e) => e !== env)) {
        expect(origins).not.toContain(
          new URL(BUILTIN_ENVIRONMENTS[other].webBaseUrl!).origin
        );
        expect(origins).not.toContain(AUTH0_DOMAIN[other]);
      }
    });
  });
});
