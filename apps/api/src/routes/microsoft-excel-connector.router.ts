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
import { DbService } from "../services/db.service.js";
import {
  MicrosoftAuthError,
  MicrosoftAuthService,
} from "../services/microsoft-auth.service.js";
import { MicrosoftExcelConnectorService } from "../services/microsoft-excel-connector.service.js";
import { MicrosoftGraphError } from "../services/microsoft-graph.service.js";
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

/**
 * Resolve a `connectorInstanceId` to an owned `ConnectorInstance` row.
 *   - 404 when the row is missing or soft-deleted.
 *   - 403 when the row exists but belongs to a different organization.
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

/** Map Graph errors that escape past the service layer. */
function mapMicrosoftGraphError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (
    err instanceof MicrosoftGraphError ||
    (err as Error)?.name === "MicrosoftGraphError"
  ) {
    const kind = (err as MicrosoftGraphError).kind;
    const message = (err as Error).message;
    const details = (err as MicrosoftGraphError).details;
    switch (kind) {
      case "file_too_large":
        return new ApiError(
          413,
          ApiCode.MICROSOFT_EXCEL_FILE_TOO_LARGE,
          message,
          details
        );
      case "search_failed":
        return new ApiError(
          502,
          ApiCode.MICROSOFT_EXCEL_LIST_FAILED,
          message
        );
      case "head_failed":
      case "download_failed":
        return new ApiError(
          502,
          ApiCode.MICROSOFT_EXCEL_FETCH_FAILED,
          message
        );
      default:
        return new ApiError(
          502,
          ApiCode.MICROSOFT_EXCEL_FETCH_FAILED,
          message
        );
    }
  }
  return mapMicrosoftAuthError(err);
}

function parseIntStrict(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  if (!/^-?\d+$/.test(value)) return undefined;
  return parseInt(value, 10);
}

/**
 * @openapi
 * /api/connectors/microsoft-excel/workbooks:
 *   get:
 *     tags: [Microsoft Excel Connector]
 *     summary: List the user's .xlsx workbooks via Graph search
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
 *     responses:
 *       200: { description: Workbooks listed }
 *       400: { description: connectorInstanceId missing }
 *       403: { description: Instance belongs to a different organization }
 *       404: { description: Instance not found }
 *       502: { description: Graph rejected the listing or refresh }
 */
microsoftExcelConnectorRouter.get(
  "/workbooks",
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
            ApiCode.MICROSOFT_EXCEL_INVALID_INSTANCE_ID,
            "connectorInstanceId query parameter is required"
          )
        );
      }
      const search =
        typeof req.query.search === "string" ? req.query.search : "";

      await resolveOwnedInstance(connectorInstanceId, organizationId);

      const result = await MicrosoftExcelConnectorService.searchWorkbooks({
        connectorInstanceId,
        search,
      });
      return HttpService.success(res, result);
    } catch (err) {
      return next(mapMicrosoftGraphError(err));
    }
  }
);

/**
 * @openapi
 * /api/connectors/microsoft-excel/instances/{id}/select-workbook:
 *   post:
 *     tags: [Microsoft Excel Connector]
 *     summary: Pick a workbook to import + cache its parsed bytes
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
 *             required: [driveItemId]
 *             properties:
 *               driveItemId: { type: string }
 *     responses:
 *       200: { description: Workbook selected; preview returned }
 *       400: { description: Missing driveItemId }
 *       403: { description: Instance belongs to a different organization }
 *       404: { description: Connector instance not found }
 *       413: { description: Workbook exceeds the configured byte cap }
 *       415: { description: Only .xlsx workbooks are supported }
 *       502: { description: Microsoft Graph fetch failed }
 */
microsoftExcelConnectorRouter.post(
  "/instances/:id/select-workbook",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.application?.metadata
        .organizationId as string;
      const userId = req.application?.metadata.userId as string;
      const connectorInstanceId = req.params.id ?? "";
      const driveItemId =
        typeof req.body?.driveItemId === "string"
          ? req.body.driveItemId
          : "";
      if (!driveItemId) {
        return next(
          new ApiError(
            400,
            ApiCode.MICROSOFT_EXCEL_INVALID_PAYLOAD,
            "driveItemId is required"
          )
        );
      }

      await resolveOwnedInstance(connectorInstanceId, organizationId);

      const result = await MicrosoftExcelConnectorService.selectWorkbook({
        connectorInstanceId,
        driveItemId,
        organizationId,
        userId,
      });
      return HttpService.success(res, result);
    } catch (err) {
      return next(mapMicrosoftGraphError(err));
    }
  }
);

/**
 * @openapi
 * /api/connectors/microsoft-excel/instances/{id}/sheet-slice:
 *   get:
 *     tags: [Microsoft Excel Connector]
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
microsoftExcelConnectorRouter.get(
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
            ApiCode.MICROSOFT_EXCEL_INVALID_PAYLOAD,
            "sheetId, rowStart, rowEnd, colStart, and colEnd are required"
          )
        );
      }

      await resolveOwnedInstance(connectorInstanceId, organizationId);

      const out = await MicrosoftExcelConnectorService.sheetSlice({
        connectorInstanceId,
        sheetId: sheetIdParam,
        rowStart,
        rowEnd,
        colStart,
        colEnd,
      });
      return HttpService.success(res, out);
    } catch (err) {
      return next(mapMicrosoftGraphError(err));
    }
  }
);
