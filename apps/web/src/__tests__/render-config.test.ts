import { renderConfigJs } from "../../scripts/render-config.mjs";

/**
 * The runtime `config.js` shipped by the residency web image (#566). It is
 * rendered from container env at startup so one built image serves any
 * customer's OIDC issuer without a rebuild. Consumption by the SPA is #607 —
 * here we only pin the emitted contract.
 */
describe("renderConfigJs", () => {
  const parseConfig = (js: string): Record<string, unknown> => {
    const prefix = "window.__RUNTIME_CONFIG__ = ";
    expect(js.startsWith(prefix)).toBe(true);
    const body = js.slice(prefix.length).trim().replace(/;$/, "");
    return JSON.parse(body) as Record<string, unknown>;
  };

  it("emits the provided runtime values", () => {
    const js = renderConfigJs({
      AUTH_PROVIDER: "oidc",
      OIDC_ISSUER: "https://id.customer.example",
      OIDC_CLIENT_ID: "portalai-web",
      OIDC_AUDIENCE: "https://api.customer.example",
      DEPLOY_MODE: "residency",
    });

    expect(parseConfig(js)).toEqual({
      AUTH_PROVIDER: "oidc",
      OIDC_ISSUER: "https://id.customer.example",
      OIDC_CLIENT_ID: "portalai-web",
      OIDC_AUDIENCE: "https://api.customer.example",
      DEPLOY_MODE: "residency",
    });
  });

  it("falls back to the SaaS defaults when nothing is set", () => {
    expect(parseConfig(renderConfigJs({}))).toEqual({
      AUTH_PROVIDER: "auth0",
      OIDC_ISSUER: "",
      OIDC_CLIENT_ID: "",
      OIDC_AUDIENCE: "",
      DEPLOY_MODE: "saas",
    });
  });

  it("ignores unrelated env keys", () => {
    const config = parseConfig(
      renderConfigJs({ SOME_SECRET: "nope", DEPLOY_MODE: "residency" })
    );
    expect(config.SOME_SECRET).toBeUndefined();
    expect(config.DEPLOY_MODE).toBe("residency");
  });

  it("emits a single assignable statement ending in a semicolon", () => {
    const js = renderConfigJs({});
    expect(js.trim()).toMatch(/^window\.__RUNTIME_CONFIG__ = \{.*\};$/s);
    // Round-trips through JSON.parse — i.e. it is valid, serializable JS.
    expect(() => parseConfig(js)).not.toThrow();
  });
});
