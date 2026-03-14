import { Router, Request, Response, NextFunction } from "express";
import { createLogger } from "../utils/logger.util.js";
import { Auth0Service } from "../services/auth0.service.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import {
  Auth0UserProfileGetResponse,
  Auth0UserProfileSchema,
} from "@portalai/core/contracts";
import { usersRepo } from "../db/repositories/users.repository.js";

const logger = createLogger({ module: "profile" });

export const profileRouter = Router();

/**
 * Validation middleware — ensures the Authorization header contains a Bearer token.
 */
function validateProfileRequest(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  if (!Auth0Service.hasAccessToken(req.headers.authorization)) {
    return next(
      new ApiError(
        401,
        ApiCode.PROFILE_MISSING_TOKEN,
        "Missing or malformed access token"
      )
    );
  }
  next();
}

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
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
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
profileRouter.get(
  "/",
  validateProfileRequest,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info({ userId: req.auth?.payload.sub }, "GET /api/profile called");

      const accessToken = Auth0Service.getAccessToken(
        req.headers.authorization
      );
      const profile = await Auth0Service.getAuth0UserProfile(accessToken).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.PROFILE_FETCH_FAILED, error instanceof Error ? error.message : "Failed to fetch profile from Auth0");
      });
      const validatedProfile = Auth0UserProfileSchema.safeParse(profile);
      if (!validatedProfile.success) {
        return next(
          new ApiError(
            500,
            ApiCode.PROFILE_INVALID_RESPONSE,
            "Malformed profile response from Auth0"
          )
        );
      }

      logger.info(
        { userId: validatedProfile.data.sub },
        "User retrieved their profile information"
      );

      const user = await usersRepo
        .findByAuth0Id(validatedProfile.data.sub)
        .catch((error) => {
          if (error instanceof ApiError) throw error;
          throw new ApiError(500, ApiCode.PROFILE_USER_NOT_FOUND, error instanceof Error ? error.message : "Failed to fetch user from database");
        });

      return HttpService.success<Auth0UserProfileGetResponse>(res, {
        profile: validatedProfile.data,
        lastLogin: user?.lastLogin ?? null,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to fetch user profile"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.PROFILE_FETCH_FAILED, error instanceof Error ? error.message : "Failed to fetch user profile"));
    }
  }
);
