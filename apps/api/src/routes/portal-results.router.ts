import { Router, Request, Response, NextFunction } from "express";
import { eq, and, ilike, type SQL } from "drizzle-orm";

import {
  PinResultBodySchema,
  UpdatePortalResultBodySchema,
  PortalResultListRequestQuerySchema,
  PINNABLE_BLOCK_TYPES,
  type PortalResultListResponsePayload,
  type PortalResultGetResponsePayload,
} from "@portalai/core/contracts";
import type { PortalResultType } from "@portalai/core/models";
import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { invalidPayload } from "../utils/zod-issue.util.js";
import { DbService } from "../services/db.service.js";
import { PermissionService } from "../services/permission.service.js";
import { ObjectAccessService } from "../services/object-access.service.js";
import { ObjectCapabilitiesService } from "../services/object-capabilities.service.js";
import { portalResults, portals } from "../db/schema/index.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { PortalAccessService } from "../services/portal-access.service.js";
import { PortalResultPinService } from "../services/portal-result-pin.service.js";
import { PortalVizRefreshService } from "../services/portal-viz-refresh.service.js";
import { DissolvePrecomputeService } from "../services/dissolve-precompute.service.js";
import { incrementRateWindow } from "../utils/rate-limit.util.js";
import { SystemUtilities } from "../utils/system.util.js";
import { DateFactory } from "@portalai/core/utils";
import { VIZ_REFRESH_RATE_PER_MIN } from "@portalai/core/constants";

const logger = createLogger({ module: "portal-results" });

export const portalResultsRouter = Router();

// ── POST /api/portal-results ──────────────────────────────────────────────

