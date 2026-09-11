/**
 * DEPLOY_MODE=residency route gating (#579).
 *
 * In residency the central-infra Stripe entitlement webhook must not be
 * exposed — the marketplace is the entitlement channel. This boots the real
 * app under residency env and asserts POST /api/webhooks/stripe is 404
 * (unregistered) while /api/health still serves. The saas case — the same
 * route routing to the signature check, not 404 — is covered by the existing
 * billing.router integration tests, which run in the default (saas) mode.
 *
 * Env is set BEFORE importing the app (route registration is module-load) and
 * restored in afterAll so DEPLOY_MODE doesn't leak into later suites.
 */

import { jest, describe, it, expect, afterAll } from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";

const saved = {
  DEPLOY_MODE: process.env.DEPLOY_MODE,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  OIDC_ISSUER: process.env.OIDC_ISSUER,
  OIDC_AUDIENCE: process.env.OIDC_AUDIENCE,
};

process.env.DEPLOY_MODE = "residency";
process.env.OIDC_ISSUER = "https://idp.customer.example";
process.env.OIDC_AUDIENCE = "https://api.customer.example";
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;

// Auth is irrelevant to health + the stripe webhook (both outside the
// protected router); mock it so no OIDC/JWKS setup is needed.
jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { app } = await import("../../../app.js");

afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("DEPLOY_MODE=residency route gating", () => {
  it("does not expose POST /api/webhooks/stripe (404)", async () => {
    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("stripe-signature", "t=1,v1=x")
      .send({});
    expect(res.status).toBe(404);
  });

  it("still serves GET /api/health", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
