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
import { DbService } from "../services/db.service.js";
import {
  GoogleAuthError,
  GoogleAuthService,
} from "../services/google-auth.service.js";
import { GoogleSheetsConnectorService } from "../services/google-sheets-connector.service.js";
import { renderOAuthCallbackHtml } from "../utils/oauth-callback-html.util.js";
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
        .send(
          renderOAuthCallbackHtml({
            slug: "google-sheets",
            connectorInstanceId: result.connectorInstanceId,
            accountInfo: result.accountInfo,
          })
        );
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * Resolve a `connectorInstanceId` to an owned `ConnectorInstance` row.
 * Used by every Phase B/D route that operates on a specific instance.
 *
 * - Throws 404 when the row doesn't exist (or has been soft-deleted).
 * - Throws 403 when the row exists but belongs to a different org.
 * - Returns the decrypted-credentials row otherwise.
 */
async function resolveOwnedInstance(
  connectorInstanceId: string,
  organizationId: string
) {
  const instance =
    await DbService.repository.connectorInstances.findById(
      connectorInstanceId
    );
  if (!instance) {
    throw new ApiError(
      404,
      ApiCode.CONNECTOR_INSTANCE_NOT_FOUND,
      "Connector instance not found"
    );
  }
  if (instance.organizationId !== organizationId) {
    throw new ApiError(
      403,
      ApiCode.CONNECTOR_INSTANCE_NOT_FOUND,
      "Connector instance not accessible to this organization"
    );
  }
  return instance;
}

/** Map upstream GoogleAuthError kinds to ApiError responses. */
function mapGoogleAuthError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (
    err instanceof GoogleAuthError ||
    (err as Error).name === "GoogleAuthError"
  ) {
    const kind = (err as GoogleAuthError).kind;
    const message = (err as Error).message;
    switch (kind) {
      case "refresh_failed":
        return new ApiError(
          502,
          ApiCode.GOOGLE_OAUTH_REFRESH_FAILED,
          message
        );
      case "listSheets_failed":
        return new ApiError(502, ApiCode.GOOGLE_SHEETS_LIST_FAILED, message);
      case "fetchSheet_failed":
        return new ApiError(502, ApiCode.GOOGLE_SHEETS_FETCH_FAILED, message);
      case "userinfo_failed":
        return new ApiError(
          502,
          ApiCode.GOOGLE_OAUTH_USERINFO_FAILED,
          message
        );
      case "exchange_failed":
        return new ApiError(
          502,
          ApiCode.GOOGLE_OAUTH_EXCHANGE_FAILED,
          message
        );
      default:
        return new ApiError(502, ApiCode.GOOGLE_SHEETS_LIST_FAILED, message);
    }
  }
  return new ApiError(
    500,
    ApiCode.GOOGLE_SHEETS_LIST_FAILED,
    err instanceof Error ? err.message : "Unknown error"
  );
}

/**
 * @openapi
 * /api/connectors/google-sheets/sheets:
 *   get:
 *     tags: [Google Sheets Connector]
 *     summary: List the user's spreadsheets via Drive's files.list
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: connectorInstanceId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: pageToken
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Sheets listed
 *       400:
 *         description: connectorInstanceId missing
 *       403:
 *         description: Instance belongs to a different organization
 *       404:
 *         description: Instance not found
 *       502:
 *         description: Google rejected the listing or refresh
 */
googleSheetsConnectorRouter.get(
  "/sheets",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.application?.metadata
        .organizationId as string;
      const connectorInstanceId =
        typeof req.query.connectorInstanceId === "string"
          ? req.query.connectorInstanceId
          : "";
      if (!connectorInstanceId) {
        return next(
          new ApiError(
            400,
            ApiCode.GOOGLE_SHEETS_INVALID_INSTANCE_ID,
            "connectorInstanceId query parameter is required"
          )
        );
      }
      const search =
        typeof req.query.search === "string" ? req.query.search : "";
      const pageToken =
        typeof req.query.pageToken === "string"
          ? req.query.pageToken
          : undefined;

      await resolveOwnedInstance(connectorInstanceId, organizationId);

      const result = await GoogleSheetsConnectorService.listSheets({
        connectorInstanceId,
        search,
        pageToken,
      });

      return HttpService.success(res, result);
    } catch (err) {
      return next(mapGoogleAuthError(err));
    }
  }
);

