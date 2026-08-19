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

/**
 * The complete scope set, and it is exactly these three (#408).
 *
 * `openid` + `email` are required so the access token can call
 * `oauth2/v3/userinfo` for the authenticated email — without one of
 * these, Google returns 401 "Invalid Credentials" on userinfo even
 * though the Drive / Sheets scopes are working.
 *
 * `drive.file` grants access only to files the user picks through the
 * Google Picker, per file. It replaced `drive.readonly` (restricted) and
 * `spreadsheets.readonly` (sensitive), which between them required a CASA
 * security assessment, showed an unverified-app interstitial mid-connect,
 * and capped the app at 100 users until Google finished reviewing it.
 *
 * **All three scopes here are non-sensitive, so the app needs no Google
 * verification at all.** Adding a single sensitive or restricted scope
 * brings the assessment, the interstitial and the user cap straight back —
 * it is not a small change, whatever the calling code makes it look like.
 * An exhaustive test in `google-auth.service.test.ts` fails if this list
 * grows; that failure is the warning, not an obstacle to route around.
 *
 * The list must stay in step with the scopes configured on the OAuth
 * consent screen in each GCP project — verification keys off what the
 * client declares there, not off what a given request asks for.
 */
export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive.file",
] as const;

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

export type GoogleAuthErrorKind =
  | "exchange_failed"
  | "no_refresh_token"
  | "userinfo_failed"
  | "refresh_failed"
  | "listSheets_failed"
  | "fetchSheet_failed";

export class GoogleAuthError extends Error {
  override readonly name = "GoogleAuthError" as const;
  readonly kind: GoogleAuthErrorKind;
  /**
   * Upstream HTTP status, when the failure came from a Google response.
   *
   * Callers need to tell a 404 from a 403 without parsing `message`: a 404
   * on a freshly Picker-granted file can be a race worth one retry, while a
   * 403 is a rejected scope and retrying it only slows the failure down.
   */
  readonly status?: number;

  constructor(
    kind: GoogleAuthErrorKind,
    message?: string,
    options?: ErrorOptions & { status?: number }
  ) {
    super(message ?? kind, options);
    this.kind = kind;
    if (options?.status !== undefined) this.status = options.status;
  }
}

export interface BuildConsentUrlInput {
  userId: string;
  organizationId: string;
  /**
   * Optional reconnect target. The callback updates this instance's
   * credentials instead of minting a new one. Omit on the "add new
   * connector" flow so every consent produces a fresh instance.
   */
  connectorInstanceId?: string;
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
        ...(input.connectorInstanceId
          ? { connectorInstanceId: input.connectorInstanceId }
          : {}),
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

  /**
   * Trade a refresh token for a fresh access token.
   *
   * Used by `GoogleAccessTokenCacheService` to lazily refresh — concurrent
   * callers de-dup against an in-memory single-flight Map. Google does not
   * rotate the refresh token on this endpoint, so the response is just
   * `{ access_token, expires_in }`. An `invalid_grant` upstream means the
   * refresh token was revoked (user removed access in Google account
   * settings, or scope changed) and the connector instance must be marked
   * `status="error"` for Phase E's reconnect flow.
   */
  static async refreshAccessToken(
    refreshToken: string,
    fetchFn: FetchFn = fetch
  ): Promise<{ accessToken: string; expiresIn: number }> {
    if (!environment.GOOGLE_OAUTH_CLIENT_ID) {
      throw new Error("GOOGLE_OAUTH_CLIENT_ID is not configured");
    }
    if (!environment.GOOGLE_OAUTH_CLIENT_SECRET) {
      throw new Error("GOOGLE_OAUTH_CLIENT_SECRET is not configured");
    }

    const body = new URLSearchParams({
      client_id: environment.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: environment.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });

    const res = await fetchFn(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const errBody = await safeReadText(res);
      throw new GoogleAuthError(
        "refresh_failed",
        `Google token refresh failed (${res.status}): ${errBody}`
      );
    }

    const json = (await res.json()) as GoogleTokenResponse;
    if (!json.access_token) {
      throw new GoogleAuthError(
        "refresh_failed",
        "Google response missing access_token"
      );
    }
    return {
      accessToken: json.access_token,
      expiresIn: json.expires_in ?? 0,
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
