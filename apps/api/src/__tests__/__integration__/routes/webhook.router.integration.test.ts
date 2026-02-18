import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { createHmac } from "crypto";
import request from "supertest";
import { Request, Response, NextFunction } from "express";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import type { Auth0WebhookPayload } from "@mcp-ui/core/contracts";

const WEBHOOK_SECRET = "test-webhook-secret";

// Set env var before any module imports that read environment
process.env.AUTH0_WEBHOOK_SECRET = WEBHOOK_SECRET;

// Mock the auth middleware so the real app can be imported without JWT config
jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// Mock WebhookService to isolate the router tests
jest.unstable_mockModule("../../../services/webhook.service.js", () => ({
  WebhookService: {
    syncUser: jest.fn(),
  },
}));

const { WebhookService } = await import(
  "../../../services/webhook.service.js"
);
const { app } = await import("../../../app.js");
const { ApiError } = await import("../../../services/http.service.js");
const mockedWebhookService = WebhookService as jest.Mocked<
  typeof WebhookService
>;

function signPayload(body: string): string {
  return createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
}

const validPayload: Auth0WebhookPayload = {
  user_id: "auth0|user123",
  email: "test@example.com",
  name: "Test User",
  picture: "https://example.com/avatar.png",
};

describe("Webhook Router", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /api/webhooks/auth0/sync", () => {
    describe("signature verification", () => {
      it("should return 401 when X-Auth0-Webhook-Signature header is missing", async () => {
        const res = await request(app)
          .post("/api/webhooks/auth0/sync")
          .send(validPayload);

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe(ApiCode.WEBHOOK_MISSING_SIGNATURE);
      });

      it("should return 401 when signature is invalid", async () => {
        const body = JSON.stringify(validPayload);
        const res = await request(app)
          .post("/api/webhooks/auth0/sync")
          .set("Content-Type", "application/json")
          .set(
            "X-Auth0-Webhook-Signature",
            "0000000000000000000000000000000000000000000000000000000000000000"
          )
          .send(body);

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe(ApiCode.WEBHOOK_INVALID_SIGNATURE);
      });
    });

    describe("payload validation", () => {
      it("should return 400 for invalid payload (missing user_id)", async () => {
        const invalidPayload = { email: "test@example.com" };
        const body = JSON.stringify(invalidPayload);
        const signature = signPayload(body);

        const res = await request(app)
          .post("/api/webhooks/auth0/sync")
          .set("Content-Type", "application/json")
          .set("X-Auth0-Webhook-Signature", signature)
          .send(body);

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe(ApiCode.WEBHOOK_INVALID_PAYLOAD);
      });

      it("should return 400 for invalid payload (empty user_id)", async () => {
        const invalidPayload = { user_id: "" };
        const body = JSON.stringify(invalidPayload);
        const signature = signPayload(body);

        const res = await request(app)
          .post("/api/webhooks/auth0/sync")
          .set("Content-Type", "application/json")
          .set("X-Auth0-Webhook-Signature", signature)
          .send(body);

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe(ApiCode.WEBHOOK_INVALID_PAYLOAD);
      });
    });

    describe("successful sync", () => {
      it("should return 200 with created action for new user", async () => {
        mockedWebhookService.syncUser.mockResolvedValue({
          action: "created",
          userId: "new-user-id",
        });

        const body = JSON.stringify(validPayload);
        const signature = signPayload(body);

        const res = await request(app)
          .post("/api/webhooks/auth0/sync")
          .set("Content-Type", "application/json")
          .set("X-Auth0-Webhook-Signature", signature)
          .send(body);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.payload.action).toBe("created");
        expect(res.body.payload.userId).toBe("new-user-id");
      });

      it("should return 200 with updated action for changed user", async () => {
        mockedWebhookService.syncUser.mockResolvedValue({
          action: "updated",
          userId: "existing-user-id",
        });

        const body = JSON.stringify(validPayload);
        const signature = signPayload(body);

        const res = await request(app)
          .post("/api/webhooks/auth0/sync")
          .set("Content-Type", "application/json")
          .set("X-Auth0-Webhook-Signature", signature)
          .send(body);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.payload.action).toBe("updated");
        expect(res.body.payload.userId).toBe("existing-user-id");
      });

      it("should return 200 with unchanged action for identical user", async () => {
        mockedWebhookService.syncUser.mockResolvedValue({
          action: "unchanged",
          userId: "existing-user-id",
        });

        const body = JSON.stringify(validPayload);
        const signature = signPayload(body);

        const res = await request(app)
          .post("/api/webhooks/auth0/sync")
          .set("Content-Type", "application/json")
          .set("X-Auth0-Webhook-Signature", signature)
          .send(body);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.payload.action).toBe("unchanged");
      });

      it("should handle minimal payload with only user_id", async () => {
        mockedWebhookService.syncUser.mockResolvedValue({
          action: "created",
          userId: "new-user-id",
        });

        const minimalPayload = { user_id: "auth0|minimal" };
        const body = JSON.stringify(minimalPayload);
        const signature = signPayload(body);

        const res = await request(app)
          .post("/api/webhooks/auth0/sync")
          .set("Content-Type", "application/json")
          .set("X-Auth0-Webhook-Signature", signature)
          .send(body);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      });
    });

    describe("error handling", () => {
      it("should return 500 when sync service throws an unexpected error", async () => {
        mockedWebhookService.syncUser.mockRejectedValue(
          new Error("Database connection failed")
        );

        const body = JSON.stringify(validPayload);
        const signature = signPayload(body);

        const res = await request(app)
          .post("/api/webhooks/auth0/sync")
          .set("Content-Type", "application/json")
          .set("X-Auth0-Webhook-Signature", signature)
          .send(body);

        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe(ApiCode.WEBHOOK_SYNC_FAILED);
      });

      it("should return 500 when sync service throws an ApiError", async () => {
        mockedWebhookService.syncUser.mockRejectedValue(
          new ApiError(
            502,
            ApiCode.WEBHOOK_SYNC_FAILED,
            "Upstream database failure"
          )
        );

        const body = JSON.stringify(validPayload);
        const signature = signPayload(body);

        const res = await request(app)
          .post("/api/webhooks/auth0/sync")
          .set("Content-Type", "application/json")
          .set("X-Auth0-Webhook-Signature", signature)
          .send(body);

        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe(ApiCode.WEBHOOK_SYNC_FAILED);
      });
    });
  });
});
