import { jest, describe, it, expect } from "@jest/globals";

/**
 * Slice 1 (#577): SsoConfig parses the SSO/deploy env into a typed authority,
 * defaulting to today's Auth0 issuer so nothing changes until a customer
 * issuer is configured. Each case loads the module against a mocked
 * environment so we can vary SSO_ISSUERS / DEPLOY_MODE / claim env freely.
 */
async function loadSsoConfig(env: Record<string, unknown>) {
  jest.resetModules();
  jest.unstable_mockModule("../../environment.js", () => ({
    environment: env,
  }));
  const mod = await import("../../config/sso.config.js");
  return mod.SsoConfig;
}

const AUTH0 = {
  AUTH0_DOMAIN: "portalai.us.auth0.com",
  AUTH0_AUDIENCE: "https://api.portalai.io",
};

describe("SsoConfig.issuers", () => {
  it("derives the Auth0 issuer (trailing slash) when SSO_ISSUERS is unset", async () => {
    const SsoConfig = await loadSsoConfig({ ...AUTH0 });
    expect(SsoConfig.issuers()).toEqual([
      {
        issuer: "https://portalai.us.auth0.com/",
        audience: "https://api.portalai.io",
        alg: "RS256",
      },
    ]);
  });

  it("parses a multi-issuer JSON array", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ISSUERS: JSON.stringify([
        {
          issuer: "https://portalai.us.auth0.com/",
          audience: "a",
          alg: "RS256",
        },
        { issuer: "https://customer.okta.com/", audience: "b", alg: "ES256" },
      ]),
    });
    const issuers = SsoConfig.issuers();
    expect(issuers).toHaveLength(2);
    expect(issuers[1]).toEqual({
      issuer: "https://customer.okta.com/",
      audience: "b",
      alg: "ES256",
    });
  });

  it("defaults alg to RS256 when an entry omits it", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ISSUERS: JSON.stringify([
        { issuer: "https://customer.okta.com/", audience: "b" },
      ]),
    });
    expect(SsoConfig.issuers()[0].alg).toBe("RS256");
  });

  it("throws on malformed JSON", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ISSUERS: "{not json",
    });
    expect(() => SsoConfig.issuers()).toThrow(/SSO_ISSUERS/);
  });

  it("throws when an entry is missing audience", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ISSUERS: JSON.stringify([{ issuer: "https://customer.okta.com/" }]),
    });
    expect(() => SsoConfig.issuers()).toThrow(/audience/);
  });

  it("throws when SSO_ISSUERS is an empty array", async () => {
    const SsoConfig = await loadSsoConfig({ ...AUTH0, SSO_ISSUERS: "[]" });
    expect(() => SsoConfig.issuers()).toThrow(/non-empty/);
  });

  it("returns [] when neither SSO_ISSUERS nor AUTH0_* is set", async () => {
    const SsoConfig = await loadSsoConfig({});
    expect(SsoConfig.issuers()).toEqual([]);
  });
});

describe("SsoConfig.isConfigured", () => {
  it("is true with a derived Auth0 issuer", async () => {
    const SsoConfig = await loadSsoConfig({ ...AUTH0 });
    expect(SsoConfig.isConfigured()).toBe(true);
  });

  it("is false with no issuers and does not throw on malformed JSON", async () => {
    const empty = await loadSsoConfig({});
    expect(empty.isConfigured()).toBe(false);
    const bad = await loadSsoConfig({ SSO_ISSUERS: "{bad" });
    expect(bad.isConfigured()).toBe(false);
  });
});

describe("SsoConfig.issuers — residency (#616)", () => {
  it("returns the single customer OIDC issuer in residency mode", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      DEPLOY_MODE: "residency",
      OIDC_ISSUER: "https://idp.customer.com/",
      OIDC_AUDIENCE: "portalai",
    });
    expect(SsoConfig.issuers()).toEqual([
      {
        issuer: "https://idp.customer.com/",
        audience: "portalai",
        alg: "RS256",
      },
    ]);
  });
});

