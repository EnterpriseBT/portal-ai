import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderConfigJs } from "../../scripts/render-config.mjs";

const BASEMAP_DEFAULTS = {
  BASEMAP_MODE: "default",
  BASEMAP_STYLE_URL: "",
  BASEMAP_STYLE_URL_DARK: "",
  BASEMAP_ATTRIBUTION: "",
};

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
      ...BASEMAP_DEFAULTS,
    });
  });

  it("falls back to the SaaS defaults when nothing is set", () => {
    expect(parseConfig(renderConfigJs({}))).toEqual({
      AUTH_PROVIDER: "auth0",
      OIDC_ISSUER: "",
      OIDC_CLIENT_ID: "",
      OIDC_AUDIENCE: "",
      DEPLOY_MODE: "saas",
      ...BASEMAP_DEFAULTS,
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

  describe("basemap keys (#910)", () => {
    it("defaults the basemap to SaaS CARTO (`default`) with empty URLs", () => {
      expect(parseConfig(renderConfigJs({}))).toMatchObject(BASEMAP_DEFAULTS);
    });

    it("passes the basemap values through unchanged", () => {
      const config = parseConfig(
        renderConfigJs({
          BASEMAP_MODE: "custom",
          BASEMAP_STYLE_URL: "https://tiles.internal/light.json",
          BASEMAP_STYLE_URL_DARK: "https://tiles.internal/dark.json",
          BASEMAP_ATTRIBUTION: "© Internal tiles",
        })
      );
      expect(config).toMatchObject({
        BASEMAP_MODE: "custom",
        BASEMAP_STYLE_URL: "https://tiles.internal/light.json",
        BASEMAP_STYLE_URL_DARK: "https://tiles.internal/dark.json",
        BASEMAP_ATTRIBUTION: "© Internal tiles",
      });
    });

    it("keeps the static SaaS public/config.js in step with the renderer", () => {
      const file = join(
        dirname(fileURLToPath(import.meta.url)),
        "../../public/config.js"
      );
      const shipped = parseConfig(readFileSync(file, "utf8"));
      const rendered = parseConfig(renderConfigJs({}));
      expect(Object.keys(shipped)).toEqual(Object.keys(rendered));
      expect(shipped).toEqual(rendered);
    });
  });
});
