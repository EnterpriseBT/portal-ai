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
      "GITHUB_DISPATCH_TOKEN", // #311 API-side site-rebuild dispatch
      "GOOGLE_OAUTH_CLIENT_SECRET",
      "MICROSOFT_OAUTH_CLIENT_SECRET",
      "OAUTH_STATE_SECRET",
      "STRIPE_SECRET_KEY", // #218 tier apply
      "STRIPE_WEBHOOK_SECRET", // #239 webhook signature verification
      "TAVILY_API_KEY",
    ]);
    expect(byKind("ssm")).toEqual([
      "ADMIN_EMAIL", // #369 legal/DMARC contact
      "AUTH0_AUDIENCE",
      "AUTH0_CLI_CLIENT_ID", // provisioned by #194; the bash predates it
      "AUTH0_DOMAIN",
      "CORS_ORIGIN",
      "GOOGLE_OAUTH_CLIENT_ID",
      "MICROSOFT_OAUTH_CLIENT_ID",
      "MICROSOFT_OAUTH_TENANT",
      "NAMESPACE",
      "SALES_EMAIL", // #311 public site-config contact
      "SUPPORT_EMAIL", // #311 public site-config contact
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

  // #311: the marketing-site contact keys — SSM (plain config, not secret),
  // marked siteConfig so the post-write rebuild hook (slice 4) can key on it.
  it("SUPPORT_EMAIL / SALES_EMAIL are siteConfig-marked SSM entries (#311)", () => {
    expect(lookupKey("SUPPORT_EMAIL")).toMatchObject({
      kind: "ssm",
      name: "support-email",
      siteConfig: true,
    });
    expect(lookupKey("SALES_EMAIL")).toMatchObject({
      kind: "ssm",
      name: "sales-email",
      siteConfig: true,
    });
    expect(pathFor(appDev, lookupKey("SUPPORT_EMAIL"))).toBe(
      "/portalai/dev/support-email"
    );
    expect(pathFor(appDev, lookupKey("SALES_EMAIL"))).toBe(
      "/portalai/dev/sales-email"
    );
    // No other entry is siteConfig-marked (the hook must not over-fire).
    expect(CATALOG.filter((e) => e.siteConfig).map((e) => e.key)).toEqual([
      "SUPPORT_EMAIL",
      "SALES_EMAIL",
      "ADMIN_EMAIL",
    ]);
  });

  // #369: the legal / data-controller address. It renders on the site's terms
  // and privacy pages and is the DMARC `rua=` destination, so it is business
  // config on the same footing as the other two — same key set in every
  // environment, differing only in value (qa@ outside prod).
  it("ADMIN_EMAIL is a siteConfig-marked SSM entry (#369)", () => {
    expect(lookupKey("ADMIN_EMAIL")).toMatchObject({
      kind: "ssm",
      name: "admin-email",
      ssmType: "String",
      siteConfig: true,
    });
    expect(pathFor(appDev, lookupKey("ADMIN_EMAIL"))).toBe(
      "/portalai/dev/admin-email"
    );
  });

  it("STRIPE_WEBHOOK_SECRET is a Secrets Manager entry (#239)", () => {
    expect(lookupKey("STRIPE_WEBHOOK_SECRET")).toMatchObject({
      kind: "secret",
      name: "stripe-webhook-secret",
    });
    expect(pathFor(appDev, lookupKey("STRIPE_WEBHOOK_SECRET"))).toBe(
      "portalai/dev/stripe-webhook-secret"
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
