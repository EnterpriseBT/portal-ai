import { jest, describe, it, expect } from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";

// Mock the auth middleware so the real app can be imported without JWT config
jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { app } = await import("../../../app.js");

describe("Health Router", () => {
  describe("GET /health", () => {
    it("should return 200 with a success response", async () => {
      const res = await request(app).get("/api/health");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload).toBeDefined();
      expect(res.body.payload.timestamp).toBeDefined();
    });

    it("should include a valid ISO timestamp in the payload", async () => {
      const res = await request(app).get("/api/health");

      const { timestamp } = res.body.payload;
      expect(timestamp).toBeDefined();

      // Verify it's a valid ISO date
      const parsed = new Date(timestamp);
      expect(parsed.toISOString()).toBe(timestamp);
    });

    it("should return application/json content type", async () => {
      const res = await request(app).get("/api/health");

      expect(res.headers["content-type"]).toMatch(/application\/json/);
    });
  });
});