/**
 * @openapi
 * /api/portal-results:
 *   post:
 *     tags:
 *       - Portal Results
 *     summary: Pin a result
 *     description: Pins a content block from the most recent assistant message in a portal as a named result.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [portalId, blockIndex, name]
 *             properties:
 *               portalId:
 *                 type: string
 *                 description: Portal to pin from
 *               blockIndex:
 *                 type: integer
 *                 description: Index of the content block in the last assistant message
 *                 example: 0
 *               name:
 *                 type: string
 *                 description: Display name for the pinned result
 *                 example: Q1 Revenue Chart
 *     responses:
 *       403:
 *         description: The caller lacks permission on this object or it isn't theirs (#685)
 *       201:
 *         description: Result pinned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   type: object
 *                   properties:
 *                     portalResult:
 *                       $ref: '#/components/schemas/PortalResult'
 *       400:
 *         description: >
 *           Invalid payload (`PORTAL_RESULT_INVALID_PAYLOAD`), block index outside
 *           the target message (`PORTAL_RESULT_BLOCK_INDEX_INVALID`), or a
 *           block that cannot pin — a transient kind, a type with no
 *           pinned-content contract, or content failing that contract
 *           (`PORTAL_RESULT_TYPE_NOT_PINNABLE`). Durable kinds (`text`,
 *           `data-table`, `d3`, `geo`) pin since #312.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Portal or assistant message not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       422:
 *         description: >
 *           The block's handle-backed data has expired and it carries no
 *           re-executable pipeline (`PORTAL_RESULT_CONTENT_EXPIRED`).
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
portalResultsRouter.post(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = PinResultBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          invalidPayload(
            ApiCode.PORTAL_RESULT_INVALID_PAYLOAD,
            "Invalid pin result payload",
            parsed.error
          )
        );
      }

      const ctx = req.application!.metadata;
      const { organizationId, userId } = ctx;
      // #621: pinning creates a pin owned by the caller (createdBy = caller);
      // every member may create their own.
      await PermissionService.check(ctx, "resource.write", {
        type: "pin",
        createdBy: userId,
      });
      const { portalId, messageId, blockIndex, name } = parsed.data;

      // #685: pin only from a portal the caller can read (portals are
      // per-user); org scope alone let a member copy a block out of another
      // member's portal.
      const { portal } = await PortalAccessService.load(ctx, portalId);

      // Find the target assistant message
      const messages =
        await DbService.repository.portalMessages.findByPortal(portalId);

      let targetMsg;
      if (messageId) {
        targetMsg = messages.find(
          (m) => m.id === messageId && m.role === "assistant"
        );
      } else {
        const assistantMessages = messages.filter(
          (m) => m.role === "assistant"
        );
        targetMsg = assistantMessages[assistantMessages.length - 1];
      }

      if (!targetMsg) {
        return next(
          new ApiError(
            404,
            ApiCode.PORTAL_RESULT_NOT_FOUND,
            "No assistant message found in portal"
          )
        );
      }

      const blocks = targetMsg.blocks as Array<Record<string, unknown>>;
      if (blockIndex >= blocks.length) {
        return next(
          new ApiError(
            400,
            ApiCode.PORTAL_RESULT_BLOCK_INDEX_INVALID,
            "Block index out of range"
          )
        );
      }

      const block = blocks[blockIndex] as Record<string, unknown>;
      const blockType = block.type as string;
      // #273: the pinnable set is derived from `PortalResultTypeSchema`, so
      // visualization blocks (`d3`) are rejected here and not merely hidden
      // in the UI — pinning a widget needs the durable dashboards model.
      if (!PINNABLE_BLOCK_TYPES.has(blockType as PortalResultType)) {
        return next(
          new ApiError(
            400,
            ApiCode.PORTAL_RESULT_TYPE_NOT_PINNABLE,
            `Block type "${String(block.type)}" cannot be pinned`
          )
        );
      }
      const type = blockType as PortalResultType;

      // #312: materialize — validate against the per-type contract and
      // resolve a self-contained snapshot (handle envelopes never persist).
      // Display blocks from resolveDisplayBlock follow { type, content }.
      const { content, snapshotUpdatedAt } =
        await PortalResultPinService.materialize(type, block.content, {
          stationId: portal.stationId,
          organizationId,
          userId,
        });

      const now = new DateFactory("UTC").now().getTime();
      const portalResult = await DbService.repository.portalResults.create({
        id: SystemUtilities.id.v4.generate(),
        organizationId,
        stationId: portal.stationId,
        portalId,
        messageId: messageId ?? null,
        blockIndex: blockIndex ?? null,
        name,
        type,
        content: content as Record<string, unknown>,
        snapshotUpdatedAt,
        created: now,
        createdBy: userId,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });

      logger.info(
        { id: portalResult.id, portalId, stationId: portal.stationId },
        "Portal result pinned"
      );

      // #472: precompute the low-zoom dissolve for a polygon choropleth pin.
      // Best-effort — never blocks or fails the pin.
      await DissolvePrecomputeService.enqueueForPin({
        portalResultId: portalResult.id,
        organizationId,
        userId,
        type,
        content: content as Record<string, unknown>,
      });

      return HttpService.success(res, { portalResult }, 201);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to pin portal result"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.PORTAL_RESULT_NOT_FOUND,
              "Failed to pin result"
            )
      );
    }
  }
);

// ── POST /api/portal-results/:id/refresh ──────────────────────────────────

/**
 * @openapi
 * /api/portal-results/{id}/refresh:
 *   post:
 *     tags:
 *       - Portal Results
 *     summary: Re-execute a pinned result's durable pipeline for fresh data
 *     description: >
 *       Pin-addressed live refresh (#312). The server reads the pipeline from
 *       the pinned row's own stored content and re-runs it read-only under the
 *       caller's organization — the client never supplies SQL. A successful
 *       refresh persists the fresh snapshot back onto the row
 *       (`snapshotUpdatedAt`), so the stored fallback is always the last known
 *       good data. Free and unmetered; shares the per-org widget-refresh rate
 *       window.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Pinned result id
 *     responses:
 *       200:
 *         description: A fresh delivery for the pinned result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 payload:
 *                   $ref: '#/components/schemas/WidgetRefreshResponse'
 *       404:
 *         description: No pinned result for this id (or cross-org)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       422:
 *         description: The pinned result has no durable pipeline
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       429:
 *         description: Per-org rate limit exceeded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
portalResultsRouter.post(
  "/:id/refresh",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.application!.metadata;
      const organizationId = ctx.organizationId;

      // Per-org rate limit — the same window as the message-block
      // widget-refresh (one budget across both addressers). Fail-open on a
      // Redis blip: the re-execution is already bounded (read-only +
      // statement_timeout + LIMIT).
      try {
        const count = await incrementRateWindow(
          `viz-refresh:${organizationId}`
        );
        if (count > VIZ_REFRESH_RATE_PER_MIN) {
          throw new ApiError(
            429,
            ApiCode.VIZ_REFRESH_RATE_LIMITED,
            "Too many widget refreshes this minute."
          );
        }
      } catch (err) {
        if (err instanceof ApiError) throw err; // the 429 propagates
        logger.warn(
          { err },
          "viz-refresh rate limiter unavailable; failing open"
        );
      }

      // #621: a viz refresh mutates the pin's stored result — a write. Guard it
      // (a read-only grantee can't refresh a shared pin); 404 when unreadable.
      // After the cheap rate-limit gate so a nonexistent id is still bounded.
      // #713: one the caller can't read answers 404, like its GET.
      ObjectAccessService.loadForVerb(
        await PermissionService.loadSet(ctx),
        organizationId,
        "pin",
        await DbService.repository.portalResults.findById(req.params.id),
        "write",
        () =>
          new ApiError(
            404,
            ApiCode.PORTAL_RESULT_NOT_FOUND,
            "Portal result not found"
          )
      );

      const payload = await PortalVizRefreshService.refreshPinnedResult({
        portalResultId: req.params.id,
        organizationId,
        userId: req.application!.metadata.userId,
      });

      // #472: recompute the low-zoom dissolve over the freshly-refreshed data.
      // Best-effort; a non-polygon/no-colorBy pin is a no-op.
      const pin = await DbService.repository.portalResults.findById(
        req.params.id
      );
      if (pin) {
        await DissolvePrecomputeService.enqueueForPin({
          portalResultId: pin.id,
          organizationId,
          userId: req.application!.metadata.userId,
          type: pin.type,
          content: pin.content,
        });
      }

      return HttpService.success(res, payload);
    } catch (err) {
      return next(err);
    }
  }
);

// ── GET /api/portal-results ───────────────────────────────────────────────

/**
 * @openapi
 * /api/portal-results:
 *   get:
 *     tags:
 *       - Portal Results
 *     summary: List pinned results
 *     description: Returns pinned portal results scoped to the organization, optionally filtered by station.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/limitParam'
 *       - $ref: '#/components/parameters/offsetParam'
 *       - $ref: '#/components/parameters/sortOrderParam'
 *       - in: query
 *         name: stationId
 *         schema:
 *           type: string
 *         description: Filter results by station ID
 *       - in: query
 *         name: portalId
 *         schema:
 *           type: string
 *         description: Filter results by portal ID
 *     responses:
 *       200:
 *         description: Portal results retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/PortalResultListResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
portalResultsRouter.get(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { limit, offset, sortOrder, search, stationId, portalId, include } =
        PortalResultListRequestQuerySchema.parse(req.query);
      const ctx = req.application!.metadata;
      const { organizationId } = ctx;

      const filters: SQL[] = [eq(portalResults.organizationId, organizationId)];
      if (stationId) {
        filters.push(eq(portalResults.stationId, stationId));
      }
      if (portalId) {
        filters.push(eq(portalResults.portalId, portalId));
      }
      if (search) {
        filters.push(ilike(portalResults.name, `%${search}%`));
      }
      // #621: object-level visibility — own + system + shared pins; undefined =
      // see-all (owner/admin).
      const set = await PermissionService.loadSet(ctx);
      const visibility = set.visibilityPredicate("pin", {
        createdByCol: portalResults.createdBy,
        idCol: portalResults.id,
      });
      if (visibility) filters.push(visibility);
      const where = and(...filters);

      const include_ = include
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const listOpts = {
        limit,
        offset,
        orderBy: { column: portalResults.created, direction: sortOrder },
        include: include_,
        // #694: name a pin's source portal only when the caller can read it.
        portalVisibility: set.visibilityPredicate("portal", {
          createdByCol: portals.createdBy,
          idCol: portals.id,
        }),
      };

      const [data, total] = await Promise.all([
        DbService.repository.portalResults.findMany(where, listOpts),
        DbService.repository.portalResults.count(where),
      ]);

      return HttpService.success<PortalResultListResponsePayload>(res, {
        // #688: each pin with the caller's capabilities on it.
        portalResults: ObjectCapabilitiesService.attach(
          set,
          "pin",
          data
        ) as unknown as PortalResultListResponsePayload["portalResults"],
        total,
        limit,
        offset,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to list portal results"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.PORTAL_RESULT_NOT_FOUND,
              "Failed to list portal results"
            )
      );
    }
  }
);

// ── GET /api/portal-results/:id ───────────────────────────────────────────

/**
 * @openapi
 * /api/portal-results/{id}:
 *   get:
 *     tags: [Portal Results]
 *     summary: Fetch a single portal result
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The portal result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 portalResult: { $ref: '#/components/schemas/PortalResultWithCapabilities' }
 *       404:
 *         description: No such portal result (`PORTAL_RESULT_NOT_FOUND`)
 */
