/**
 * The Auth0 post-login sync webhook was removed in #577 (on-first-token
 * provisioning + the request-path per-login re-home replace it). This pins that
 * the route is gone so it can't quietly return.
 *
 * `jwtCheck` is mocked pass-through so the (now non-existent) path falls through
 * to the authenticated `/api` router and yields a clean 404 — an unmocked run
 * would surface as a 401 (auth) rather than a route-missing 404.
 */
import { jest, describe, it, expect } from "@jest/globals";
import type { Request, Response, NextFunction } from "express";
import request from "supertest";

jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { app } = await import("../../../app.js");

describe("Removed Auth0 sync webhook (#577)", () => {
  it("POST /api/webhooks/auth0/sync → 404 (route no longer exists)", async () => {
    const res = await request(app)
      .post("/api/webhooks/auth0/sync")
      .send({ user_id: "auth0|1" });
    expect(res.status).toBe(404);
  });

  it("POST /api/webhooks/stripe still exists (not 404)", async () => {
    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .send("{}");
    expect(res.status).not.toBe(404);
  });
});
