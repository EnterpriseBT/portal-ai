import { jest, describe, it, expect } from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";

/**
 * Integration tests against the Express app to verify middleware, routing,
 * and error handling work together correctly.
 *
 * Note: Protected routes are excluded here because they require JWT
 * validation which is tested separately with mocked auth middleware.
 */

// Mock the auth middleware so the real app can be imported without JWT config
jest.unstable_mockModule("../../middleware/auth.middleware.js", () => ({
  jwtCheck: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { app } = await import("../../app.js");

describe("App Integration", () => {
  describe("Health endpoint", () => {
    it("should respond to GET /health with status 200", async () => {
      const res = await request(app).get("/api/health");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        payload: {
          sha: "local",
          version: "dev",
          timestamp: expect.any(String),
        },
      });
    });
  });

  describe("Unknown routes", () => {
    it("should return 404 for non-existent routes", async () => {
      const res = await request(app).get("/nonexistent");

      expect(res.status).toBe(404);
    });
  });

  describe("JSON parsing", () => {
    it("should accept requests with JSON content type", async () => {
      const res = await request(app)
        .get("/api/health")
        .set("Content-Type", "application/json");

      expect(res.status).toBe(200);
    });
  });
});
