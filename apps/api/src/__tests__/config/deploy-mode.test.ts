/**
 * DEPLOY_MODE seam (#579) — the pure parse + consistency guard.
 *
 * `parseDeployMode` and `assertDeployModeConsistency` take their input
 * explicitly (injectable env) so the guard's contradiction matrix is unit-
 * tested without module-reload tricks. `isSaas`/`isResidency` read the real
 * `environment` (unset DEPLOY_MODE ⇒ saas in the test env).
 */

import { describe, it, expect } from "@jest/globals";

import {
  parseDeployMode,
  assertDeployModeConsistency,
  DeployModeConfigError,
  isSaas,
  isResidency,
} from "../../config/deploy-mode.js";

// A saas-valid env baseline; each residency case overrides from here.
const saasEnv = {
  DEPLOY_MODE: "saas",
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_x",
  OIDC_ISSUER: "",
  OIDC_AUDIENCE: "",
};

const residencyEnv = {
  DEPLOY_MODE: "residency",
  STRIPE_SECRET_KEY: undefined,
  STRIPE_WEBHOOK_SECRET: undefined,
  OIDC_ISSUER: "https://idp.customer.example",
  OIDC_AUDIENCE: "https://api.customer.example",
};

describe("parseDeployMode", () => {
  it("accepts the known modes", () => {
    expect(parseDeployMode("saas")).toBe("saas");
    expect(parseDeployMode("residency")).toBe("residency");
  });

  it("defaults empty/undefined to saas", () => {
    expect(parseDeployMode(undefined)).toBe("saas");
    expect(parseDeployMode("")).toBe("saas");
  });

  it("throws DeployModeConfigError on an unknown value", () => {
    expect(() => parseDeployMode("prod")).toThrow(DeployModeConfigError);
  });
});

describe("assertDeployModeConsistency", () => {
  it("passes for a saas-valid config (Stripe present, no OIDC)", () => {
    expect(() => assertDeployModeConsistency(saasEnv)).not.toThrow();
  });

  it("passes for a residency-valid config (OIDC set, no Stripe)", () => {
    expect(() => assertDeployModeConsistency(residencyEnv)).not.toThrow();
  });

  it("rejects residency carrying STRIPE_SECRET_KEY", () => {
    expect(() =>
      assertDeployModeConsistency({
        ...residencyEnv,
        STRIPE_SECRET_KEY: "sk_test_x",
      })
    ).toThrow(/Stripe/);
  });

  it("rejects residency carrying STRIPE_WEBHOOK_SECRET", () => {
    expect(() =>
      assertDeployModeConsistency({
        ...residencyEnv,
        STRIPE_WEBHOOK_SECRET: "whsec_x",
      })
    ).toThrow(/Stripe/);
  });

  it("rejects residency missing OIDC_ISSUER", () => {
    expect(() =>
      assertDeployModeConsistency({ ...residencyEnv, OIDC_ISSUER: "" })
    ).toThrow(/OIDC/);
  });

  it("rejects residency missing OIDC_AUDIENCE", () => {
    expect(() =>
      assertDeployModeConsistency({ ...residencyEnv, OIDC_AUDIENCE: "" })
    ).toThrow(/OIDC/);
  });

  it("lists every contradiction when several hold at once", () => {
    let message = "";
    try {
      assertDeployModeConsistency({
        ...residencyEnv,
        STRIPE_SECRET_KEY: "sk_test_x",
        OIDC_ISSUER: "",
      });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/Stripe/);
    expect(message).toMatch(/OIDC/);
  });

  it("throws on an unknown DEPLOY_MODE via parseDeployMode", () => {
    expect(() =>
      assertDeployModeConsistency({ ...saasEnv, DEPLOY_MODE: "prod" })
    ).toThrow(DeployModeConfigError);
  });
});

describe("isSaas / isResidency (default test env)", () => {
  it("defaults to saas when DEPLOY_MODE is unset", () => {
    expect(isSaas()).toBe(true);
    expect(isResidency()).toBe(false);
  });
});
