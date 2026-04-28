import { jest, describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import crypto from "crypto";
import { environment } from "../../environment.js";
import {
  GoogleAuthService,
  GoogleAuthError,
  GOOGLE_OAUTH_SCOPES,
} from "../../services/google-auth.service.js";
import { verifyState } from "../../utils/oauth-state.util.js";

const TEST_STATE_SECRET = crypto.randomBytes(32).toString("base64");

let originalEnv: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  stateSecret: string;
};

beforeAll(() => {
  originalEnv = {
    clientId: environment.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: environment.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: environment.GOOGLE_OAUTH_REDIRECT_URI,
    stateSecret: environment.OAUTH_STATE_SECRET,
  };
  environment.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
  environment.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
  environment.GOOGLE_OAUTH_REDIRECT_URI =
    "http://localhost:3001/api/connectors/google-sheets/callback";
  environment.OAUTH_STATE_SECRET = TEST_STATE_SECRET;
});

afterAll(() => {
  environment.GOOGLE_OAUTH_CLIENT_ID = originalEnv.clientId;
  environment.GOOGLE_OAUTH_CLIENT_SECRET = originalEnv.clientSecret;
  environment.GOOGLE_OAUTH_REDIRECT_URI = originalEnv.redirectUri;
  environment.OAUTH_STATE_SECRET = originalEnv.stateSecret;
});

describe("GoogleAuthService.buildConsentUrl", () => {
  it("targets accounts.google.com/o/oauth2/v2/auth", () => {
    const url = new URL(
      GoogleAuthService.buildConsentUrl({
        userId: "u1",
        organizationId: "o1",
      })
    );
    expect(url.host).toBe("accounts.google.com");
    expect(url.pathname).toBe("/o/oauth2/v2/auth");
  });

  it("sets all required OAuth2 query params", () => {
    const url = new URL(
      GoogleAuthService.buildConsentUrl({
        userId: "u1",
        organizationId: "o1",
      })
    );
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3001/api/connectors/google-sheets/callback"
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
  });

  it("requests both drive.readonly and spreadsheets.readonly scopes", () => {
    const url = new URL(
      GoogleAuthService.buildConsentUrl({
        userId: "u1",
        organizationId: "o1",
      })
    );
    const scope = url.searchParams.get("scope") ?? "";
    const scopeSet = new Set(scope.split(/\s+/));
    expect(scopeSet.has("https://www.googleapis.com/auth/drive.readonly")).toBe(
      true
    );
    expect(
      scopeSet.has("https://www.googleapis.com/auth/spreadsheets.readonly")
    ).toBe(true);
  });

  it("exposes the GOOGLE_OAUTH_SCOPES array as a constant", () => {
    expect(GOOGLE_OAUTH_SCOPES).toContain(
      "https://www.googleapis.com/auth/drive.readonly"
    );
    expect(GOOGLE_OAUTH_SCOPES).toContain(
      "https://www.googleapis.com/auth/spreadsheets.readonly"
    );
  });

  it("attaches a signed state that verifies back to the supplied identity", () => {
    const url = new URL(
      GoogleAuthService.buildConsentUrl({
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

  it("throws when GOOGLE_OAUTH_CLIENT_ID is empty", () => {
    const original = environment.GOOGLE_OAUTH_CLIENT_ID;
    environment.GOOGLE_OAUTH_CLIENT_ID = "";
    try {
      expect(() =>
        GoogleAuthService.buildConsentUrl({
          userId: "u1",
          organizationId: "o1",
        })
      ).toThrow(/GOOGLE_OAUTH_CLIENT_ID/);
    } finally {
      environment.GOOGLE_OAUTH_CLIENT_ID = original;
    }
  });

  it("throws when GOOGLE_OAUTH_REDIRECT_URI is empty", () => {
    const original = environment.GOOGLE_OAUTH_REDIRECT_URI;
    environment.GOOGLE_OAUTH_REDIRECT_URI = "";
    try {
      expect(() =>
        GoogleAuthService.buildConsentUrl({
          userId: "u1",
          organizationId: "o1",
        })
      ).toThrow(/GOOGLE_OAUTH_REDIRECT_URI/);
    } finally {
      environment.GOOGLE_OAUTH_REDIRECT_URI = original;
    }
  });
});

// ── Slice 4 — exchangeCode ─────────────────────────────────────────

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

describe("GoogleAuthService.exchangeCode", () => {
  it("POSTs form-encoded body with all required fields to oauth2.googleapis.com/token", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockFetchResponse({
        body: {
          access_token: "ya29.access",
          refresh_token: "1//refresh",
          expires_in: 3599,
          scope: "https://www.googleapis.com/auth/drive.readonly",
          token_type: "Bearer",
        },
      })
    );

    await GoogleAuthService.exchangeCode({ code: "auth-code-123" }, fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe("https://oauth2.googleapis.com/token");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("code")).toBe("auth-code-123");
    expect(body.get("client_id")).toBe("test-client-id");
    expect(body.get("client_secret")).toBe("test-client-secret");
    expect(body.get("redirect_uri")).toBe(
      "http://localhost:3001/api/connectors/google-sheets/callback"
    );
    expect(body.get("grant_type")).toBe("authorization_code");
  });

  it("returns the camelCased token bundle on 200", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockFetchResponse({
        body: {
          access_token: "ya29.access",
          refresh_token: "1//refresh",
          expires_in: 3599,
          scope: "https://www.googleapis.com/auth/drive.readonly",
          token_type: "Bearer",
        },
      })
    );
    const out = await GoogleAuthService.exchangeCode(
      { code: "c" },
      fetchMock
    );
    expect(out).toEqual({
      accessToken: "ya29.access",
      refreshToken: "1//refresh",
      expiresIn: 3599,
      scope: "https://www.googleapis.com/auth/drive.readonly",
    });
  });

  it("throws GoogleAuthError('exchange_failed') on a 4xx response", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockFetchResponse({
        status: 400,
        body: { error: "invalid_grant", error_description: "bad code" },
      })
    );
    try {
      await GoogleAuthService.exchangeCode({ code: "c" }, fetchMock);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(GoogleAuthError);
      expect((err as GoogleAuthError).kind).toBe("exchange_failed");
    }
  });

  it("throws GoogleAuthError('no_refresh_token') when response lacks refresh_token", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockFetchResponse({
        body: {
          access_token: "ya29.access",
          expires_in: 3599,
          scope: "https://www.googleapis.com/auth/drive.readonly",
          token_type: "Bearer",
        },
      })
    );
    try {
      await GoogleAuthService.exchangeCode({ code: "c" }, fetchMock);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(GoogleAuthError);
      expect((err as GoogleAuthError).kind).toBe("no_refresh_token");
    }
  });
});

