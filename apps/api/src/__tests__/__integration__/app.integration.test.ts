import { jest, describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";

import { ApiCode } from "../../constants/api-codes.constants.js";
import { environment } from "../../environment.js";

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

  describe("Body-parser error mapping", () => {
    let originalLimit: number;
    beforeAll(() => {
      originalLimit = environment.REQUEST_JSON_LIMIT_BYTES;
    });
    afterAll(() => {
      environment.REQUEST_JSON_LIMIT_BYTES = originalLimit;
    });

    it("returns 413 with REQUEST_PAYLOAD_TOO_LARGE when the JSON body exceeds the limit", async () => {
      // The limit is captured at express.json() construction (app load), so a
      // big-enough payload always trips it regardless of runtime overrides.
      const limit = environment.REQUEST_JSON_LIMIT_BYTES;
      const oversized = { blob: "a".repeat(limit + 1024) };

      const res = await request(app)
        .post("/nonexistent")
        .set("Content-Type", "application/json")
        .send(oversized);

      expect(res.status).toBe(413);
      expect(res.body.code).toBe(ApiCode.REQUEST_PAYLOAD_TOO_LARGE);
    });

    it("returns 400 with REQUEST_BODY_INVALID_JSON for malformed JSON", async () => {
      const res = await request(app)
        .post("/nonexistent")
        .set("Content-Type", "application/json")
        .send("{not valid json");

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.REQUEST_BODY_INVALID_JSON);
    });
  });
});
