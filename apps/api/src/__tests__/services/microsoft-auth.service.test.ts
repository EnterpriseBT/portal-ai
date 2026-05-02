import { jest, describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import crypto from "crypto";

import { environment } from "../../environment.js";
import {
  MICROSOFT_OAUTH_SCOPES,
  MicrosoftAuthError,
  MicrosoftAuthService,
} from "../../services/microsoft-auth.service.js";
import { verifyState } from "../../utils/oauth-state.util.js";

const TEST_STATE_SECRET = crypto.randomBytes(32).toString("base64");

let originalEnv: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tenant: string;
  stateSecret: string;
};

beforeAll(() => {
  originalEnv = {
    clientId: environment.MICROSOFT_OAUTH_CLIENT_ID,
    clientSecret: environment.MICROSOFT_OAUTH_CLIENT_SECRET,
    redirectUri: environment.MICROSOFT_OAUTH_REDIRECT_URI,
    tenant: environment.MICROSOFT_OAUTH_TENANT,
    stateSecret: environment.OAUTH_STATE_SECRET,
  };
  environment.MICROSOFT_OAUTH_CLIENT_ID = "test-client-id";
  environment.MICROSOFT_OAUTH_CLIENT_SECRET = "test-client-secret";
  environment.MICROSOFT_OAUTH_REDIRECT_URI =
    "http://localhost:3001/api/connectors/microsoft-excel/callback";
  environment.MICROSOFT_OAUTH_TENANT = "common";
  environment.OAUTH_STATE_SECRET = TEST_STATE_SECRET;
});

afterAll(() => {
  environment.MICROSOFT_OAUTH_CLIENT_ID = originalEnv.clientId;
  environment.MICROSOFT_OAUTH_CLIENT_SECRET = originalEnv.clientSecret;
  environment.MICROSOFT_OAUTH_REDIRECT_URI = originalEnv.redirectUri;
  environment.MICROSOFT_OAUTH_TENANT = originalEnv.tenant;
  environment.OAUTH_STATE_SECRET = originalEnv.stateSecret;
});

describe("MicrosoftAuthService.buildConsentUrl", () => {
  it("targets login.microsoftonline.com for the configured tenant", () => {
    const url = new URL(
      MicrosoftAuthService.buildConsentUrl({
        userId: "u1",
        organizationId: "o1",
      })
    );
    expect(url.host).toBe("login.microsoftonline.com");
    expect(url.pathname).toBe("/common/oauth2/v2.0/authorize");
  });

  it("respects MICROSOFT_OAUTH_TENANT when set to a specific tenant id", () => {
    const previous = environment.MICROSOFT_OAUTH_TENANT;
    environment.MICROSOFT_OAUTH_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";
    try {
      const url = new URL(
        MicrosoftAuthService.buildConsentUrl({
          userId: "u1",
          organizationId: "o1",
        })
      );
      expect(url.pathname).toBe(
        "/9188040d-6c67-4c5b-b112-36a304b66dad/oauth2/v2.0/authorize"
      );
    } finally {
      environment.MICROSOFT_OAUTH_TENANT = previous;
    }
  });

  it("sets all required OAuth2 query params", () => {
    const url = new URL(
      MicrosoftAuthService.buildConsentUrl({
        userId: "u1",
        organizationId: "o1",
      })
    );
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3001/api/connectors/microsoft-excel/callback"
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("response_mode")).toBe("query");
  });

  it("requests the documented scope set", () => {
    const url = new URL(
      MicrosoftAuthService.buildConsentUrl({
        userId: "u1",
        organizationId: "o1",
      })
    );
    const scope = url.searchParams.get("scope") ?? "";
    const scopeSet = new Set(scope.split(/\s+/));
    expect(scopeSet.has("openid")).toBe(true);
    expect(scopeSet.has("profile")).toBe(true);
    expect(scopeSet.has("email")).toBe(true);
    expect(scopeSet.has("offline_access")).toBe(true);
    expect(scopeSet.has("User.Read")).toBe(true);
    expect(scopeSet.has("Files.Read.All")).toBe(true);
  });

  it("exposes the MICROSOFT_OAUTH_SCOPES array as a constant", () => {
    expect(MICROSOFT_OAUTH_SCOPES).toContain("offline_access");
    expect(MICROSOFT_OAUTH_SCOPES).toContain("Files.Read.All");
  });

  it("attaches a signed state that verifies back to the supplied identity", () => {
    const url = new URL(
      MicrosoftAuthService.buildConsentUrl({
        userId: "user-42",
        organizationId: "org-7",
      })
    );
    const state = url.searchParams.get("state");
    expect(state).toBeTruthy();
    expect(verifyState(state as string)).toEqual({
      userId: "user-42",
      organizationId: "org-7",
    });
  });

  it("throws when MICROSOFT_OAUTH_CLIENT_ID is empty", () => {
    const original = environment.MICROSOFT_OAUTH_CLIENT_ID;
    environment.MICROSOFT_OAUTH_CLIENT_ID = "";
    try {
      expect(() =>
        MicrosoftAuthService.buildConsentUrl({
          userId: "u1",
          organizationId: "o1",
        })
      ).toThrow(/MICROSOFT_OAUTH_CLIENT_ID/);
    } finally {
      environment.MICROSOFT_OAUTH_CLIENT_ID = original;
    }
  });

  it("throws when MICROSOFT_OAUTH_REDIRECT_URI is empty", () => {
    const original = environment.MICROSOFT_OAUTH_REDIRECT_URI;
    environment.MICROSOFT_OAUTH_REDIRECT_URI = "";
    try {
      expect(() =>
        MicrosoftAuthService.buildConsentUrl({
          userId: "u1",
          organizationId: "o1",
        })
      ).toThrow(/MICROSOFT_OAUTH_REDIRECT_URI/);
    } finally {
      environment.MICROSOFT_OAUTH_REDIRECT_URI = original;
    }
  });
});

