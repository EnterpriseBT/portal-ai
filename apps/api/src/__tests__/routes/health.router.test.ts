import { describe, it, expect } from "@jest/globals";
import request from "supertest";
import express, { Request, Response, NextFunction } from "express";
import { healthRouter } from "../../routes/health.router.js";
import { ApiError, HttpService } from "../../services/http.service.js";

// Build a mini Express app with the health router and the error handler
function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/health", healthRouter);

  // Error handler (mirrors the one in app.ts)
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

describe("Health Router", () => {
  const app = createApp();

  describe("GET /health", () => {
    it("should return 200 with a success response", async () => {
      const res = await request(app).get("/health");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload).toBeDefined();
      expect(res.body.payload.timestamp).toBeDefined();
    });

    it("should include a valid ISO timestamp in the payload", async () => {
      const res = await request(app).get("/health");

      const { timestamp } = res.body.payload;
      expect(timestamp).toBeDefined();

      // Verify it's a valid ISO date
      const parsed = new Date(timestamp);
      expect(parsed.toISOString()).toBe(timestamp);
    });

    it("should return application/json content type", async () => {
      const res = await request(app).get("/health");

      expect(res.headers["content-type"]).toMatch(/application\/json/);
    });
  });
});
