import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";
import type { Auth0UserProfile } from "@mcp-ui/core/contracts";

// Mock the auth middleware so we can control JWT validation
jest.unstable_mockModule("../../middleware/auth.middleware.js", () => ({
  jwtCheck: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// Mock Auth0Service for the profile sub-router
jest.unstable_mockModule("../../services/auth0.service.js", () => ({
  Auth0Service: {
    hasAccessToken: jest.fn(),
    getAccessToken: jest.fn(),
    getUserProfile: jest.fn(),
  },
}));

// Import after mocks are in place
const { app } = await import("../../app.js");
const { Auth0Service } = await import("../../services/auth0.service.js");
const mockedAuth0Service = Auth0Service as jest.Mocked<typeof Auth0Service>;

const mockProfile: Auth0UserProfile = {
  sub: "auth0|user456",
  name: "Protected User",
  email: "protected@example.com",
};

describe("Protected Router", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /api/profile", () => {
    it("should return profile when JWT is valid and Auth0 responds", async () => {
      mockedAuth0Service.hasAccessToken.mockReturnValue(true);
      mockedAuth0Service.getAccessToken.mockReturnValue("valid-token");
      mockedAuth0Service.getUserProfile.mockResolvedValue(mockProfile);

      const res = await request(app)
        .get("/api/profile")
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.profile.sub).toBe("auth0|user456");
    });
  });

  describe("route mounting", () => {
    it("should return 404 for unknown sub-routes under /api", async () => {
      const res = await request(app).get("/api/nonexistent");

      expect(res.status).toBe(404);
    });
  });
});