portalResultsRouter.get(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const ctx = req.application!.metadata;
      const { organizationId } = ctx;

      const portalResult =
        await DbService.repository.portalResults.findById(id);
      if (!portalResult || portalResult.organizationId !== organizationId) {
        return next(
          new ApiError(
            404,
            ApiCode.PORTAL_RESULT_NOT_FOUND,
            "Portal result not found"
          )
        );
      }

      // #621: object-level read visibility (own + system + shared). A pin the
      // caller can't see 404s, mirroring the list.
      const set = await PermissionService.loadSet(ctx);
      const object = { type: "pin", id, createdBy: portalResult.createdBy };
      if (!set.can("resource.read", object)) {
        return next(
          new ApiError(
            404,
            ApiCode.PORTAL_RESULT_NOT_FOUND,
            "Portal result not found"
          )
        );
      }
      // #688: capabilities replace the #621 canShare/canWrite/canDelete flags.
      return HttpService.success<PortalResultGetResponsePayload>(res, {
        portalResult: {
          ...portalResult,
          capabilities: ObjectCapabilitiesService.for(set, "pin", portalResult),
        } as unknown as PortalResultGetResponsePayload["portalResult"],
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to get portal result"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.PORTAL_RESULT_NOT_FOUND,
              "Failed to get portal result"
            )
      );
    }
  }
);

