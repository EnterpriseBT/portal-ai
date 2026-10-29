import type { Request } from "../types/request.js";
/**
 * Google Sheets connector — OAuth2 dance routes.
 *
 * Phase A: authorize + callback. The frontend opens the consent URL in a
 * popup; Google redirects to the callback with `code+state`; we exchange,
 * fetch the user's email, and persist a pending `ConnectorInstance`.
 *
 * Authorize is JWT-protected (the user is logged into Portals AI when they
 * trigger the popup). Callback is JWT-unprotected — Google's redirect
 * doesn't carry a Bearer token; the signed `state` token is the security
 * boundary instead. Hence two routers in this file: `googleSheetsConnectorRouter`
 * (mounted under `protectedRouter`) and `googleSheetsConnectorPublicRouter`
 * (mounted directly on the app).
 */

import { Router, type Response, type NextFunction } from "express";

import { ApiCode } from "../constants/api-codes.constants.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { ConnectorInstanceAccessService } from "../services/connector-instance-access.service.js";
import { ApiError, HttpService } from "../services/http.service.js";
import {
  GoogleAuthError,
  GoogleAuthService,
} from "../services/google-auth.service.js";
import { GoogleSheetsConnectorService } from "../services/google-sheets-connector.service.js";
import {
  oauthProviderError,
  sendOAuthCallbackFailurePage,
  sendOAuthCallbackPage,
} from "../utils/oauth-callback-html.util.js";
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
 *       403:
 *         description: The caller can't write the instance being reconnected, or (new connection) lacks permission to create connector instances (#685, #710)
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
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.application?.metadata.userId as string;
      const organizationId = req.application?.metadata.organizationId as string;
      // Reconnect flow passes the existing instance id in the body so
      // the callback can target THAT row instead of either minting a
      // new instance or picking one by email. Absent in the
      // "add connector" flow.
      const body = (req.body ?? {}) as { connectorInstanceId?: unknown };
      const connectorInstanceId =
        typeof body.connectorInstanceId === "string" &&
        body.connectorInstanceId.length > 0
          ? body.connectorInstanceId
          : undefined;

      // #685: reconnecting replaces the instance's credentials with the
      // caller's account, so it needs write on that instance.
      if (connectorInstanceId) {
        await ConnectorInstanceAccessService.load(
          req.application!.metadata,
          connectorInstanceId,
          "write"
        );
      } else {
        // #710: a new connection creates an instance, so it needs the
        // owned create. Refused here, before the consent redirect.
        await ConnectorInstanceAccessService.assertCanCreate(
          req.application!.metadata
        );
      }

      const url = GoogleAuthService.buildConsentUrl({
        userId,
        organizationId,
        ...(connectorInstanceId ? { connectorInstanceId } : {}),
      });

      logger.info(
        {
          userId,
          organizationId,
          connectorInstanceId: connectorInstanceId ?? null,
        },
        "Google OAuth authorize URL minted"
      );
      return HttpService.success(res, { url });
    } catch (err) {
      // #685: a refused or missing instance keeps its own status.
      if (err instanceof ApiError) return next(err);
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
 *       the pending `ConnectorInstance`.
 *
 *       Every outcome answers with an HTML page that postMessages to the
 *       popup's opener and closes the popup: `<slug>-authorized` on success,
 *       `<slug>-failed` with `{ code, message }` on any failure, at the
 *       failure's status (#924).
 *     parameters:
 *       - in: query
 *         name: code
 *         description: The authorization code. Absent when `error` is set.
 *         schema: { type: string }
 *       - in: query
 *         name: state
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: error
 *         description: |
 *           Set by Google instead of `code` when authorization didn't complete;
 *           `access_denied` means the user cancelled or declined consent.
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: OAuth completed; the page posts `<slug>-authorized` to the opener
 *         content:
 *           text/html:
 *             schema: { type: string }
 *       400:
 *         description: Consent declined (`GOOGLE_OAUTH_ACCESS_DENIED`), another provider error (`GOOGLE_OAUTH_PROVIDER_ERROR`), or an invalid or expired state; the page posts `<slug>-failed`
 *         content:
 *           text/html:
 *             schema: { type: string }
 *       403:
 *         description: The caller lost the permission to connect since authorize; the page posts `<slug>-failed`
 *         content:
 *           text/html:
 *             schema: { type: string }
 *       502:
 *         description: Google rejected the code or userinfo lookup failed; the page posts `<slug>-failed`
 *         content:
 *           text/html:
 *             schema: { type: string }
 */
googleSheetsConnectorPublicRouter.get(
  "/callback",
  async (req: Request, res: Response) => {
    try {
      // #924: the provider redirects with `error` instead of `code` when the
      // user cancels or consent fails; the popup still gets the page.
      const providerError =
        typeof req.query.error === "string" ? req.query.error : "";
      if (providerError) {
        return sendOAuthCallbackFailurePage(res, {
          slug: "google-sheets",
          error: oauthProviderError(providerError, {
            provider: "Google",
            accessDenied: ApiCode.GOOGLE_OAUTH_ACCESS_DENIED,
            providerError: ApiCode.GOOGLE_OAUTH_PROVIDER_ERROR,
          }),
        });
      }
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      if (!code || !state) {
        return sendOAuthCallbackFailurePage(res, {
          slug: "google-sheets",
          error: new ApiError(
            400,
            ApiCode.GOOGLE_OAUTH_INVALID_STATE,
            "code and state query parameters are required"
          ),
        });
      }

      const result = await GoogleSheetsConnectorService.handleCallback({
        code,
        state,
      });

      logger.info(
        { connectorInstanceId: result.connectorInstanceId },
        "Google Sheets OAuth callback completed"
      );
      return sendOAuthCallbackPage(res, {
        slug: "google-sheets",
        connectorInstanceId: result.connectorInstanceId,
        accountInfo: result.accountInfo,
      });
    } catch (err) {
      return sendOAuthCallbackFailurePage(res, {
        slug: "google-sheets",
        error: mapGoogleCallbackError(err),
      });
    }
  }
);

/**
 * Resolve a `connectorInstanceId` to an owned `ConnectorInstance` row.
 * Used by every Phase B/D route that operates on a specific instance.
 *
 * - Throws 404 when the row doesn't exist, has been soft-deleted, is in
 *   another org or isn't readable (one answer for each, #713/#743).
 * - Throws 403 when it's readable but a change needs write the caller lacks.
 * - Returns the decrypted-credentials row otherwise.
 */
async function resolveOwnedInstance(
  req: Request,
  connectorInstanceId: string,
  verb: "read" | "write"
) {
  // #685: the caller must be able to read the instance (404) and, for a
  // change, write it (403). Org scope alone let a member use another
  // member's stored OAuth token to fetch any file, and rewrite their config.
  const { instance } = await ConnectorInstanceAccessService.load(
    req.application!.metadata,
    connectorInstanceId,
    verb
  );
  return instance;
}

/**
 * The callback's refusal: an `ApiError` or `GoogleAuthError` maps as on every
 * other route, and anything else is the callback's own 500, not a list error.
 */
function mapGoogleCallbackError(err: unknown): ApiError {
  if (
    err instanceof ApiError ||
    err instanceof GoogleAuthError ||
    (err as Error)?.name === "GoogleAuthError"
  ) {
    return mapGoogleAuthError(err);
  }
  return new ApiError(
    500,
    ApiCode.GOOGLE_OAUTH_AUTHORIZE_FAILED,
    err instanceof Error ? err.message : "Unknown error"
  );
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
        return new ApiError(502, ApiCode.GOOGLE_OAUTH_REFRESH_FAILED, message);
      case "fetchSheet_failed":
        return new ApiError(502, ApiCode.GOOGLE_SHEETS_FETCH_FAILED, message);
      case "userinfo_failed":
        return new ApiError(502, ApiCode.GOOGLE_OAUTH_USERINFO_FAILED, message);
      case "exchange_failed":
        return new ApiError(502, ApiCode.GOOGLE_OAUTH_EXCHANGE_FAILED, message);
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
 *       403:
 *         description: The caller lacks permission on this object or it isn't theirs (#685)
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
      const organizationId = req.application?.metadata.organizationId as string;
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

      await resolveOwnedInstance(req, connectorInstanceId, "write");

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
 *     responses:
 *       200:
 *         description: The requested cell rectangle, clamped to the sheet
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SheetSliceResponse'
 *       400:
 *         description: Malformed or missing query params (`GOOGLE_SHEETS_INVALID_PAYLOAD`)
 *       404:
 *         description: >
 *           Unknown, unreadable or another organization's connector instance
 *           (`CONNECTOR_INSTANCE_NOT_FOUND`), no cached
 *           workbook (`FILE_UPLOAD_SESSION_NOT_FOUND`), or the rectangle falls
 *           outside the sheet (`FILE_UPLOAD_SLICE_OUT_OF_BOUNDS`)
 *       500:
 *         description: Unclassified failure from the Google auth/sheets mapper
 *       502:
 *         description: Upstream Google call failed (`GOOGLE_SHEETS_FETCH_FAILED`)
 */
googleSheetsConnectorRouter.get(
  "/instances/:id/sheet-slice",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
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

      await resolveOwnedInstance(req, connectorInstanceId, "read");

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
