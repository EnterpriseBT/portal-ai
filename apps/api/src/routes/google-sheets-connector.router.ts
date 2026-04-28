/**
 * Google Sheets connector — OAuth2 dance routes.
 *
 * Phase A: authorize + callback. The frontend opens the consent URL in a
 * popup; Google redirects to the callback with `code+state`; we exchange,
 * fetch the user's email, and persist a pending `ConnectorInstance`.
 *
 * Authorize is JWT-protected (the user is logged into Portal.ai when they
 * trigger the popup). Callback is JWT-unprotected — Google's redirect
 * doesn't carry a Bearer token; the signed `state` token is the security
 * boundary instead. Hence two routers in this file: `googleSheetsConnectorRouter`
 * (mounted under `protectedRouter`) and `googleSheetsConnectorPublicRouter`
 * (mounted directly on the app).
 *
 * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-A.plan.md` §Slices 7-8.
 */

import { Router, type Request, type Response, type NextFunction } from "express";

import { ApiCode } from "../constants/api-codes.constants.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { ApiError, HttpService } from "../services/http.service.js";
import { GoogleAuthService } from "../services/google-auth.service.js";
import { GoogleSheetsConnectorService } from "../services/google-sheets-connector.service.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "google-sheets-connector" });

export const googleSheetsConnectorRouter = Router();
export const googleSheetsConnectorPublicRouter = Router();

/**
 * @openapi
 * /api/connectors/google-sheets/authorize:
 *   post:
 *     tags: [Google Sheets Connector]
 *     summary: Mint a Google OAuth2 consent URL
 *     description: |
 *       Returns a Google consent URL the frontend opens in a popup.
 *       The URL embeds a signed `state` token bound to the requester
 *       so the callback can't be replayed by another user/org.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Consent URL minted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 payload:
 *                   type: object
 *                   properties:
 *                     url: { type: string }
 *       500:
 *         description: Google OAuth env vars are not configured
 */
googleSheetsConnectorRouter.post(
  "/authorize",
  getApplicationMetadata,
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.application?.metadata.userId as string;
      const organizationId = req.application?.metadata
        .organizationId as string;

      const url = GoogleAuthService.buildConsentUrl({
        userId,
        organizationId,
      });

      logger.info({ userId, organizationId }, "Google OAuth authorize URL minted");
      return HttpService.success(res, { url });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      // `buildConsentUrl` throws plain Errors when env vars are empty —
      // surface those as a configuration error, not a generic 500.
      if (
        message.includes("GOOGLE_OAUTH_CLIENT_ID") ||
        message.includes("GOOGLE_OAUTH_REDIRECT_URI") ||
        message.includes("OAUTH_STATE_SECRET")
      ) {
        return next(
          new ApiError(
            500,
            ApiCode.GOOGLE_OAUTH_NOT_CONFIGURED,
            "Google OAuth is not configured for this environment"
          )
        );
      }
      return next(
        new ApiError(500, ApiCode.GOOGLE_OAUTH_AUTHORIZE_FAILED, message)
      );
    }
  }
);

/**
 * @openapi
 * /api/connectors/google-sheets/callback:
 *   get:
 *     tags: [Google Sheets Connector]
 *     summary: OAuth2 callback (Google redirects here)
 *     description: |
 *       Verifies the signed `state` token, exchanges the auth code for a
 *       refresh token, fetches the user's email, and persists (or updates)
 *       the pending `ConnectorInstance`. Returns HTML that postMessages the
 *       result to the popup opener and closes the popup.
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
 *         description: Google rejected the code or userinfo lookup failed
 */
googleSheetsConnectorPublicRouter.get(
  "/callback",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      if (!code || !state) {
        return next(
          new ApiError(
            400,
            ApiCode.GOOGLE_OAUTH_INVALID_STATE,
            "code and state query parameters are required"
          )
        );
      }

      const result = await GoogleSheetsConnectorService.handleCallback({
        code,
        state,
      });

      logger.info(
        { connectorInstanceId: result.connectorInstanceId },
        "Google Sheets OAuth callback completed"
      );
      return res
        .status(200)
        .type("html")
        .send(renderCallbackHtml(result.connectorInstanceId, result.accountInfo));
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * Minimal HTML the popup serves on success. `postMessage`s the result to
 * `window.opener` and closes itself. The `accountInfo` matches the shape
 * the redacted connector-instance API returns, so the workflow can render
 * the chip immediately without an extra fetch.
 *
 * Origin restriction is intentionally `*` for v1 — the popup window is
 * controlled by us and the message contains no secrets (just an instance
 * id and the public account email). When Phase C wires the workflow, we
 * can tighten to a specific origin once the prod web app's domain is
 * known to the API process.
 */
function renderCallbackHtml(
  connectorInstanceId: string,
  accountInfo: unknown
): string {
  const payload = JSON.stringify({
    type: "google-sheets-authorized",
    connectorInstanceId,
    accountInfo,
  });
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Google Sheets connected</title></head>
<body><script>
(function () {
  var payload = ${payload};
  if (window.opener) {
    try { window.opener.postMessage(payload, "*"); } catch (e) {}
  }
  window.close();
})();
</script>
<p>Connected. You can close this window.</p>
<p data-testid="connector-instance-id" hidden>${connectorInstanceId}</p>
</body></html>`;
}
