import { BUILTIN_ENVIRONMENTS } from "@portalai/cli-env";

import { CATALOG, lookupKey, pathFor, mask } from "../catalog.js";

const appDev = BUILTIN_ENVIRONMENTS["app-dev"];

describe("CATALOG (pin — mirrors api-cli.sh:77-98 + the #194 CLI client id)", () => {
  it("carries the exact managed keys", () => {
    const byKind = (k: string) =>
      CATALOG.filter((e) => e.kind === k)
        .map((e) => e.key)
        .sort();
    expect(byKind("secret")).toEqual([
      "ANTHROPIC_API_KEY",
      "AUTH0_WEBHOOK_SECRET",
      "DATABASE_URL",
      "ENCRYPTION_KEY",
      "GOOGLE_OAUTH_CLIENT_SECRET",
      "MICROSOFT_OAUTH_CLIENT_SECRET",
      "OAUTH_STATE_SECRET",
      "STRIPE_SECRET_KEY", // #218 tier apply
      "TAVILY_API_KEY",
    ]);
    expect(byKind("ssm")).toEqual([
      "AUTH0_AUDIENCE",
      "AUTH0_CLI_CLIENT_ID", // provisioned by #194; the bash predates it
      "AUTH0_DOMAIN",
      "CORS_ORIGIN",
      "GOOGLE_OAUTH_CLIENT_ID",
      "MICROSOFT_OAUTH_CLIENT_ID",
      "MICROSOFT_OAUTH_TENANT",
      "NAMESPACE",
      "SYSTEM_ID",
    ]);
    // every SSM entry declares a type
    for (const e of CATALOG.filter((e) => e.kind === "ssm")) {
      expect(e.ssmType).toBe("String");
    }
  });

  it("lookupKey resolves and typed-throws on unknown", () => {
    expect(lookupKey("DATABASE_URL")).toMatchObject({
      kind: "secret",
      name: "database-url",
    });
    expect(() => lookupKey("NOPE")).toThrow(/vars describe/);
    try {
      lookupKey("NOPE");
    } catch (e) {
      expect((e as { code: string }).code).toBe("ENV_NOT_CONFIGURED");
    }
  });

  it("pathFor uses the env's AWS prefixes", () => {
    expect(pathFor(appDev, lookupKey("DATABASE_URL"))).toBe(
      "portalai/dev/database-url"
    );
    expect(pathFor(appDev, lookupKey("AUTH0_DOMAIN"))).toBe(
      "/portalai/dev/auth0-domain"
    );
  });
});

describe("mask (verbatim bash rules)", () => {
  it("empty → (empty); short → ********; long → first4…last2 (len=N)", () => {
    expect(mask("")).toBe("(empty)");
    expect(mask("12345678")).toBe("********");
    expect(mask("tvly-abcdefgh1234")).toBe("tvly…34 (len=17)");
  });
});