// ── PATCH /api/portal-results/:id ─────────────────────────────────────────

/**
 * @openapi
 * /api/portal-results/{id}:
 *   patch:
 *     tags:
 *       - Portal Results
 *     summary: Rename a pinned result
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Portal result ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdatePortalResultBody'
 *     responses:
 *       200:
 *         description: Portal result renamed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   type: object
 *                   properties:
 *                     portalResult:
 *                       $ref: '#/components/schemas/PortalResult'
 *       400:
 *         description: >-
 *           PORTAL_RESULT_INVALID_PAYLOAD. The body failed its schema: a
 *           missing, blank or wrongly typed name, or an unknown key (#745).
 *           The message names the first issue; details.issues holds all of
 *           them.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Portal result not found
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
portalResultsRouter.patch(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const ctx = req.application!.metadata;
      const { organizationId, userId } = ctx;

      // #745: a wrongly typed or unknown key is a 400 naming it, not ignored.
      const parsed = UpdatePortalResultBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          invalidPayload(
            ApiCode.PORTAL_RESULT_INVALID_PAYLOAD,
            "Invalid pin payload",
            parsed.error
          )
        );
      }
      // The schema trims, so the stored name is trimmed too.
      const { name } = parsed.data;

      // #621: renaming a pin is a write — own, owner/admin, or a read-write grant.
      // #713: one the caller can't read answers 404, like its GET.
      ObjectAccessService.loadForVerb(
        await PermissionService.loadSet(ctx),
        organizationId,
        "pin",
        await DbService.repository.portalResults.findById(id),
        "write",
        () =>
          new ApiError(
            404,
            ApiCode.PORTAL_RESULT_NOT_FOUND,
            "Portal result not found"
          )
      );

      const portalResult = await DbService.repository.portalResults.update(id, {
        name,
        updated: Date.now(),
        updatedBy: userId,
      } as never);

      logger.info({ id }, "Portal result renamed");

      return HttpService.success(res, { portalResult });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to rename portal result"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.PORTAL_RESULT_NOT_FOUND,
              "Failed to rename portal result"
            )
      );
    }
  }
);

// ── DELETE /api/portal-results/:id ────────────────────────────────────────

/**
 * @openapi
 * /api/portal-results/{id}:
 *   delete:
 *     tags:
 *       - Portal Results
 *     summary: Delete a pinned result
 *     description: Soft-deletes a pinned portal result.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Portal result ID
 *     responses:
 *       200:
 *         description: Portal result deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *       404:
 *         description: Portal result not found
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
portalResultsRouter.delete(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const ctx = req.application!.metadata;
      const { organizationId, userId } = ctx;

      // #621: deleting a pin requires resource.delete — creator or owner/admin;
      // a read-write grantee cannot delete a shared pin.
      // #713: one the caller can't read answers 404, like its GET.
      ObjectAccessService.loadForVerb(
        await PermissionService.loadSet(ctx),
        organizationId,
        "pin",
        await DbService.repository.portalResults.findById(id),
        "delete",
        () =>
          new ApiError(
            404,
            ApiCode.PORTAL_RESULT_NOT_FOUND,
            "Portal result not found"
          )
      );

      await DbService.repository.portalResults.softDelete(id, userId);
      logger.info({ id }, "Portal result soft-deleted");

      return HttpService.success(res, { id });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to delete portal result"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.PORTAL_RESULT_NOT_FOUND,
              "Failed to delete portal result"
            )
      );
    }
  }
);