describe("SsoConfig.enterpriseConnections (#916)", () => {
  it.each([
    ["unset", undefined],
    ["blank", "   "],
    ["none", "none"],
  ])("is empty when %s", async (_label, value) => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ENTERPRISE_CONNECTIONS: value,
    });
    expect(SsoConfig.enterpriseConnections().size).toBe(0);
  });

  it("parses and trims a comma-separated list", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ENTERPRISE_CONNECTIONS: " acme-okta, globex ",
    });
    expect([...SsoConfig.enterpriseConnections()]).toEqual([
      "acme-okta",
      "globex",
    ]);
  });

  it("collapses duplicates", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ENTERPRISE_CONNECTIONS: "acme,acme",
    });
    expect([...SsoConfig.enterpriseConnections()]).toEqual(["acme"]);
  });

  it.each([
    ["an empty entry", "a,,b"],
    ["a trailing comma", "acme,"],
    ["a pipe", "bad|name"],
    ["a leading dash", "-lead"],
    ["a trailing dash", "trail-"],
    ["a name over 128 chars", "a".repeat(129)],
    ["none mixed with names", "none,acme"],
  ])("throws on %s", async (_label, value) => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ENTERPRISE_CONNECTIONS: value,
    });
    expect(() => SsoConfig.enterpriseConnections()).toThrow(
      /SSO_ENTERPRISE_CONNECTIONS/
    );
  });

  it("accepts a 128-char name", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ENTERPRISE_CONNECTIONS: "a".repeat(128),
    });
    expect(SsoConfig.enterpriseConnections().size).toBe(1);
  });

  it("is case-sensitive", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ENTERPRISE_CONNECTIONS: "Acme",
    });
    expect(SsoConfig.enterpriseConnections().has("acme")).toBe(false);
  });
});

describe("SsoConfig.connectionOf (#916)", () => {
  it("returns the connection segment of an enterprise sub", async () => {
    const SsoConfig = await loadSsoConfig({ ...AUTH0 });
    expect(SsoConfig.connectionOf("samlp|acme-okta|jo@acme.com")).toBe(
      "acme-okta"
    );
    expect(SsoConfig.connectionOf("oidc|c|a|b")).toBe("c");
  });

  it.each([
    ["a social sub", "google-oauth2|1"],
    ["a database sub", "auth0|x"],
    ["an empty connection segment", "a||b"],
    ["an empty string", ""],
    ["undefined", undefined],
    ["a non-string", 42],
  ])("is null for %s", async (_label, sub) => {
    const SsoConfig = await loadSsoConfig({ ...AUTH0 });
    expect(SsoConfig.connectionOf(sub)).toBeNull();
  });
});

describe("SsoConfig.provisioningFallback", () => {
  const ACME = "samlp|acme-okta|jo@acme.com";

  it("is join_single_org in residency, even through a listed connection", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      DEPLOY_MODE: "residency",
      SSO_ENTERPRISE_CONNECTIONS: "acme-okta",
    });
    expect(SsoConfig.provisioningFallback({ sub: ACME })).toBe(
      "join_single_org"
    );
  });

  it("is deny in saas through a listed connection", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ENTERPRISE_CONNECTIONS: "globex,acme-okta",
    });
    expect(SsoConfig.provisioningFallback({ sub: ACME })).toBe("deny");
  });

  it("is personal_org in saas through an unlisted connection", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ENTERPRISE_CONNECTIONS: "globex",
    });
    expect(SsoConfig.provisioningFallback({ sub: ACME })).toBe("personal_org");
  });

  it("is personal_org in saas for social and database logins", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ENTERPRISE_CONNECTIONS: "acme-okta",
    });
    expect(SsoConfig.provisioningFallback({ sub: "google-oauth2|1" })).toBe(
      "personal_org"
    );
    expect(SsoConfig.provisioningFallback({ sub: "auth0|x" })).toBe(
      "personal_org"
    );
  });

  it("is personal_org in saas when gating is off", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ENTERPRISE_CONNECTIONS: "none",
    });
    expect(SsoConfig.provisioningFallback({ sub: ACME })).toBe("personal_org");
  });

  it("is personal_org with no payload", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ENTERPRISE_CONNECTIONS: "acme-okta",
    });
    expect(SsoConfig.provisioningFallback(undefined)).toBe("personal_org");
  });
});
