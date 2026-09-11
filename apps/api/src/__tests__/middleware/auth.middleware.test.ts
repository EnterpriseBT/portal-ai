/**
 * resolveAuthConfig (#579) — the deploy-mode-selected JWT verification config.
 * saas returns today's exact Auth0 shape (the regression pin); residency
 * returns the customer's OIDC issuer/audience verbatim.
 */

import { describe, it, expect } from "@jest/globals";

import { resolveAuthConfig } from "../../middleware/auth.middleware.js";

const env = {
  AUTH0_AUDIENCE: "https://saas-api",
  AUTH0_DOMAIN: "tenant.us.auth0.com",
  OIDC_ISSUER: "https://idp.customer.example/",
  OIDC_AUDIENCE: "https://api.customer.example",
};

describe("resolveAuthConfig", () => {
  it("saas → Auth0 audience + https://<domain> issuer (today's literal)", () => {
    expect(resolveAuthConfig("saas", env)).toEqual({
      audience: "https://saas-api",
      issuerBaseURL: "https://tenant.us.auth0.com",
    });
  });

  it("residency → OIDC audience + issuer verbatim", () => {
    expect(resolveAuthConfig("residency", env)).toEqual({
      audience: "https://api.customer.example",
      issuerBaseURL: "https://idp.customer.example/",
    });
  });

  it("defaults to the saas shape from the real environment (test env)", () => {
    // Unset DEPLOY_MODE ⇒ saas ⇒ Auth0 config from the test setup env.
    const cfg = resolveAuthConfig();
    expect(cfg.issuerBaseURL).toBe("https://test.auth0.com");
    expect(cfg.audience).toBe("https://test-api");
  });
});