interface MockResponseInit {
  status?: number;
  body?: unknown;
}

function mockFetchResponse({ status = 200, body = {} }: MockResponseInit) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () =>
      typeof body === "string" ? body : JSON.stringify(body),
  } as unknown as Response;
}

describe("MicrosoftAuthService.exchangeCode", () => {
  it("POSTs to the tenant-scoped token endpoint with the documented body", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockFetchResponse({
        body: {
          access_token: "eyJ.access",
          refresh_token: "0.AX-refresh",
          id_token: "eyJ.id",
          expires_in: 3599,
          scope: "openid profile email offline_access User.Read Files.Read.All",
          token_type: "Bearer",
        },
      })
    );

    await MicrosoftAuthService.exchangeCode({ code: "auth-code" }, fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token"
    );
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("client_id")).toBe("test-client-id");
    expect(body.get("client_secret")).toBe("test-client-secret");
    expect(body.get("redirect_uri")).toBe(
      "http://localhost:3001/api/connectors/microsoft-excel/callback"
    );
    expect(body.get("grant_type")).toBe("authorization_code");
  });

  it("returns the camelCased token bundle including idToken", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockFetchResponse({
        body: {
          access_token: "eyJ.access",
          refresh_token: "0.AX-refresh",
          id_token: "eyJ.id",
          expires_in: 3599,
          scope: "openid offline_access Files.Read.All",
          token_type: "Bearer",
        },
      })
    );
    const out = await MicrosoftAuthService.exchangeCode(
      { code: "c" },
      fetchMock
    );
    expect(out).toEqual({
      accessToken: "eyJ.access",
      refreshToken: "0.AX-refresh",
      idToken: "eyJ.id",
      expiresIn: 3599,
      scope: "openid offline_access Files.Read.All",
    });
  });

  it("throws MicrosoftAuthError('exchange_failed') on a 4xx", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockFetchResponse({
        status: 400,
        body: { error: "invalid_grant", error_description: "bad code" },
      })
    );
    try {
      await MicrosoftAuthService.exchangeCode({ code: "c" }, fetchMock);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MicrosoftAuthError);
      expect((err as MicrosoftAuthError).kind).toBe("exchange_failed");
    }
  });

  it("throws MicrosoftAuthError('no_refresh_token') when offline_access wasn't granted", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockFetchResponse({
        body: {
          access_token: "eyJ.access",
          id_token: "eyJ.id",
          expires_in: 3599,
          scope: "openid User.Read",
          token_type: "Bearer",
        },
      })
    );
    try {
      await MicrosoftAuthService.exchangeCode({ code: "c" }, fetchMock);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MicrosoftAuthError);
      expect((err as MicrosoftAuthError).kind).toBe("no_refresh_token");
    }
  });
});

