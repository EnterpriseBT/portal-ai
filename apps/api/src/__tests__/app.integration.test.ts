import { describe, it, expect } from "@jest/globals";
import request from "supertest";
import express, { Request, Response, NextFunction } from "express";
import { healthRouter } from "../routes/health.router.js";
import { ApiError, HttpService } from "../services/http.service.js";

/**
 * Integration tests against the Express app to verify middleware, routing,
 * and error handling work together correctly.
 *
 * Note: Protected routes are excluded here because they require JWT
 * validation which is tested separately with mocked auth middleware.
 */
function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/health", healthRouter);

  // Replicate the catch-all error handler from app.ts
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      return HttpService.error(res, err);
    }
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      code: "UNKNOWN",
    });
  });

  return app;
}

describe("App Integration", () => {
  const app = createApp();

  describe("Health endpoint", () => {
    it("should respond to GET /health with status 200", async () => {
      const res = await request(app).get("/health");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        payload: {
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
        .get("/health")
        .set("Content-Type", "application/json");

      expect(res.status).toBe(200);
    });
  });
});
