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

/** An SSO_ENTERPRISE_CONNECTIONS value (#916): JSON connections + domains. */
const connections = (
  ...entries: Array<{ connection: string; domains: string[] }>
) => JSON.stringify(entries);

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
    expect(SsoConfig.enterpriseDomains().size).toBe(0);
  });

  it("parses connections and their domains", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ENTERPRISE_CONNECTIONS: connections(
        { connection: "acme-okta", domains: ["acme.com", "acme.co.uk"] },
        { connection: "globex", domains: ["globex.io"] }
      ),
    });
    expect([...SsoConfig.enterpriseConnections()]).toEqual([
      "acme-okta",
      "globex",
    ]);
    expect([...SsoConfig.enterpriseDomains()]).toEqual([
      ["acme.com", "acme-okta"],
      ["acme.co.uk", "acme-okta"],
      ["globex.io", "globex"],
    ]);
  });

  it("is case-sensitive on connection names", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ENTERPRISE_CONNECTIONS: connections({
        connection: "Acme",
        domains: ["acme.com"],
      }),
    });
    expect(SsoConfig.enterpriseConnections().has("acme")).toBe(false);
  });

  it.each([
    ["malformed JSON", "[{"],
    ["a non-array", JSON.stringify({ connection: "acme" })],
    ["an empty array", "[]"],
    ["a comma list", "acme-okta,globex"],
    [
      "an invalid connection name",
      connections({ connection: "bad|name", domains: ["acme.com"] }),
    ],
    [
      "a connection named none",
      connections({ connection: "none", domains: ["acme.com"] }),
    ],
    [
      "a name over 128 chars",
      connections({ connection: "a".repeat(129), domains: ["acme.com"] }),
    ],
    ["empty domains", connections({ connection: "acme", domains: [] })],
    [
      "an invalid domain",
      connections({ connection: "acme", domains: ["not a domain"] }),
    ],
    [
      "an uppercase domain",
      connections({ connection: "acme", domains: ["Acme.com"] }),
    ],
    [
      "a domain listed twice",
      connections(
        { connection: "acme", domains: ["acme.com"] },
        { connection: "globex", domains: ["acme.com"] }
      ),
    ],
    [
      "a connection listed twice",
      connections(
        { connection: "acme", domains: ["acme.com"] },
        { connection: "acme", domains: ["acme.co.uk"] }
      ),
    ],
    [
      "an unknown key",
      JSON.stringify([
        { connection: "acme", domains: ["acme.com"], gated: true },
      ]),
    ],
  ])("throws on %s", async (_label, value) => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ENTERPRISE_CONNECTIONS: value,
    });
    expect(() => SsoConfig.enterpriseConnections()).toThrow(
      /SSO_ENTERPRISE_CONNECTIONS/
    );
  });
});

describe("SsoConfig.connectionForEmail (#916)", () => {
  const ACME = connections({ connection: "acme-okta", domains: ["acme.com"] });

  it("maps an email's domain to its connection, case-insensitively", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ENTERPRISE_CONNECTIONS: ACME,
    });
    expect(SsoConfig.connectionForEmail("jo@acme.com")).toBe("acme-okta");
    expect(SsoConfig.connectionForEmail("Jo@ACME.com")).toBe("acme-okta");
  });

  it("is null for an unlisted domain or a subdomain", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ENTERPRISE_CONNECTIONS: ACME,
    });
    expect(SsoConfig.connectionForEmail("jo@globex.io")).toBeNull();
    expect(SsoConfig.connectionForEmail("jo@eu.acme.com")).toBeNull();
  });

  it("is null for a string with no @", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ENTERPRISE_CONNECTIONS: ACME,
    });
    expect(SsoConfig.connectionForEmail("acme.com")).toBeNull();
  });

  it("is null in residency", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      DEPLOY_MODE: "residency",
      OIDC_ISSUER: "https://idp.example.com/",
      OIDC_AUDIENCE: "portalai",
      SSO_ENTERPRISE_CONNECTIONS: ACME,
    });
    expect(SsoConfig.connectionForEmail("jo@acme.com")).toBeNull();
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
      SSO_ENTERPRISE_CONNECTIONS: connections({
        connection: "acme-okta",
        domains: ["acme.com"],
      }),
    });
    expect(SsoConfig.provisioningFallback({ sub: ACME })).toBe(
      "join_single_org"
    );
  });

  it("is deny in saas through a listed connection", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ENTERPRISE_CONNECTIONS: connections(
        { connection: "globex", domains: ["globex.io"] },
        { connection: "acme-okta", domains: ["acme.com"] }
      ),
    });
    expect(SsoConfig.provisioningFallback({ sub: ACME })).toBe("deny");
  });

  it("is personal_org in saas through an unlisted connection", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ENTERPRISE_CONNECTIONS: connections({
        connection: "globex",
        domains: ["globex.io"],
      }),
    });
    expect(SsoConfig.provisioningFallback({ sub: ACME })).toBe("personal_org");
  });

  it("is personal_org in saas for social and database logins", async () => {
    const SsoConfig = await loadSsoConfig({
      ...AUTH0,
      SSO_ENTERPRISE_CONNECTIONS: connections({
        connection: "acme-okta",
        domains: ["acme.com"],
      }),
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
      SSO_ENTERPRISE_CONNECTIONS: connections({
        connection: "acme-okta",
        domains: ["acme.com"],
      }),
    });
    expect(SsoConfig.provisioningFallback(undefined)).toBe("personal_org");
  });
});
