/**
 * Microsoft 365 Excel connector — OAuth2 dance routes (Phase A).
 *
 * Authorize is JWT-protected (the user is logged into Portal.ai when
 * they trigger the popup). Callback is JWT-unprotected — Microsoft's
 * redirect doesn't carry a Bearer token; the signed `state` token is
 * the security boundary instead. Two routers in this file mirror the
 * google-sheets pattern.
 *
 * See `docs/MICROSOFT_EXCEL_CONNECTOR.phase-A.plan.md` §Slice 7.
 */

import { Router, type Request, type Response, type NextFunction } from "express";

import { ApiCode } from "../constants/api-codes.constants.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { ApiError, HttpService } from "../services/http.service.js";
import {
  MicrosoftAuthError,
  MicrosoftAuthService,
} from "../services/microsoft-auth.service.js";
import { MicrosoftExcelConnectorService } from "../services/microsoft-excel-connector.service.js";
import { renderOAuthCallbackHtml } from "../utils/oauth-callback-html.util.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "microsoft-excel-connector" });

export const microsoftExcelConnectorRouter = Router();
export const microsoftExcelConnectorPublicRouter = Router();

/**
 * @openapi
 * /api/connectors/microsoft-excel/authorize:
 *   post:
 *     tags: [Microsoft Excel Connector]
 *     summary: Mint a Microsoft identity-platform v2.0 consent URL
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Consent URL minted
 *       500:
 *         description: Microsoft OAuth env vars are not configured
 */
microsoftExcelConnectorRouter.post(
  "/authorize",
  getApplicationMetadata,
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.application?.metadata.userId as string;
      const organizationId = req.application?.metadata
        .organizationId as string;

      const url = MicrosoftAuthService.buildConsentUrl({
        userId,
        organizationId,
      });

      logger.info(
        { userId, organizationId },
        "Microsoft OAuth authorize URL minted"
      );
      return HttpService.success(res, { url });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (
        message.includes("MICROSOFT_OAUTH_CLIENT_ID") ||
        message.includes("MICROSOFT_OAUTH_REDIRECT_URI") ||
        message.includes("OAUTH_STATE_SECRET")
      ) {
        return next(
          new ApiError(
            500,
            ApiCode.MICROSOFT_OAUTH_NOT_CONFIGURED,
            "Microsoft OAuth is not configured for this environment"
          )
        );
      }
      return next(
        new ApiError(500, ApiCode.MICROSOFT_OAUTH_AUTHORIZE_FAILED, message)
      );
    }
  }
);

/**
 * @openapi
 * /api/connectors/microsoft-excel/callback:
 *   get:
 *     tags: [Microsoft Excel Connector]
 *     summary: OAuth2 callback (Microsoft redirects here)
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: state
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: OAuth completed; HTML response postMessages to opener
 *       400:
 *         description: Invalid or expired state
 *       502:
 *         description: Microsoft rejected the code or userinfo lookup failed
 */
microsoftExcelConnectorPublicRouter.get(
  "/callback",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      if (!code || !state) {
        return next(
          new ApiError(
            400,
            ApiCode.MICROSOFT_OAUTH_INVALID_STATE,
            "code and state query parameters are required"
          )
        );
      }

      const result = await MicrosoftExcelConnectorService.handleCallback({
        code,
        state,
      });

      logger.info(
        { connectorInstanceId: result.connectorInstanceId },
        "microsoft-excel OAuth callback completed"
      );
      return res
        .status(200)
        .type("html")
        .send(
          renderOAuthCallbackHtml({
            slug: "microsoft-excel",
            connectorInstanceId: result.connectorInstanceId,
            accountInfo: result.accountInfo,
          })
        );
    } catch (err) {
      return next(mapMicrosoftAuthError(err));
    }
  }
);

/** Map upstream MicrosoftAuthError kinds to ApiError responses. */
function mapMicrosoftAuthError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (
    err instanceof MicrosoftAuthError ||
    (err as Error)?.name === "MicrosoftAuthError"
  ) {
    const kind = (err as MicrosoftAuthError).kind;
    const message = (err as Error).message;
    switch (kind) {
      case "refresh_failed":
        return new ApiError(
          502,
          ApiCode.MICROSOFT_OAUTH_REFRESH_FAILED,
          message
        );
      case "userinfo_failed":
        return new ApiError(
          502,
          ApiCode.MICROSOFT_OAUTH_USERINFO_FAILED,
          message
        );
      case "no_refresh_token":
        return new ApiError(
          502,
          ApiCode.MICROSOFT_OAUTH_NO_REFRESH_TOKEN,
          message
        );
      case "exchange_failed":
        return new ApiError(
          502,
          ApiCode.MICROSOFT_OAUTH_EXCHANGE_FAILED,
          message
        );
      default:
        return new ApiError(
          502,
          ApiCode.MICROSOFT_OAUTH_EXCHANGE_FAILED,
          message
        );
    }
  }
  return new ApiError(
    500,
    ApiCode.MICROSOFT_OAUTH_AUTHORIZE_FAILED,
    err instanceof Error ? err.message : "Unknown error"
  );
}
