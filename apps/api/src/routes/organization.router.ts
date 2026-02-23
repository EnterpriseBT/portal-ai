import { Router, Request, Response, NextFunction } from "express";
import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { ApplicationService } from "../services/application.service.js";
import { DbService } from "../services/db.service.js";
import type { OrganizationGetResponse } from "@mcp-ui/core/contracts";

const logger = createLogger({ module: "organization" });

export const organizationRouter = Router();

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
