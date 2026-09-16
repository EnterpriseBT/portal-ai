import { jest, describe, it, expect, afterEach } from "@jest/globals";
import { Auth0Service } from "../../services/auth0.service.js";
import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";

describe("Auth0Service", () => {
  describe("hasAccessToken()", () => {
    it("should return true for a valid Bearer token", () => {
      expect(Auth0Service.hasAccessToken("Bearer abc123")).toBe(true);
    });

    it("should return false for undefined authorization", () => {
      expect(Auth0Service.hasAccessToken(undefined)).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(Auth0Service.hasAccessToken("")).toBe(false);
    });

    it("should return false for non-Bearer scheme", () => {
      expect(Auth0Service.hasAccessToken("Basic abc123")).toBe(false);
    });

    it("should return false for lowercase bearer", () => {
      expect(Auth0Service.hasAccessToken("bearer abc123")).toBe(false);
    });
  });

  describe("getAccessToken()", () => {
    it("should extract the token from a valid Bearer header", () => {
      const token = Auth0Service.getAccessToken("Bearer my-access-token");
      expect(token).toBe("my-access-token");
    });

    it("should throw ApiError for undefined authorization", () => {
      expect(() => Auth0Service.getAccessToken(undefined)).toThrow(ApiError);
    });

    it("should throw ApiError with correct code for missing token", () => {
      try {
        Auth0Service.getAccessToken(undefined);
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(401);
        expect((error as ApiError).code).toBe(ApiCode.PROFILE_MISSING_TOKEN);
      }
    });

    it("should throw ApiError for malformed authorization", () => {
      expect(() => Auth0Service.getAccessToken("InvalidFormat")).toThrow(
        ApiError
      );
    });
  });

  describe("getAuth0UserProfile()", () => {
    const mockProfile = {
      sub: "auth0|user789",
      name: "Test User",
      email: "test@example.com",
    };

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should return user profile on successful fetch", async () => {
      jest.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockProfile),
      } as globalThis.Response);

      const profile = await Auth0Service.getAuth0UserProfile("valid-token");

      expect(profile).toEqual(mockProfile);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://test.auth0.com/userinfo",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer valid-token",
          }),
        })
      );
    });

    it("should throw ApiError when Auth0 returns non-ok response", async () => {
      jest.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: () => Promise.resolve("Invalid token"),
      } as globalThis.Response);

      await expect(
        Auth0Service.getAuth0UserProfile("invalid-token")
      ).rejects.toThrow(ApiError);

      try {
        await Auth0Service.getAuth0UserProfile("invalid-token");
      } catch (error) {
        expect((error as ApiError).status).toBe(401);
        expect((error as ApiError).code).toBe(ApiCode.AUTH_UPSTREAM_ERROR);
      }
    });

    it("should throw ApiError with the upstream status code", async () => {
      jest.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        text: () => Promise.resolve("Auth0 is down"),
      } as globalThis.Response);

      await expect(
        Auth0Service.getAuth0UserProfile("some-token")
      ).rejects.toThrow(ApiError);

      try {
        await Auth0Service.getAuth0UserProfile("some-token");
      } catch (error) {
        expect((error as ApiError).status).toBe(503);
      }
    });

    it("should throw when fetch itself rejects", async () => {
      jest
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("Network failure"));

      await expect(Auth0Service.getAuth0UserProfile("token")).rejects.toThrow(
        "Network failure"
      );
    });
  });

  describe("getAuth0UserProfile() issuer resolution (#577)", () => {
    const mockProfile = {
      sub: "oidc|abc",
      name: "Enterprise User",
      email: "user@corp.com",
    };

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("hits Auth0 userinfo directly for the default issuer (no discovery)", async () => {
      const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockProfile),
      } as globalThis.Response);

      await Auth0Service.getAuth0UserProfile("t", "https://test.auth0.com/");

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://test.auth0.com/userinfo",
        expect.anything()
      );
    });

    it("resolves a non-Auth0 issuer's userinfo via OIDC discovery", async () => {
      const fetchSpy = jest
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              userinfo_endpoint: "https://idp.corp.com/oauth/userinfo",
            }),
        } as globalThis.Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockProfile),
        } as globalThis.Response);

      const profile = await Auth0Service.getAuth0UserProfile(
        "t",
        "https://idp.corp.com/"
      );

      expect(profile).toEqual(mockProfile);
      expect(fetchSpy.mock.calls[0][0]).toBe(
        "https://idp.corp.com/.well-known/openid-configuration"
      );
      expect(fetchSpy.mock.calls[1][0]).toBe(
        "https://idp.corp.com/oauth/userinfo"
      );
    });

    it("caches the discovery document per issuer", async () => {
      const fetchSpy = jest
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ userinfo_endpoint: "https://idp2.corp.com/ui" }),
        } as globalThis.Response)
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockProfile),
        } as globalThis.Response);

      await Auth0Service.getAuth0UserProfile("t", "https://idp2.corp.com/");
      await Auth0Service.getAuth0UserProfile("t", "https://idp2.corp.com/");

      const discoveryCalls = fetchSpy.mock.calls.filter((c) =>
        String(c[0]).includes(".well-known")
      );
      expect(discoveryCalls).toHaveLength(1);
    });
  });
});
