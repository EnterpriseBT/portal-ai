import { Router, Request, Response, NextFunction } from "express";
import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { ApplicationService } from "../services/application.service.js";
import { DbService } from "../services/db.service.js";
import type { OrganizationGetResponse } from "@portalai/core/contracts";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";

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
/**
 * @openapi
 * /api/organization/{id}:
 *   patch:
 *     tags:
 *       - Organization
 *     summary: Update organization settings
 *     description: Updates organization fields. Currently supports setting defaultStationId.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               defaultStationId:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Organization updated
 *       404:
 *         description: Organization or station not found
 *       500:
 *         description: Internal server error
 */
organizationRouter.patch(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { organizationId, userId } = req.application!.metadata;

      // Only allow users to update their current org
      if (id !== organizationId) {
        return next(
          new ApiError(404, ApiCode.ORGANIZATION_NOT_FOUND, "Organization not found")
        );
      }

      const { defaultStationId } = req.body as { defaultStationId?: string | null };

      if (defaultStationId !== undefined && defaultStationId !== null) {
        // Validate the station belongs to this org
        const station = await DbService.repository.stations.findById(defaultStationId);
        if (!station || station.organizationId !== organizationId) {
          return next(
            new ApiError(404, ApiCode.STATION_NOT_FOUND, "Station not found or does not belong to this organization")
          );
        }
      }

      const organization = await DbService.repository.organizations.update(
        id,
        { defaultStationId: defaultStationId ?? null, updated: Date.now(), updatedBy: userId } as never
      );

      return HttpService.success(res, { organization });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to update organization"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.ORGANIZATION_FETCH_FAILED, error instanceof Error ? error.message : "Failed to update organization"));
    }
  }
);

organizationRouter.get(
  "/current",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth0Id = req.auth?.payload.sub as string;
      logger.info({ auth0Id }, "GET /api/organization/current called");

      const user = await DbService.repository.users.findByAuth0Id(auth0Id).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.ORGANIZATION_FETCH_FAILED, error instanceof Error ? error.message : "Failed to fetch user");
      });
      if (!user) {
        return next(
          new ApiError(
            404,
            ApiCode.ORGANIZATION_USER_NOT_FOUND,
            "User not found"
          )
        );
      }

      const result = await ApplicationService.getCurrentOrganization(user.id).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.ORGANIZATION_FETCH_FAILED, error instanceof Error ? error.message : "Failed to fetch current organization");
      });
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
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.ORGANIZATION_FETCH_FAILED, error instanceof Error ? error.message : "Failed to fetch current organization"));
    }
  }
);