// ── Slice 5 — fetchUserEmail ───────────────────────────────────────

describe("GoogleAuthService.fetchUserEmail", () => {
  it("GETs userinfo with Bearer auth and returns the email on 200", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockFetchResponse({
        body: {
          sub: "1234",
          email: "alice@example.com",
          email_verified: true,
        },
      })
    );
    const email = await GoogleAuthService.fetchUserEmail(
      "ya29.access",
      fetchMock
    );
    expect(email).toBe("alice@example.com");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://www.googleapis.com/oauth2/v3/userinfo");
    expect(init.method ?? "GET").toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer ya29.access"
    );
  });

  it("throws GoogleAuthError('userinfo_failed') when email_verified is false", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockFetchResponse({
        body: {
          sub: "1234",
          email: "alice@example.com",
          email_verified: false,
        },
      })
    );
    try {
      await GoogleAuthService.fetchUserEmail("ya29.access", fetchMock);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(GoogleAuthError);
      expect((err as GoogleAuthError).kind).toBe("userinfo_failed");
    }
  });

  it("throws GoogleAuthError('userinfo_failed') on a non-2xx response", async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      mockFetchResponse({
        status: 401,
        body: { error: "invalid_token" },
      })
    );
    try {
      await GoogleAuthService.fetchUserEmail("ya29.access", fetchMock);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(GoogleAuthError);
      expect((err as GoogleAuthError).kind).toBe("userinfo_failed");
    }
  });
});
