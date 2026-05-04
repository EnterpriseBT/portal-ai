/**
 * Microsoft identity-platform v2.0 OAuth2 client.
 *
 * Three responsibilities, each independently unit-tested:
 *   - `buildConsentUrl` (pure URL builder; the only side effect is calling
 *     `signState` for the embedded `state`).
 *   - `exchangeCode` (POST to login.microsoftonline.com/{tenant}/oauth2/v2.0/token).
 *   - `refreshAccessToken` — Microsoft **rotates** the refresh token on
 *     every call, so the response contains a new `refresh_token` that
 *     callers MUST persist. This is the single material divergence from
 *     `GoogleAuthService.refreshAccessToken`.
 *   - `fetchUserProfile` (GET /me on Microsoft Graph; tenantId comes
 *     from the call site since the id-token claim is the canonical
 *     source).
 *
 * See `docs/MICROSOFT_EXCEL_CONNECTOR.phase-A.spec.md`.
 */

import { environment } from "../environment.js";
import { signState } from "../utils/oauth-state.util.js";

/**
 * `openid` + `profile` + `email` are required for the id_token / Graph
 * /me payload to carry identity claims. `offline_access` is the **only**
 * switch that produces a refresh token — without it, Microsoft's token
 * response omits `refresh_token` and there is no `prompt=consent`-style
 * fallback. `User.Read` covers Graph /me; `Files.Read.All` is the broad
 * read scope for OneDrive personal + business files.
 */
export const MICROSOFT_OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Files.Read.All",
] as const;

const GRAPH_ME_URL = "https://graph.microsoft.com/v1.0/me";

export type MicrosoftAuthErrorKind =
  | "exchange_failed"
  | "no_refresh_token"
  | "userinfo_failed"
  | "refresh_failed";

export class MicrosoftAuthError extends Error {
  override readonly name = "MicrosoftAuthError" as const;
  readonly kind: MicrosoftAuthErrorKind;

  constructor(
    kind: MicrosoftAuthErrorKind,
    message?: string,
    options?: ErrorOptions
  ) {
    super(message ?? kind, options);
    this.kind = kind;
  }
}

