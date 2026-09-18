import { jest, describe, it, expect } from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";

// Mock the auth middleware so the real app can be imported without JWT config
jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { app } = await import("../../../app.js");

describe("Security response headers (helmet)", () => {
  describe("global headers on an API (JSON) response", () => {
    it("sets HSTS, nosniff, frame protection and a CSP on GET /api/health", async () => {
      const res = await request(app).get("/api/health");

      expect(res.status).toBe(200);
      expect(res.headers["strict-transport-security"]).toMatch(/max-age=\d+/);
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBeDefined();
      expect(res.headers["content-security-policy"]).toBeDefined();
    });

    it("removes the X-Powered-By fingerprint", async () => {
      const res = await request(app).get("/api/health");

      expect(res.headers["x-powered-by"]).toBeUndefined();
    });

    it("sets Cross-Origin-Resource-Policy to cross-origin (the API is consumed cross-origin)", async () => {
      const res = await request(app).get("/api/health");

      expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    });
  });

  describe("CORS behavior stays intact", () => {
    it("still reflects the allowlisted origin and exposes the tile/ETag headers", async () => {
      const res = await request(app)
        .get("/api/health")
        .set("Origin", "http://localhost:3000");

      expect(res.headers["access-control-allow-origin"]).toBe(
        "http://localhost:3000"
      );
      // The security headers and CORS coexist on the same response.
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["access-control-expose-headers"]).toMatch(/ETag/);
    });
  });

  describe("Swagger UI keeps a CSP that allows its inline bundle", () => {
    it("serves /api/docs/ with a CSP permitting inline script/style", async () => {
      const res = await request(app).get("/api/docs/");

      expect(res.status).toBe(200);
      const csp = res.headers["content-security-policy"];
      expect(csp).toBeDefined();
      expect(csp).toContain("'unsafe-inline'");
    });
  });
});
