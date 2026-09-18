import { Router, Request, Response, NextFunction } from "express";

import {
  ConnectorConfigResponseSchema,
  type ConnectorConfigResponse,
} from "@portalai/core/contracts";

import { ConnectorConfigService } from "../services/connector-config.service.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "connector-config" });

export const connectorConfigRouter = Router();

/**
 * @openapi
 * /api/connector-config:
 *   get:
 *     tags:
 *       - Connector Config
 *     summary: Public connector client config (runtime)
 *     description: >
 *       Returns the app's **public** connector client config (Google OAuth
 *       client id, Picker browser API key, Cloud project number), so the SPA
 *       configures connector clients at runtime rather than from build-time
 *       `VITE_*` values — letting a prebuilt image serve a self-hosted
 *       install's own (BYO) config. Non-secret only; the OAuth client secret
 *       is never included. `google` is null when the install has no complete
 *       Google config (the picker UI then stays disabled). Authenticated —
 *       served only to signed-in users.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Connector config
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/ConnectorConfigResponse'
 *       401:
 *         description: Unauthorized - Invalid or missing JWT token
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
connectorConfigRouter.get(
  "/",
  (_req: Request, res: Response, next: NextFunction) => {
    try {
      const config = ConnectorConfigService.getConnectorConfig();

      // Re-validate on the way out — a shape/secret leak is a 500, not a
      // silent send (mirrors the site-config contract guard).
      const parsed = ConnectorConfigResponseSchema.safeParse(config);
      if (!parsed.success) {
        logger.error(
          { issues: parsed.error.issues },
          "Connector config failed its own contract on the way out"
        );
        return next(
          new ApiError(
            500,
            ApiCode.CONNECTOR_CONFIG_FETCH_FAILED,
            "Connector config failed validation"
          )
        );
      }

      res.setHeader("Cache-Control", "private, max-age=60");
      return HttpService.success<ConnectorConfigResponse>(res, parsed.data);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to assemble connector config"
      );
      return next(
        new ApiError(
          500,
          ApiCode.CONNECTOR_CONFIG_FETCH_FAILED,
          "Failed to assemble connector config"
        )
      );
    }
  }
);