describe("MicrosoftAuthService.refreshAccessToken", () => {
  it("POSTs grant_type=refresh_token to the tenant-scoped token endpoint", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockFetchResponse({
        body: {
          access_token: "eyJ.refreshed",
          refresh_token: "0.AX-rotated",
          expires_in: 3599,
          scope: "openid offline_access Files.Read.All",
          token_type: "Bearer",
        },
      })
    );

    await MicrosoftAuthService.refreshAccessToken("0.AX-old", fetchMock);

    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token"
    );
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("0.AX-old");
    expect(body.get("client_id")).toBe("test-client-id");
    expect(body.get("client_secret")).toBe("test-client-secret");
  });

  it("returns the new (rotated) refresh token alongside the access token", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockFetchResponse({
        body: {
          access_token: "eyJ.refreshed",
          refresh_token: "0.AX-rotated",
          expires_in: 3599,
          scope: "openid offline_access Files.Read.All",
          token_type: "Bearer",
        },
      })
    );
    const out = await MicrosoftAuthService.refreshAccessToken(
      "0.AX-old",
      fetchMock
    );
    // The load-bearing assertion: rotation must surface the NEW token.
    expect(out).toEqual({
      accessToken: "eyJ.refreshed",
      refreshToken: "0.AX-rotated",
      expiresIn: 3599,
      scope: "openid offline_access Files.Read.All",
    });
  });

  it("throws MicrosoftAuthError('refresh_failed') on invalid_grant", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockFetchResponse({
        status: 400,
        body: {
          error: "invalid_grant",
          error_description: "AADSTS70008: refresh token expired",
        },
      })
    );
    try {
      await MicrosoftAuthService.refreshAccessToken("0.AX-old", fetchMock);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MicrosoftAuthError);
      expect((err as MicrosoftAuthError).kind).toBe("refresh_failed");
      expect((err as MicrosoftAuthError).message).toMatch(
        /invalid_grant|refresh_failed/i
      );
    }
  });
});

describe("MicrosoftAuthService.fetchUserProfile", () => {
  it("calls Graph /me with the access token", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockFetchResponse({
        body: {
          id: "graph-id-1",
          userPrincipalName: "alice@contoso.com",
          mail: "alice@contoso.com",
          displayName: "Alice",
        },
      })
    );

    await MicrosoftAuthService.fetchUserProfile("token-x", "tenant-x", fetchMock);

    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe("https://graph.microsoft.com/v1.0/me");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer token-x");
  });

  it("returns parsed profile fields including the supplied tenantId", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockFetchResponse({
        body: {
          id: "graph-id-1",
          userPrincipalName: "alice@contoso.com",
          mail: "alice@contoso.com",
          displayName: "Alice Smith",
        },
      })
    );
    const profile = await MicrosoftAuthService.fetchUserProfile(
      "token-x",
      "tenant-x",
      fetchMock
    );
    expect(profile).toEqual({
      upn: "alice@contoso.com",
      email: "alice@contoso.com",
      displayName: "Alice Smith",
      tenantId: "tenant-x",
    });
  });

  it("returns email: null for personal MSAs (mail is null)", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockFetchResponse({
        body: {
          id: "graph-id-personal",
          userPrincipalName: "bob_outlook.com#EXT#@bob.onmicrosoft.com",
          mail: null,
          displayName: "Bob Personal",
        },
      })
    );
    const profile = await MicrosoftAuthService.fetchUserProfile(
      "token-x",
      "9188040d-6c67-4c5b-b112-36a304b66dad",
      fetchMock
    );
    expect(profile.email).toBeNull();
    expect(profile.upn).toBe("bob_outlook.com#EXT#@bob.onmicrosoft.com");
    expect(profile.tenantId).toBe("9188040d-6c67-4c5b-b112-36a304b66dad");
  });

  it("throws MicrosoftAuthError('userinfo_failed') on a 4xx", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockFetchResponse({ status: 401, body: { error: "Unauthorized" } })
    );
    try {
      await MicrosoftAuthService.fetchUserProfile("token-x", "t-x", fetchMock);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MicrosoftAuthError);
      expect((err as MicrosoftAuthError).kind).toBe("userinfo_failed");
    }
  });

  it("throws userinfo_failed when userPrincipalName is missing", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockFetchResponse({
        body: { id: "x", mail: null, displayName: "no upn" },
      })
    );
    try {
      await MicrosoftAuthService.fetchUserProfile("token-x", "t-x", fetchMock);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MicrosoftAuthError);
      expect((err as MicrosoftAuthError).kind).toBe("userinfo_failed");
    }
  });
});
