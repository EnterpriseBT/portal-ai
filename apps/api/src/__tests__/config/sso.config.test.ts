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

describe("SsoConfig.deployMode", () => {
  it("defaults to saas", async () => {
    const SsoConfig = await loadSsoConfig({ ...AUTH0 });
    expect(SsoConfig.deployMode()).toBe("saas");
  });

  it("is self_hosted when DEPLOY_MODE=self_hosted", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      DEPLOY_MODE: "self_hosted",
    });
    expect(SsoConfig.deployMode()).toBe("self_hosted");
  });
});

describe("SsoConfig.enterpriseClaim", () => {
  it("is null when SSO_ENTERPRISE_CLAIM is unset", async () => {
    const SsoConfig = await loadSsoConfig({ ...AUTH0 });
    expect(SsoConfig.enterpriseClaim()).toBeNull();
  });

  it("returns name-only when no value is configured", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ENTERPRISE_CLAIM: "https://portalai.io/connection",
    });
    expect(SsoConfig.enterpriseClaim()).toEqual({
      name: "https://portalai.io/connection",
    });
  });

  it("returns name + value when both are configured", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ENTERPRISE_CLAIM: "https://portalai.io/connection",
      SSO_ENTERPRISE_CLAIM_VALUE: "acme-okta",
    });
    expect(SsoConfig.enterpriseClaim()).toEqual({
      name: "https://portalai.io/connection",
      value: "acme-okta",
    });
  });
});

describe("SsoConfig.provisioningFallback", () => {
  it("is join_single_org in self_hosted", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      DEPLOY_MODE: "self_hosted",
    });
    expect(SsoConfig.provisioningFallback({ iss: "x" })).toBe(
      "join_single_org"
    );
  });

  it("is personal_org in saas with no enterprise claim configured", async () => {
    const SsoConfig = await loadSsoConfig({ ...AUTH0 });
    expect(SsoConfig.provisioningFallback({ sub: "google|1" })).toBe(
      "personal_org"
    );
  });

  it("is deny in saas when the token carries the configured enterprise claim+value", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ENTERPRISE_CLAIM: "conn",
      SSO_ENTERPRISE_CLAIM_VALUE: "acme",
    });
    expect(SsoConfig.provisioningFallback({ conn: "acme" })).toBe("deny");
  });

  it("is personal_org in saas when the claim is configured but the token does not match", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ENTERPRISE_CLAIM: "conn",
      SSO_ENTERPRISE_CLAIM_VALUE: "acme",
    });
    expect(SsoConfig.provisioningFallback({ conn: "other" })).toBe(
      "personal_org"
    );
    expect(SsoConfig.provisioningFallback(undefined)).toBe("personal_org");
  });

  it("denies on claim presence alone when no value is configured", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ENTERPRISE_CLAIM: "conn",
    });
    expect(SsoConfig.provisioningFallback({ conn: "anything" })).toBe("deny");
    expect(SsoConfig.provisioningFallback({ sub: "x" })).toBe("personal_org");
  });
});
