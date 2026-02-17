import { Auth0UserProfile } from "@mcp-ui/core/contracts";
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

  /**
   * Fetches the authenticated user's profile from Auth0's userinfo endpoint
   * @param accessToken - The user's access token
   * @returns The user's profile information
   */
  public static async getUserProfile(
    accessToken: string
  ): Promise<Auth0UserProfile> {
    const userInfoUrl = `https://${environment.AUTH0_DOMAIN}/userinfo`;

    logger.debug({ url: userInfoUrl }, "Fetching user profile from Auth0");

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
