/**
 * Google OAuth2 client. Speaks directly to Google — no Auth0 in the path.
 *
 * Three responsibilities, each independently unit-tested:
 *   - `buildConsentUrl` (pure URL builder; the only side effect is calling
 *     `signState` for the embedded `state`).
 *   - `exchangeCode` (POST to oauth2.googleapis.com/token).
 *   - `fetchUserEmail` (GET userinfo with the access token).
 *
 * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-A.plan.md` §Slices 3-5.
 */

import { environment } from "../environment.js";
import { signState } from "../utils/oauth-state.util.js";

export const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
] as const;

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

export type GoogleAuthErrorKind =
  | "exchange_failed"
  | "no_refresh_token"
  | "userinfo_failed"
  | "refresh_failed";

export class GoogleAuthError extends Error {
  override readonly name = "GoogleAuthError" as const;
  readonly kind: GoogleAuthErrorKind;

  constructor(kind: GoogleAuthErrorKind, message?: string, options?: ErrorOptions) {
    super(message ?? kind, options);
    this.kind = kind;
  }
}

export interface BuildConsentUrlInput {
  userId: string;
  organizationId: string;
}

export interface ExchangeCodeInput {
  code: string;
}

export interface TokenBundle {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

interface GoogleUserinfoResponse {
  sub?: string;
  email?: string;
  email_verified?: boolean;
}

type FetchFn = typeof fetch;

export class GoogleAuthService {
  static buildConsentUrl(input: BuildConsentUrlInput): string {
    if (!environment.GOOGLE_OAUTH_CLIENT_ID) {
      throw new Error("GOOGLE_OAUTH_CLIENT_ID is not configured");
    }
    if (!environment.GOOGLE_OAUTH_REDIRECT_URI) {
      throw new Error("GOOGLE_OAUTH_REDIRECT_URI is not configured");
    }

    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set("client_id", environment.GOOGLE_OAUTH_CLIENT_ID);
    url.searchParams.set("redirect_uri", environment.GOOGLE_OAUTH_REDIRECT_URI);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("scope", GOOGLE_OAUTH_SCOPES.join(" "));
    url.searchParams.set(
      "state",
      signState({
        userId: input.userId,
        organizationId: input.organizationId,
      })
    );
    return url.toString();
  }

  static async exchangeCode(
    input: ExchangeCodeInput,
    fetchFn: FetchFn = fetch
  ): Promise<TokenBundle> {
    if (!environment.GOOGLE_OAUTH_CLIENT_ID) {
      throw new Error("GOOGLE_OAUTH_CLIENT_ID is not configured");
    }
    if (!environment.GOOGLE_OAUTH_CLIENT_SECRET) {
      throw new Error("GOOGLE_OAUTH_CLIENT_SECRET is not configured");
    }
    if (!environment.GOOGLE_OAUTH_REDIRECT_URI) {
      throw new Error("GOOGLE_OAUTH_REDIRECT_URI is not configured");
    }

    const body = new URLSearchParams({
      code: input.code,
      client_id: environment.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: environment.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: environment.GOOGLE_OAUTH_REDIRECT_URI,
      grant_type: "authorization_code",
    });

    const res = await fetchFn(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const errBody = await safeReadText(res);
      throw new GoogleAuthError(
        "exchange_failed",
        `Google token exchange failed (${res.status}): ${errBody}`
      );
    }

    const json = (await res.json()) as GoogleTokenResponse;
    if (!json.access_token) {
      throw new GoogleAuthError(
        "exchange_failed",
        "Google response missing access_token"
      );
    }
    if (!json.refresh_token) {
      throw new GoogleAuthError(
        "no_refresh_token",
        "Google response missing refresh_token — ensure prompt=consent and the client hasn't previously granted offline access"
      );
    }

    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresIn: json.expires_in ?? 0,
      scope: json.scope ?? "",
    };
  }

  static async fetchUserEmail(
    accessToken: string,
    fetchFn: FetchFn = fetch
  ): Promise<string> {
    const res = await fetchFn(GOOGLE_USERINFO_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const errBody = await safeReadText(res);
      throw new GoogleAuthError(
        "userinfo_failed",
        `Google userinfo failed (${res.status}): ${errBody}`
      );
    }

    const json = (await res.json()) as GoogleUserinfoResponse;
    if (!json.email) {
      throw new GoogleAuthError(
        "userinfo_failed",
        "Google userinfo response missing email"
      );
    }
    if (json.email_verified === false) {
      throw new GoogleAuthError(
        "userinfo_failed",
        "Google account email is not verified"
      );
    }
    return json.email;
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}
