import { Router } from "express";
import {
  ApiGetProfileResponse,
  ApiResponseStatus,
  ApiErrorResponse,
} from "@mcp-ui/types";
import { createLogger } from "../utils/logger.util.js";
import { getUserProfile } from "../services/auth0.service.js";

const logger = createLogger({ module: "profile" });

export const profileRouter = Router();

/**
 * @openapi
 * /api/profile:
 *   get:
 *     tags:
 *       - Profile
 *     summary: Get authenticated user profile
 *     description: Returns the authenticated user's complete profile information from Auth0, including name, email, picture, and other profile details
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: OK
 *                 data:
 *                   $ref: '#/components/schemas/UserProfile'
 *       401:
 *         description: Unauthorized - Invalid or missing JWT token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       500:
 *         description: Internal server error - Failed to fetch user profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
profileRouter.get("/", async (req, res) => {
  try {
    // Extract the access token from the Authorization header
    const authHeader = req.headers.authorization as string;
    const accessToken = authHeader.substring(7); // Remove "Bearer " prefix
    const userProfile = await getUserProfile(accessToken);

    logger.info(
      { userId: userProfile.sub },
      "User retrieved their profile information"
    );

    const response: ApiGetProfileResponse = {
      status: ApiResponseStatus.OK,
      profile: userProfile,
    };
    res.json(response);
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : "Unknown error" },
      "Failed to fetch user profile"
    );

    const errorResponse: ApiErrorResponse = {
      status: ApiResponseStatus.ERROR,
      message: "Failed to fetch user profile",
      code: "PG001",
    };

    res.status(500).json(errorResponse);
  }
});
