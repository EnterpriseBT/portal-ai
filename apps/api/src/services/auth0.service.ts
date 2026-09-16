import { Auth0UserProfile } from "@portalai/core/contracts";
import { environment } from "../environment.js";
import { createLogger } from "../utils/logger.util.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";

const logger = createLogger({ module: "auth0-service" });

export class Auth0Service {
  /**
   * Checks whether the Authorization header contains a Bearer token.
   * @param authorization - The raw Authorization header value
   * @returns true if a Bearer token is present
   */
  public static hasAccessToken(authorization: string | undefined): boolean {
    return !!authorization && authorization.startsWith("Bearer ");
  }

  /**
   * Extracts the access token from the Authorization header.
   * Throws an ApiError if the header is missing or malformed.
   * @param authorization - The raw Authorization header value
   * @returns The bare access token string
   */
  public static getAccessToken(authorization: string | undefined): string {
    if (!Auth0Service.hasAccessToken(authorization)) {
      logger.error("Missing or malformed Authorization header");
      throw new ApiError(
        401,
        ApiCode.PROFILE_MISSING_TOKEN,
        "Missing or malformed access token"
      );
    }
    return authorization!.substring(7);
  }

  /** issuer → resolved userinfo endpoint (OIDC discovery cache, #577). */
  private static discoveryCache = new Map<string, string>();

  /** The default Auth0 issuer (`iss` claim carries the trailing slash). */
  private static defaultAuth0Issuer(): string {
    return `https://${environment.AUTH0_DOMAIN}/`;
  }

  /**
   * Resolve an issuer's `userinfo` endpoint from its OIDC discovery document
   * (`/.well-known/openid-configuration`), cached per issuer. Used for
   * non-Auth0 (self-hosted / enterprise) issuers under #577.
   */
  private static async resolveUserinfoEndpoint(
    issuer: string
  ): Promise<string> {
    const cached = Auth0Service.discoveryCache.get(issuer);
    if (cached) return cached;

    const url = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
    const response = await globalThis.fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      throw new ApiError(
        response.status,
        ApiCode.AUTH_UPSTREAM_ERROR,
        `Failed to fetch OIDC discovery for ${issuer}: ${response.status}`
      );
    }
    const doc = (await response.json()) as { userinfo_endpoint?: string };
    if (!doc.userinfo_endpoint) {
      throw new ApiError(
        502,
        ApiCode.AUTH_UPSTREAM_ERROR,
        `OIDC discovery for ${issuer} has no userinfo_endpoint`
      );
    }
    Auth0Service.discoveryCache.set(issuer, doc.userinfo_endpoint);
    return doc.userinfo_endpoint;
  }

  /**
   * Fetches the authenticated user's profile from the issuer's userinfo
   * endpoint. When `issuer` is omitted or is the default Auth0 issuer, hits the
   * known Auth0 `userinfo` directly (no discovery round-trip); a non-Auth0
   * issuer resolves its endpoint via OIDC discovery (#577).
   * @param accessToken - The user's access token
   * @param issuer - The token's `iss` claim (optional; defaults to Auth0)
   * @returns The user's profile information
   */
  public static async getAuth0UserProfile(
    accessToken: string,
    issuer?: string
  ): Promise<Auth0UserProfile> {
    const userInfoUrl =
      !issuer || issuer === Auth0Service.defaultAuth0Issuer()
        ? `https://${environment.AUTH0_DOMAIN}/userinfo`
        : await Auth0Service.resolveUserinfoEndpoint(issuer);

    logger.debug({ url: userInfoUrl }, "Fetching user profile");

    const response = await globalThis.fetch(userInfoUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        },
        "Failed to fetch user profile from Auth0"
      );
      throw new ApiError(
        response.status,
        ApiCode.AUTH_UPSTREAM_ERROR,
        `Failed to fetch user profile: ${response.status} ${response.statusText}`
      );
    }

    const userProfile = (await response.json()) as Auth0UserProfile;
    logger.info({ sub: userProfile.sub }, "Successfully fetched user profile");

    return userProfile;
  }
}