/**
 * @openapi
 * /api/connectors/google-sheets/instances/{id}/select-sheet:
 *   post:
 *     tags: [Google Sheets Connector]
 *     summary: Pick a spreadsheet to import + cache its parsed workbook
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [spreadsheetId]
 *             properties:
 *               spreadsheetId: { type: string }
 *     responses:
 *       200:
 *         description: Sheet selected; preview returned
 *       400:
 *         description: Missing spreadsheetId
 *       404:
 *         description: Connector instance not found
 *       502:
 *         description: Google Sheets fetch failed
 */
googleSheetsConnectorRouter.post(
  "/instances/:id/select-sheet",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.application?.metadata
        .organizationId as string;
      const userId = req.application?.metadata.userId as string;
      const connectorInstanceId = req.params.id ?? "";
      const spreadsheetId =
        typeof req.body?.spreadsheetId === "string"
          ? req.body.spreadsheetId
          : "";
      if (!spreadsheetId) {
        return next(
          new ApiError(
            400,
            ApiCode.GOOGLE_SHEETS_INVALID_PAYLOAD,
            "spreadsheetId is required"
          )
        );
      }

      await resolveOwnedInstance(connectorInstanceId, organizationId);

      const result = await GoogleSheetsConnectorService.selectSheet({
        connectorInstanceId,
        spreadsheetId,
        organizationId,
        userId,
      });
      return HttpService.success(res, result);
    } catch (err) {
      return next(mapGoogleAuthError(err));
    }
  }
);

/**
 * @openapi
 * /api/connectors/google-sheets/instances/{id}/sheet-slice:
 *   get:
 *     tags: [Google Sheets Connector]
 *     summary: Fetch a cell rectangle from the cached workbook
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: sheetId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: rowStart
 *         required: true
 *         schema: { type: integer, minimum: 0 }
 *       - in: query
 *         name: rowEnd
 *         required: true
 *         schema: { type: integer, minimum: 0 }
 *       - in: query
 *         name: colStart
 *         required: true
 *         schema: { type: integer, minimum: 0 }
 *       - in: query
 *         name: colEnd
 *         required: true
 *         schema: { type: integer, minimum: 0 }
 */
googleSheetsConnectorRouter.get(
  "/instances/:id/sheet-slice",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.application?.metadata
        .organizationId as string;
      const connectorInstanceId = req.params.id ?? "";

      const sheetIdParam =
        typeof req.query.sheetId === "string" ? req.query.sheetId : "";
      const rowStart = parseIntStrict(req.query.rowStart);
      const rowEnd = parseIntStrict(req.query.rowEnd);
      const colStart = parseIntStrict(req.query.colStart);
      const colEnd = parseIntStrict(req.query.colEnd);

      if (
        !sheetIdParam ||
        rowStart === undefined ||
        rowEnd === undefined ||
        colStart === undefined ||
        colEnd === undefined
      ) {
        return next(
          new ApiError(
            400,
            ApiCode.GOOGLE_SHEETS_INVALID_PAYLOAD,
            "sheetId, rowStart, rowEnd, colStart, and colEnd are required"
          )
        );
      }

      await resolveOwnedInstance(connectorInstanceId, organizationId);

      const out = await GoogleSheetsConnectorService.sheetSlice({
        connectorInstanceId,
        sheetId: sheetIdParam,
        rowStart,
        rowEnd,
        colStart,
        colEnd,
      });
      return HttpService.success(res, out);
    } catch (err) {
      return next(mapGoogleAuthError(err));
    }
  }
);

function parseIntStrict(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  if (!/^-?\d+$/.test(value)) return undefined;
  return parseInt(value, 10);
}

