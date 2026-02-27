import { Router, Request, Response, NextFunction } from "express";
import { HealthGetResponse } from "@mcp-ui/core/contracts";
import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";

const logger = createLogger({ module: "health" });

export const healthRouter = Router();

/**
 * @openapi
 * /api/health:
 *   get:
 *     tags:
 *       - Health
 *     summary: Health check endpoint
 *     description: Returns the current health status of the API server
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 */
healthRouter.get("/", (_req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info("GET /api/health called");

    const payload: HealthGetResponse = {
      timestamp: new Date().toISOString(),
    };

    logger.info("Health check OK");
    return HttpService.success(res, payload);
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : "Unknown error" },
      "Health check failed"
    );
    return next(
      new ApiError(500, ApiCode.HEALTH_CHECK_FAILED, "Health check failed")
    );
  }
});
