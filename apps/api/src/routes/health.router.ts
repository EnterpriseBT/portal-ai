import { Router } from "express";
import { ApiResponseStatus, ApiGetHealthResponse } from "@mcp-ui/core/api";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "health" });

export const healthRouter = Router();

/**
 * @openapi
 * /health:
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
healthRouter.get("/", (_req, res) => {
  logger.debug("Health check requested");

  const response: ApiGetHealthResponse = {
    status: ApiResponseStatus.OK,
    timestamp: new Date().toISOString(),
  };

  res.json(response);
});
