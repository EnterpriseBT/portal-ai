/**
 * GET /api/connector-config (#580) — the runtime connector-config endpoint.
 *
 * The security-relevant property: it is **authenticated** (mounted on the
 * protected router), so an unauthenticated request is rejected — the public
 * browser identifiers are served only to signed-in users, not anonymous
 * callers. Auth is NOT mocked here so the real jwtCheck gate is exercised.
 * The payload logic (configured vs null) is unit-tested in
 * connector-config.service.test.ts.
 */

import { describe, it, expect } from "@jest/globals";
import request from "supertest";

const { app } = await import("../../../app.js");

describe("GET /api/connector-config", () => {
  it("rejects an unauthenticated request (401) — it is not a public endpoint", async () => {
    const res = await request(app).get("/api/connector-config");
    expect(res.status).toBe(401);
  });

  it("leaves /api/health (a genuinely public route) unaffected", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
  });
});
