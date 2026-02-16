import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import request from "supertest";
import express, { Request, Response, NextFunction } from "express";
import { ApiError, HttpService } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import type { Auth0UserProfile } from "@mcp-ui/core";

// Mock Auth0Service
jest.unstable_mockModule("../../services/auth0.service.js", () => ({
  Auth0Service: {
    hasAccessToken: jest.fn(),
    getAccessToken: jest.fn(),
    getUserProfile: jest.fn(),
  },
}));

const { Auth0Service } = await import("../../services/auth0.service.js");
const { profileRouter } = await import("../../routes/profile.router.js");
const mockedAuth0Service = Auth0Service as jest.Mocked<typeof Auth0Service>;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/profile", profileRouter);

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

const mockProfile: Auth0UserProfile = {
  sub: "auth0|user123",
  name: "Test User",
  email: "test@example.com",
  picture: "https://example.com/avatar.png",
  nickname: "testuser",
  email_verified: true,
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("Profile Router", () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /profile", () => {
    describe("when no authorization header is provided", () => {
      it("should return 401 for missing token", async () => {
        // hasAccessToken returns false when no auth header is present
        mockedAuth0Service.hasAccessToken.mockReturnValue(false);

        const res = await request(app).get("/profile");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe(ApiCode.PROFILE_MISSING_TOKEN);
      });
    });

    describe("when authorization header is malformed", () => {
      it("should return 401 for malformed token", async () => {
        mockedAuth0Service.hasAccessToken.mockReturnValue(false);

        const res = await request(app)
          .get("/profile")
          .set("Authorization", "InvalidToken");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe(ApiCode.PROFILE_MISSING_TOKEN);
      });
    });

    describe("when a valid access token is provided", () => {
      beforeEach(() => {
        mockedAuth0Service.hasAccessToken.mockReturnValue(true);
        mockedAuth0Service.getAccessToken.mockReturnValue("valid-token");
      });

      it("should return 200 with the user profile", async () => {
        mockedAuth0Service.getUserProfile.mockResolvedValue(mockProfile);

        const res = await request(app)
          .get("/profile")
          .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.payload.profile).toEqual(mockProfile);
      });

      it("should return 500 when Auth0 returns a profile without sub", async () => {
        mockedAuth0Service.getUserProfile.mockResolvedValue({
          sub: "",
        } as Auth0UserProfile);

        const res = await request(app)
          .get("/profile")
          .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe(ApiCode.PROFILE_INVALID_RESPONSE);
      });

      it("should return 500 when Auth0 returns null profile", async () => {
        mockedAuth0Service.getUserProfile.mockResolvedValue(
          null as unknown as Auth0UserProfile
        );

        const res = await request(app)
          .get("/profile")
          .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe(ApiCode.PROFILE_INVALID_RESPONSE);
      });

      it("should forward ApiError when Auth0Service throws one", async () => {
        mockedAuth0Service.getUserProfile.mockRejectedValue(
          new ApiError(
            502,
            ApiCode.AUTH_UPSTREAM_ERROR,
            "Auth0 upstream failure"
          )
        );

        const res = await request(app)
          .get("/profile")
          .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(502);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe(ApiCode.AUTH_UPSTREAM_ERROR);
      });

      it("should return 500 for unexpected errors", async () => {
        mockedAuth0Service.getUserProfile.mockRejectedValue(
          new Error("Network error")
        );

        const res = await request(app)
          .get("/profile")
          .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe(ApiCode.PROFILE_FETCH_FAILED);
      });
    });
  });
});
