import { Router, Request, Response, NextFunction } from "express";
import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { ApplicationService } from "../services/application.service.js";
import { DbService } from "../services/db.service.js";
import type { OrganizationGetResponse } from "@mcp-ui/core/contracts";

const logger = createLogger({ module: "organization" });

export const organizationRouter = Router();

/**
 * @openapi
 * /api/organization/current:
 *   get:
 *     tags:
 *       - Organization
 *     summary: Get current organization
 *     description: Returns the authenticated user's most recently logged-into organization, determined by the latest lastLogin timestamp on the organization_users join record.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current organization retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   type: object
 *                   properties:
 *                     organization:
 *                       $ref: '#/components/schemas/Organization'
 *       404:
 *         description: User or organization not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
organizationRouter.get(
  "/current",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth0Id = req.auth?.payload.sub as string;
      logger.info({ auth0Id }, "GET /api/organization/current called");

      const user = await DbService.repository.users.findByAuth0Id(auth0Id);
      if (!user) {
        return next(
          new ApiError(
            404,
            ApiCode.ORGANIZATION_USER_NOT_FOUND,
            "User not found"
          )
        );
      }

      const result = await ApplicationService.getCurrentOrganization(user.id);
      if (!result) {
        return next(
          new ApiError(
            404,
            ApiCode.ORGANIZATION_NOT_FOUND,
            "No organization found for user"
          )
        );
      }

      return HttpService.success<OrganizationGetResponse>(res, {
        organization: result.organization,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to fetch current organization"
      );

      if (error instanceof ApiError) {
        return next(error);
      }
      return next(
        new ApiError(
          500,
          ApiCode.ORGANIZATION_FETCH_FAILED,
          "Failed to fetch current organization"
        )
      );
    }
  }
);