function authorizeUrlForTenant(tenant: string): string {
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`;
}

function tokenUrlForTenant(tenant: string): string {
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
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
  /**
   * The id_token returned with the auth-code grant. Held for callers
   * that want to decode tenant id + claims without a Graph round-trip
   * — `MicrosoftExcelConnectorService.handleCallback` decodes `tid`
   * from here to scope the find-or-update.
   */
  idToken: string;
  expiresIn: number;
  scope: string;
}

export interface RefreshedTokenBundle {
  accessToken: string;
  /**
   * Microsoft rotates the refresh token on every refresh. Callers MUST
   * persist this back to the encrypted credentials column — the cache
   * layer does this in `MicrosoftAccessTokenCacheService.refreshAndStore`.
   */
  refreshToken: string;
  expiresIn: number;
  scope: string;
}

export interface MicrosoftUserProfile {
  upn: string;
  /** `mail` is null for personal MSAs (e.g. consumer outlook.com accounts). */
  email: string | null;
  displayName: string;
  /**
   * The tenant id is supplied by the caller (decoded from the id_token's
   * `tid` claim) rather than read off the Graph response. Graph /me
   * does not return the tenant directly.
   */
  tenantId: string;
}

interface MicrosoftTokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

interface GraphMeResponse {
  id?: string;
  userPrincipalName?: string;
  mail?: string | null;
  displayName?: string;
}

type FetchFn = typeof fetch;

export class MicrosoftAuthService {
  static buildConsentUrl(input: BuildConsentUrlInput): string {
    if (!environment.MICROSOFT_OAUTH_CLIENT_ID) {
      throw new Error("MICROSOFT_OAUTH_CLIENT_ID is not configured");
    }
    if (!environment.MICROSOFT_OAUTH_REDIRECT_URI) {
      throw new Error("MICROSOFT_OAUTH_REDIRECT_URI is not configured");
    }

    const tenant = environment.MICROSOFT_OAUTH_TENANT || "common";
    const url = new URL(authorizeUrlForTenant(tenant));
    url.searchParams.set("client_id", environment.MICROSOFT_OAUTH_CLIENT_ID);
    url.searchParams.set(
      "redirect_uri",
      environment.MICROSOFT_OAUTH_REDIRECT_URI
    );
    url.searchParams.set("response_type", "code");
    url.searchParams.set("response_mode", "query");
    // `select_account` so a user with multiple Microsoft accounts can
    // pick which one to authorize, instead of being silently SSO'd into
    // the most-recently-used account.
    url.searchParams.set("prompt", "select_account");
    url.searchParams.set("scope", MICROSOFT_OAUTH_SCOPES.join(" "));
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
    if (!environment.MICROSOFT_OAUTH_CLIENT_ID) {
      throw new Error("MICROSOFT_OAUTH_CLIENT_ID is not configured");
    }
    if (!environment.MICROSOFT_OAUTH_CLIENT_SECRET) {
      throw new Error("MICROSOFT_OAUTH_CLIENT_SECRET is not configured");
    }
    if (!environment.MICROSOFT_OAUTH_REDIRECT_URI) {
      throw new Error("MICROSOFT_OAUTH_REDIRECT_URI is not configured");
    }

    const tenant = environment.MICROSOFT_OAUTH_TENANT || "common";
    const body = new URLSearchParams({
      code: input.code,
      client_id: environment.MICROSOFT_OAUTH_CLIENT_ID,
      client_secret: environment.MICROSOFT_OAUTH_CLIENT_SECRET,
      redirect_uri: environment.MICROSOFT_OAUTH_REDIRECT_URI,
      grant_type: "authorization_code",
    });

    const res = await fetchFn(tokenUrlForTenant(tenant), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const errBody = await safeReadText(res);
      throw new MicrosoftAuthError(
        "exchange_failed",
        `Microsoft token exchange failed (${res.status}): ${errBody}`
      );
    }

    const json = (await res.json()) as MicrosoftTokenResponse;
    if (!json.access_token) {
      throw new MicrosoftAuthError(
        "exchange_failed",
        "Microsoft response missing access_token"
      );
    }
    if (!json.refresh_token) {
      throw new MicrosoftAuthError(
        "no_refresh_token",
        "Microsoft response missing refresh_token — ensure offline_access scope was requested and granted"
      );
    }

    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      idToken: json.id_token ?? "",
      expiresIn: json.expires_in ?? 0,
      scope: json.scope ?? "",
    };
  }

  /**
   * Trade a refresh token for a fresh access token. Microsoft rotates the
   * refresh token on every call, so the response contains a new
   * `refresh_token` that callers MUST persist back to storage. The cache
   * layer (`MicrosoftAccessTokenCacheService`) owns that persistence; the
   * service layer must NOT discard the new refresh token by reading only
   * `accessToken`.
   *
   * On `invalid_grant` the refresh token has been consumed (race), revoked
   * (user removed access in the Microsoft account portal), or expired.
   * The caller marks the connector instance `status="error"` for the
   * Phase E reconnect flow.
   */
  static async refreshAccessToken(
    refreshToken: string,
    fetchFn: FetchFn = fetch
  ): Promise<RefreshedTokenBundle> {
    if (!environment.MICROSOFT_OAUTH_CLIENT_ID) {
      throw new Error("MICROSOFT_OAUTH_CLIENT_ID is not configured");
    }
    if (!environment.MICROSOFT_OAUTH_CLIENT_SECRET) {
      throw new Error("MICROSOFT_OAUTH_CLIENT_SECRET is not configured");
    }

    const tenant = environment.MICROSOFT_OAUTH_TENANT || "common";
    const body = new URLSearchParams({
      client_id: environment.MICROSOFT_OAUTH_CLIENT_ID,
      client_secret: environment.MICROSOFT_OAUTH_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });

    const res = await fetchFn(tokenUrlForTenant(tenant), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const errBody = await safeReadText(res);
      throw new MicrosoftAuthError(
        "refresh_failed",
        `Microsoft token refresh failed (${res.status}): ${errBody}`
      );
    }

    const json = (await res.json()) as MicrosoftTokenResponse;
    if (!json.access_token) {
      throw new MicrosoftAuthError(
        "refresh_failed",
        "Microsoft response missing access_token"
      );
    }
    if (!json.refresh_token) {
      // Microsoft normally rotates; an absent refresh_token here would
      // mean the next refresh has nothing to use. Treat as a refresh
      // failure rather than silently drifting into an unrecoverable
      // state.
      throw new MicrosoftAuthError(
        "refresh_failed",
        "Microsoft refresh response missing refresh_token (rotation contract violated)"
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
   * Read the authenticated user's UPN, email, and display name from
   * Microsoft Graph. The tenant id is supplied by the caller — Graph /me
   * does not return it directly; the caller decodes the id_token's `tid`
   * claim or threads the tenant from the OAuth context.
   */
  static async fetchUserProfile(
    accessToken: string,
    tenantId: string,
    fetchFn: FetchFn = fetch
  ): Promise<MicrosoftUserProfile> {
    const res = await fetchFn(GRAPH_ME_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const errBody = await safeReadText(res);
      throw new MicrosoftAuthError(
        "userinfo_failed",
        `Microsoft Graph /me failed (${res.status}): ${errBody}`
      );
    }

    const json = (await res.json()) as GraphMeResponse;
    if (!json.userPrincipalName) {
      throw new MicrosoftAuthError(
        "userinfo_failed",
        "Microsoft Graph /me response missing userPrincipalName"
      );
    }
    return {
      upn: json.userPrincipalName,
      email:
        typeof json.mail === "string" && json.mail.length > 0
          ? json.mail
          : null,
      displayName: json.displayName ?? "",
      tenantId,
    };
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}
