import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import type { Auth0UserProfile } from "@mcp-ui/core/contracts";

// Mock the auth middleware so the real app can be imported without JWT config
jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// Mock Auth0Service
jest.unstable_mockModule("../../../services/auth0.service.js", () => ({
  Auth0Service: {
    hasAccessToken: jest.fn(),
    getAccessToken: jest.fn(),
    getAuth0UserProfile: jest.fn(),
  },
}));

// Mock usersRepo
jest.unstable_mockModule("../../../db/repositories/users.repository.js", () => ({
  usersRepo: {
    findByAuth0Id: jest.fn(),
  },
}));

const { Auth0Service } = await import("../../../services/auth0.service.js");
const { usersRepo } = await import(
  "../../../db/repositories/users.repository.js"
);
const { app } = await import("../../../app.js");
const { ApiError } = await import("../../../services/http.service.js");
const mockedAuth0Service = Auth0Service as jest.Mocked<typeof Auth0Service>;
const mockedUsersRepo = usersRepo as jest.Mocked<typeof usersRepo>;

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
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /api/profile", () => {
    describe("when no authorization header is provided", () => {
      it("should return 401 for missing token", async () => {
        // hasAccessToken returns false when no auth header is present
        mockedAuth0Service.hasAccessToken.mockReturnValue(false);

        const res = await request(app).get("/api/profile");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe(ApiCode.PROFILE_MISSING_TOKEN);
      });
    });

    describe("when authorization header is malformed", () => {
      it("should return 401 for malformed token", async () => {
        mockedAuth0Service.hasAccessToken.mockReturnValue(false);

        const res = await request(app)
          .get("/api/profile")
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

      it("should return 200 with the user profile and lastLogin", async () => {
        mockedAuth0Service.getAuth0UserProfile.mockResolvedValue(mockProfile);
        mockedUsersRepo.findByAuth0Id.mockResolvedValue({
          id: "user-1",
          auth0Id: mockProfile.sub,
          email: mockProfile.email ?? null,
          name: mockProfile.name ?? null,
          picture: mockProfile.picture ?? null,
          lastLogin: 1706000000000,
          created: Date.now(),
          createdBy: "system",
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        });

        const res = await request(app)
          .get("/api/profile")
          .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.payload.profile).toEqual(mockProfile);
        expect(res.body.payload.lastLogin).toBe(1706000000000);
      });

      it("should return 200 with lastLogin as null when user is not in the database", async () => {
        mockedAuth0Service.getAuth0UserProfile.mockResolvedValue(mockProfile);
        mockedUsersRepo.findByAuth0Id.mockResolvedValue(undefined);

        const res = await request(app)
          .get("/api/profile")
          .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.payload.profile).toEqual(mockProfile);
        expect(res.body.payload.lastLogin).toBeNull();
      });

      it("should return 500 when Auth0 returns a profile without sub", async () => {
        mockedAuth0Service.getAuth0UserProfile.mockResolvedValue({
          sub: "",
        } as Auth0UserProfile);

        const res = await request(app)
          .get("/api/profile")
          .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe(ApiCode.PROFILE_INVALID_RESPONSE);
      });

      it("should return 500 when Auth0 returns null profile", async () => {
        mockedAuth0Service.getAuth0UserProfile.mockResolvedValue(
          null as unknown as Auth0UserProfile
        );

        const res = await request(app)
          .get("/api/profile")
          .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe(ApiCode.PROFILE_INVALID_RESPONSE);
      });

      it("should forward ApiError when Auth0Service throws one", async () => {
        mockedAuth0Service.getAuth0UserProfile.mockRejectedValue(
          new ApiError(
            502,
            ApiCode.AUTH_UPSTREAM_ERROR,
            "Auth0 upstream failure"
          )
        );

        const res = await request(app)
          .get("/api/profile")
          .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(502);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe(ApiCode.AUTH_UPSTREAM_ERROR);
      });

      it("should return 500 for unexpected errors", async () => {
        mockedAuth0Service.getAuth0UserProfile.mockRejectedValue(
          new Error("Network error")
        );

        const res = await request(app)
          .get("/api/profile")
          .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe(ApiCode.PROFILE_FETCH_FAILED);
      });
    });
  });
});
