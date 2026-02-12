import { Auth0UserProfile } from "@mcp-ui/types";
import { environment } from "../environment.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "auth0-service" });

/**
 * Fetches the authenticated user's profile from Auth0's userinfo endpoint
 * @param accessToken - The user's access token
 * @returns The user's profile information
 */
export async function getUserProfile(
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
    throw new Error(
      `Failed to fetch user profile: ${response.status} ${response.statusText}`
    );
  }

  const userProfile = (await response.json()) as Auth0UserProfile;
  logger.debug({ sub: userProfile.sub }, "Successfully fetched user profile");

  return userProfile;
}
