/**
 * DEPLOY_MODE=residency route gating (#579).
 *
 * In residency the central-infra Stripe entitlement webhook must not be
 * exposed — the marketplace is the entitlement channel. This boots the real
 * app under residency env and asserts the Stripe webhook handler is gone:
 * POST /api/webhooks/stripe is no longer serviced by the (saas-only) handler.
 * The route is unregistered on webhookRouter, so the request falls through to
 * the `/api` protected router and gets **401** (unauthenticated) — as opposed
 * to the **400** the saas signature check returns (covered by the existing
 * billing / stripe-webhook integration suites in the default mode). The
 * 400→401 change is the gating proof; either way the Stripe handler never
 * runs. Auth is deliberately NOT mocked here so this reflects real behavior.
 *
 * Env is set BEFORE importing the app (route registration is module-load) and
 * restored in afterAll so DEPLOY_MODE doesn't leak into later suites.
 */

import { describe, it, expect, afterAll } from "@jest/globals";
import request from "supertest";

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

const { app } = await import("../../../app.js");

afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("DEPLOY_MODE=residency route gating", () => {
  it("no longer services the Stripe webhook (401 auth shadow, not the 400 saas signature check)", async () => {
    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("stripe-signature", "t=1,v1=x")
      .send({});
    // Route unregistered on webhookRouter → falls through to /api (jwtCheck)
    // → 401. In saas the same request is 400 from the Stripe handler.
    expect(res.status).toBe(401);
  });

  it("still serves GET /api/health", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
