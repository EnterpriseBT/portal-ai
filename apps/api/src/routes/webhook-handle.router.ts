/**
 * Third-party webhook handle access (#124) — the remote-transport surface for
 * the shared scaling substrate. A `streaming` custom tool is handed a scoped,
 * expiring token (see `webhook-read-token.service.ts`); the webhook server
 * calls back here to pull the dataset page-by-page. This is the **only**
 * endpoint authenticated to a third party — never the user's JWT.
 *
 *   - `GET  /api/webhook/handle/:handleId` — paged read (inbound pull-on-read).
 *   - `POST /api/webhook/handle/:sessionId` — stage a large result (outbound),
 *     write-scoped token; `produceFromRows` → `{ resultHandle }`.
 *
 * Auth: `Authorization: Bearer <token>`, validated fail-closed against the
 * token's `(organizationId, handleId|sessionId, mode)` scope, with a
 * defense-in-depth cross-check that the token's org matches the handle's
 * staged org. Single-target, org-scoped, short-TTL.
 */

import { Router, Request, Response, NextFunction } from "express";

import { ApiError, HttpService } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { PortalSqlHandleService } from "../services/portal-sql-handle.service.js";
import { WebhookReadTokenService } from "../services/webhook-read-token.service.js";

const MAX_PAGE = 5_000;

export const webhookHandleRouter = Router();

/** Extract a bearer token from the Authorization header (undefined if absent). */
function bearerToken(req: Request): string | undefined {
  const header = req.header("authorization") ?? req.header("Authorization");
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : undefined;
}

function parseQueryInt(raw: unknown, fallback: number): number {
  if (typeof raw === "string" && /^\d+$/.test(raw)) return parseInt(raw, 10);
  return fallback;
}

/**
 * @openapi
 * /api/webhook/handle/{handleId}:
 *   get:
 *     tags:
 *       - Webhook compute scaling
 *     summary: Paged read of a query handle by a third-party webhook (#124)
 *     description: >
 *       Pull-on-read for a `streaming` custom webhook tool. Authenticated by
 *       the scoped, expiring token the runtime minted for this call (NOT the
 *       user JWT), validated against the token's `(organizationId, handleId,
 *       read)` scope. Returns a `getSnapshot` page (limit clamped to ≤ 5000).
 *       401 `WEBHOOK_READ_TOKEN_INVALID`/`_EXPIRED`; 403
 *       `WEBHOOK_HANDLE_SCOPE_MISMATCH`; 404 `READ_HANDLE_EXPIRED`.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: handleId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, minimum: 0, default: 0 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 5000, default: 1000 }
 *     responses:
 *       200:
 *         description: Paged window of rows
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 payload:
 *                   $ref: '#/components/schemas/QueryHandleSnapshotResponse'
 *       401:
 *         description: Token invalid or expired
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       403:
 *         description: Token scoped to a different handle/org
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
webhookHandleRouter.get(
  "/handle/:handleId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { handleId } = req.params;
      const token = bearerToken(req);

      // Fail-closed: the token must be valid and scoped to THIS handle for a
      // read. Throws 401 (invalid/expired) or 403 (scope mismatch).
      const grant = await WebhookReadTokenService.validate(token, {
        handleId,
        mode: "read",
      });

      // Defense in depth: the token's org must own the staged handle. By
      // construction the runtime only mints a token for the org's own handle,
      // but never trust a single check on a third-party-facing surface.
      const meta = await PortalSqlHandleService.getMeta(handleId);
      if (meta._organizationId !== grant.organizationId) {
        throw new ApiError(
          403,
          ApiCode.WEBHOOK_HANDLE_SCOPE_MISMATCH,
          "Token org does not own this handle"
        );
      }

      const offset = parseQueryInt(req.query.offset, 0);
      const limit = Math.min(parseQueryInt(req.query.limit, 1_000), MAX_PAGE);
      if (offset < 0 || limit <= 0) {
        throw new ApiError(
          400,
          ApiCode.WEBHOOK_HANDLE_SCOPE_MISMATCH,
          "offset must be ≥ 0 and limit must be > 0"
        );
      }

      const result = await PortalSqlHandleService.getSnapshot(handleId, {
        offset,
        limit,
      });
      return HttpService.success(res, result);
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * @openapi
 * /api/webhook/handle/{sessionId}:
 *   post:
 *     tags:
 *       - Webhook compute scaling
 *     summary: Stage a large webhook result as a handle (#124 outbound)
 *     description: >
 *       A `streaming` webhook tool that produces a result too large for the
 *       1 MB inline response cap POSTs its rows here (write-scoped token from
 *       the call's `output` grant), then returns `{ resultHandle }` in its
 *       tool response. The runtime stages the rows via `produceFromRows` and
 *       binds the handle to this staging session.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rows]
 *             properties:
 *               rows:
 *                 type: array
 *                 items: { type: object }
 *               schema:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     name: { type: string }
 *                     type: { type: string }
 *     responses:
 *       200:
 *         description: Result staged
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 payload:
 *                   type: object
 *                   properties:
 *                     resultHandle: { type: string }
 *                     rowCount: { type: integer }
 *       401:
 *         description: Token invalid or expired
 *       403:
 *         description: Token scoped to a different session/org or not a write token
 */
webhookHandleRouter.post(
  "/handle/:sessionId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sessionId } = req.params;
      const token = bearerToken(req);

      const grant = await WebhookReadTokenService.validate(token, {
        handleId: sessionId,
        mode: "write",
      });

      const body = (req.body ?? {}) as {
        rows?: unknown;
        schema?: Array<{ name: string; type: string }>;
      };
      if (!Array.isArray(body.rows)) {
        throw new ApiError(
          400,
          ApiCode.WEBHOOK_RESULT_HANDLE_INVALID,
          "Staging request requires a `rows` array"
        );
      }

      const { envelope } = await PortalSqlHandleService.produceFromRows({
        rows: body.rows as Array<Record<string, unknown>>,
        schema: body.schema,
        stationId: grant.stationId ?? "webhook-staging",
        organizationId: grant.organizationId,
      });

      // Bind the produced handle to this session so the runtime can verify the
      // webhook's returned `{ resultHandle }` is exactly what it staged.
      await WebhookReadTokenService.recordStagedResult(
        sessionId,
        envelope.queryHandle
      );

      return HttpService.success(res, {
        resultHandle: envelope.queryHandle,
        rowCount: envelope.rowCount,
      });
    } catch (err) {
      return next(err);
    }
  }
);
