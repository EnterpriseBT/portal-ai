/**
 * Runtime identity config accessor (#607).
 *
 * The SPA reads `window.__RUNTIME_CONFIG__` — injected by `config.js` at
 * container start (#566) — to decide, at runtime with no rebuild, whether it
 * authenticates against Auth0 (SaaS) or a generic OIDC issuer (residency).
 * The window global is mockable in jsdom; `import.meta.env` is Vite-only and
 * per-module, so the Auth0 (build-time) path is tested as the pure function it
 * is factored into, mirroring `contact.util` (#369).
 */
import {
  readRuntimeConfig,
  getRuntimeConfig,
  readAuth0Settings,
  resolveAuth0Settings,
  resolveOidcSettings,
  RuntimeConfigError,
} from "../utils/runtime-config.util";

const RESIDENCY = {
  AUTH_PROVIDER: "oidc",
  DEPLOY_MODE: "residency",
  OIDC_ISSUER: "https://id.customer.example",
  OIDC_CLIENT_ID: "portalai-web",
  OIDC_AUDIENCE: "https://api.customer.example",
};

describe("readRuntimeConfig (#607)", () => {
  it("case 1 — missing config → SaaS defaults", () => {
    expect(readRuntimeConfig(undefined)).toEqual({
      authProvider: "auth0",
      deployMode: "saas",
      oidcIssuer: "",
      oidcClientId: "",
      oidcAudience: "",
    });
  });

  it("case 2 — a full residency object is read through", () => {
    expect(readRuntimeConfig(RESIDENCY)).toEqual({
      authProvider: "oidc",
      deployMode: "residency",
      oidcIssuer: "https://id.customer.example",
      oidcClientId: "portalai-web",
      oidcAudience: "https://api.customer.example",
    });
  });

  it("case 3 — garbage authProvider / deployMode normalize to the SaaS defaults", () => {
    const cfg = readRuntimeConfig({
      AUTH_PROVIDER: "banana",
      DEPLOY_MODE: "weird",
    });
    expect(cfg.authProvider).toBe("auth0");
    expect(cfg.deployMode).toBe("saas");
  });

  it("case 6 — a stray secret key is ignored (no-secret)", () => {
    const cfg = readRuntimeConfig({
      ...RESIDENCY,
      OIDC_CLIENT_SECRET: "nope",
    } as Record<string, unknown>);
    expect(cfg).not.toHaveProperty("oidcClientSecret");
    expect(JSON.stringify(cfg)).not.toContain("nope");
  });
});

describe("getRuntimeConfig (#607)", () => {
  afterEach(() => {
    delete (window as { __RUNTIME_CONFIG__?: unknown }).__RUNTIME_CONFIG__;
  });

  it("reads window.__RUNTIME_CONFIG__ when present", () => {
    (
      window as unknown as { __RUNTIME_CONFIG__: Record<string, string> }
    ).__RUNTIME_CONFIG__ = RESIDENCY;
    expect(getRuntimeConfig().authProvider).toBe("oidc");
    expect(getRuntimeConfig().oidcIssuer).toBe("https://id.customer.example");
  });

  it("falls back to the SaaS defaults when the global is absent", () => {
    expect(getRuntimeConfig().authProvider).toBe("auth0");
    expect(getRuntimeConfig().deployMode).toBe("saas");
  });
});

describe("readAuth0Settings (#607)", () => {
  it("case 4 — maps VITE_AUTH0_* to the Auth0 provider settings", () => {
    expect(
      readAuth0Settings({
        VITE_AUTH0_DOMAIN: "portalai.us.auth0.com",
        VITE_AUTH0_CLIENT_ID: "abc123",
        VITE_AUTH0_AUDIENCE: "https://api.portalsai.io",
      })
    ).toEqual({
      domain: "portalai.us.auth0.com",
      clientId: "abc123",
      audience: "https://api.portalsai.io",
    });
  });

  it("imports cleanly under jest (no import.meta.env) → empty strings", () => {
    // `import.meta.env` does not exist under jest; the wrapper must resolve to
    // empty fields rather than throwing on property access.
    expect(resolveAuth0Settings()).toEqual({
      domain: "",
      clientId: "",
      audience: "",
    });
  });
});

describe("resolveOidcSettings (#607)", () => {
  it("returns the OIDC settings for a complete residency config", () => {
    expect(resolveOidcSettings(readRuntimeConfig(RESIDENCY))).toEqual({
      issuer: "https://id.customer.example",
      clientId: "portalai-web",
      audience: "https://api.customer.example",
    });
  });

  it("case 5 — throws RuntimeConfigError on a blank OIDC field under oidc (fail-closed)", () => {
    const cfg = readRuntimeConfig({ ...RESIDENCY, OIDC_ISSUER: "" });
    expect(() => resolveOidcSettings(cfg)).toThrow(RuntimeConfigError);
  });

  it("does not throw for an auth0 config with blank OIDC fields", () => {
    const cfg = readRuntimeConfig({ AUTH_PROVIDER: "auth0" });
    expect(() => resolveOidcSettings(cfg)).not.toThrow();
  });
});
