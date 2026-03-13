import type { Request, Response, NextFunction } from "express";

import { ApplicationService } from "../services/application.service.js";
import { DbService } from "../services/db.service.js";
import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "metadata-middleware" });

/**
 * Middleware that resolves the authenticated Auth0 user and their current
 * organization, then attaches both IDs to `req.application.metadata`.
 *
 * Must run after `jwtCheck` so that `req.auth` is populated.
 */
export const getApplicationMetadata = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const auth0Id = req.auth?.payload.sub;
    if (!auth0Id) {
      return next(
        new ApiError(
          401,
          ApiCode.METADATA_MISSING_AUTH,
          "Missing authentication subject"
        )
      );
    }

    const user = await DbService.repository.users.findByAuth0Id(auth0Id);
    if (!user) {
      return next(
        new ApiError(
          404,
          ApiCode.METADATA_USER_NOT_FOUND,
          "User not found"
        )
      );
    }

    const orgResult =
      await ApplicationService.getCurrentOrganization(user.id);
    if (!orgResult) {
      return next(
        new ApiError(
          404,
          ApiCode.METADATA_ORGANIZATION_NOT_FOUND,
          "Organization not found"
        )
      );
    }

    req.application = {
      metadata: {
        userId: user.id,
        organizationId: orgResult.organization.id,
      },
    };

    next();
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : "Unknown error" },
      "Failed to resolve application metadata"
    );
    return next(
      new ApiError(
        500,
        ApiCode.METADATA_FETCH_FAILED,
        "Failed to resolve application metadata"
      )
    );
  }
};
