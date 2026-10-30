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
import { jest } from "@jest/globals";

import {
  readRuntimeConfig,
  getRuntimeConfig,
  readAuth0Settings,
  resolveAuth0Settings,
  shouldShowQaLogin,
  resolveOidcSettings,
  RuntimeConfigError,
  readInstallBasemap,
  getInstallBasemap,
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
      qaConnection: "",
    });
  });

  it("#489 — maps VITE_AUTH0_QA_CONNECTION, trimmed", () => {
    expect(
      readAuth0Settings({ VITE_AUTH0_QA_CONNECTION: "  qa-users \n" })
        .qaConnection
    ).toBe("qa-users");
  });

  it("imports cleanly under jest (no import.meta.env) → empty strings", () => {
    // `import.meta.env` does not exist under jest; the wrapper must resolve to
    // empty fields rather than throwing on property access.
    expect(resolveAuth0Settings()).toEqual({
      domain: "",
      clientId: "",
      audience: "",
      qaConnection: "",
    });
  });
});

describe("shouldShowQaLogin (#489)", () => {
  const on = { isOidc: false, qaConnection: "qa-users", search: "?qa=1" };

  it("shows only when the build names a connection AND ?qa is present", () => {
    expect(shouldShowQaLogin(on)).toBe(true);
    expect(shouldShowQaLogin({ ...on, search: "?qa" })).toBe(true);
  });

  it("hides without a configured connection (every build that doesn't opt in)", () => {
    expect(shouldShowQaLogin({ ...on, qaConnection: "" })).toBe(false);
  });

  it("hides without ?qa, so normal users never see it", () => {
    expect(shouldShowQaLogin({ ...on, search: "" })).toBe(false);
    expect(shouldShowQaLogin({ ...on, search: "?e2e=1" })).toBe(false);
  });

  it("hides under residency OIDC, which has no Auth0 connection", () => {
    expect(shouldShowQaLogin({ ...on, isOidc: true })).toBe(false);
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

describe("readInstallBasemap (#910)", () => {
  const LIGHT = "https://tiles.internal/light.json";
  const DARK = "https://tiles.internal/dark.json";

  it("unset → default (SaaS CARTO), no problem", () => {
    expect(readInstallBasemap(undefined)).toEqual({
      basemap: { mode: "default" },
      problem: null,
    });
    expect(readInstallBasemap({ BASEMAP_MODE: "" }).basemap).toEqual({
      mode: "default",
    });
  });

  it("`default` → default, ignoring any URLs", () => {
    expect(
      readInstallBasemap({ BASEMAP_MODE: "default", BASEMAP_STYLE_URL: LIGHT })
    ).toEqual({ basemap: { mode: "default" }, problem: null });
  });

  it("`none` → none, no problem", () => {
    expect(readInstallBasemap({ BASEMAP_MODE: "none" })).toEqual({
      basemap: { mode: "none" },
      problem: null,
    });
  });

  it("valid `custom` → custom with the light URL, no dark, attribution read", () => {
    expect(
      readInstallBasemap({
        BASEMAP_MODE: "custom",
        BASEMAP_STYLE_URL: LIGHT,
        BASEMAP_ATTRIBUTION: "© Internal tiles",
      })
    ).toEqual({
      basemap: {
        mode: "custom",
        styleUrl: LIGHT,
        styleUrlDark: null,
        attribution: "© Internal tiles",
      },
      problem: null,
    });
  });

  it("`custom` with a valid dark URL keeps it", () => {
    const { basemap } = readInstallBasemap({
      BASEMAP_MODE: "custom",
      BASEMAP_STYLE_URL: LIGHT,
      BASEMAP_STYLE_URL_DARK: DARK,
    });
    expect(basemap).toEqual({
      mode: "custom",
      styleUrl: LIGHT,
      styleUrlDark: DARK,
      attribution: "",
    });
  });

  it("`custom` with an invalid dark URL drops only the dark URL, with a problem", () => {
    const result = readInstallBasemap({
      BASEMAP_MODE: "custom",
      BASEMAP_STYLE_URL: LIGHT,
      BASEMAP_STYLE_URL_DARK: "not a url",
    });
    expect(result.basemap).toEqual({
      mode: "custom",
      styleUrl: LIGHT,
      styleUrlDark: null,
      attribution: "",
    });
    expect(result.problem).toContain("BASEMAP_STYLE_URL_DARK");
  });

  it("`custom` without a style URL fails closed to none (never CARTO)", () => {
    const result = readInstallBasemap({ BASEMAP_MODE: "custom" });
    expect(result.basemap).toEqual({ mode: "none" });
    expect(result.problem).toContain("BASEMAP_STYLE_URL");
  });

  it.each([
    "javascript:alert(1)",
    "ftp://tiles.internal/style.json",
    "/tiles/style.json",
  ])(
    "`custom` with a non-absolute-http(s) URL %p fails closed to none",
    (url) => {
      const result = readInstallBasemap({
        BASEMAP_MODE: "custom",
        BASEMAP_STYLE_URL: url,
      });
      expect(result.basemap).toEqual({ mode: "none" });
      expect(result.problem).toContain("BASEMAP_STYLE_URL");
    }
  );

  it.each(["off", "None", "carto"])(
    "an unknown mode %p fails closed to none, naming the value",
    (mode) => {
      const result = readInstallBasemap({ BASEMAP_MODE: mode });
      expect(result.basemap).toEqual({ mode: "none" });
      expect(result.problem).toContain(mode);
    }
  );

  it("trims whitespace around every value", () => {
    expect(
      readInstallBasemap({
        BASEMAP_MODE: " custom ",
        BASEMAP_STYLE_URL: `  ${LIGHT}\n`,
        BASEMAP_STYLE_URL_DARK: ` ${DARK} `,
        BASEMAP_ATTRIBUTION: "  © Internal tiles ",
      })
    ).toEqual({
      basemap: {
        mode: "custom",
        styleUrl: LIGHT,
        styleUrlDark: DARK,
        attribution: "© Internal tiles",
      },
      problem: null,
    });
  });

  it("accepts an XYZ template (placeholders don't affect parsing)", () => {
    const xyz = "https://tiles.internal/{z}/{x}/{y}.png";
    expect(
      readInstallBasemap({ BASEMAP_MODE: "custom", BASEMAP_STYLE_URL: xyz })
        .basemap
    ).toMatchObject({ mode: "custom", styleUrl: xyz });
  });
});

describe("getInstallBasemap (#910)", () => {
  afterEach(() => {
    delete (window as { __RUNTIME_CONFIG__?: unknown }).__RUNTIME_CONFIG__;
    jest.restoreAllMocks();
  });

  it("reads window.__RUNTIME_CONFIG__ and warns once for a rejected config", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    (
      window as unknown as { __RUNTIME_CONFIG__: Record<string, string> }
    ).__RUNTIME_CONFIG__ = { BASEMAP_MODE: "bogus-910" };
    expect(getInstallBasemap()).toEqual({ mode: "none" });
    expect(getInstallBasemap()).toEqual({ mode: "none" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0])).toContain("bogus-910");
  });

  it("an absent global is the SaaS default, without a warning", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(getInstallBasemap()).toEqual({ mode: "default" });
    expect(warn).not.toHaveBeenCalled();
  });
});
