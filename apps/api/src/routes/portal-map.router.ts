/**
 * Vector-tile HTTP surface for persisted map blocks/pins (#316, slice 6).
 *
 * Two reference-addressed endpoints, org-scoped via `getApplicationMetadata`:
 *   GET /api/portal-map/tiles/message/:messageId/:blockIndex/:z/:x/:y(.mvt)
 *   GET /api/portal-map/tiles/pin/:portalResultId/:z/:x/:y(.mvt)
 *
 * The client supplies only the reference + tile coordinates — never SQL. The
 * server reads the block's persisted pipeline and runs ST_AsMVT over it. Free
 * and unmetered (like widget-refresh); abuse protection is the org scope plus
 * the DB's own statement_timeout — the per-org viz-refresh rate window is NOT
 * applied, since a single pan legitimately issues dozens of tile requests.
 */

import { Router, Request, Response, NextFunction } from "express";

import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import {
  PortalMapTileService,
  type TileRef,
  type TileRenderResult,
} from "../services/portal-map-tile.service.js";

export const portalMapRouter = Router();

const MVT_CONTENT_TYPE = "application/vnd.mapbox-vector-tile";

/** Parse `z`, stripping an optional `.mvt` suffix from `y`, and validate the
 *  tile address: z ∈ [0,22], x,y ∈ [0, 2^z). Throws 400 on anything else. */
export function parseTileCoords(
  zRaw: string,
  xRaw: string,
  yRaw: string
): {
  z: number;
  x: number;
  y: number;
} {
  const z = Number(zRaw);
  const x = Number(xRaw);
  const y = Number(String(yRaw).replace(/\.mvt$/i, ""));
  const isInt = (n: number) => Number.isInteger(n);
  if (!isInt(z) || z < 0 || z > 22) {
    throw new ApiError(
      400,
      ApiCode.MAP_TILE_NOT_FOUND,
      `Invalid tile zoom: ${zRaw}`
    );
  }
  const max = 2 ** z;
  if (!isInt(x) || x < 0 || x >= max || !isInt(y) || y < 0 || y >= max) {
    throw new ApiError(
      400,
      ApiCode.MAP_TILE_NOT_FOUND,
      `Tile coordinates out of range for zoom ${z}: x=${xRaw} y=${yRaw}`
    );
  }
  return { z, x, y };
}

/** Apply the render result to the response: 200 bytes / 204 / 304, with the
 *  degradation + caching headers on every outcome. */
function sendTile(res: Response, result: TileRenderResult): void {
  res.setHeader("ETag", result.etag);
  res.setHeader("Cache-Control", "private, max-age=60");
  if (result.simplifiedTolerance !== null) {
    res.setHeader(
      "X-Portal-Tile-Simplified",
      String(result.simplifiedTolerance)
    );
  }
  if (result.truncatedCap !== null) {
    res.setHeader("X-Portal-Tile-Truncated", String(result.truncatedCap));
  }
  if (result.status === 304) {
    res.status(304).end();
    return;
  }
  if (result.status === 204) {
    res.status(204).end();
    return;
  }
  res.setHeader("Content-Type", MVT_CONTENT_TYPE);
  res.status(200).send(result.body);
}

async function handle(
  ref: TileRef,
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { z, x, y } = parseTileCoords(
      req.params.z,
      req.params.x,
      req.params.y
    );
    const result = await PortalMapTileService.renderTile({
      ref,
      z,
      x,
      y,
      organizationId: req.application!.metadata.organizationId,
      ifNoneMatch: req.headers["if-none-match"] as string | undefined,
    });
    sendTile(res, result);
  } catch (err) {
    next(err);
  }
}

/**
 * @openapi
 * /api/portal-map/tiles/message/{messageId}/{blockIndex}/{z}/{x}/{y}:
 *   get:
 *     tags: [Portal Map]
 *     summary: Vector tile for a message-block map's durable pipeline
 *     description: >
 *       Renders an ST_AsMVT vector tile from the persisted pipeline of the map
 *       block at `blockIndex` in message `messageId`. Org-scoped; a missing,
 *       pipeline-less, or cross-org block returns 404 MAP_TILE_NOT_FOUND with
 *       no existence leak. `X-Portal-Tile-Simplified` / `X-Portal-Tile-Truncated`
 *       announce in-band degradation.
 *     parameters:
 *       - { in: path, name: messageId, required: true, schema: { type: string } }
 *       - { in: path, name: blockIndex, required: true, schema: { type: integer, minimum: 0 } }
 *       - { in: path, name: z, required: true, schema: { type: integer, minimum: 0, maximum: 22 } }
 *       - { in: path, name: x, required: true, schema: { type: integer, minimum: 0 } }
 *       - { in: path, name: y, required: true, schema: { type: integer, minimum: 0 } }
 *     responses:
 *       200:
 *         description: A Mapbox Vector Tile (protobuf)
 *         content:
 *           application/vnd.mapbox-vector-tile:
 *             schema: { type: string, format: binary }
 *       204: { description: Empty tile (no features in this envelope) }
 *       304: { description: Not modified (ETag match) }
 *       400:
 *         description: Invalid tile coordinates
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ApiErrorResponse' } } }
 *       404:
 *         description: No renderable tile for this reference (or cross-org)
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ApiErrorResponse' } } }
 *       504:
 *         description: Tile query timed out
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ApiErrorResponse' } } }
 */
portalMapRouter.get(
  "/tiles/message/:messageId/:blockIndex/:z/:x/:y",
  getApplicationMetadata,
  (req: Request, res: Response, next: NextFunction) => {
    const blockIndex = Number(req.params.blockIndex);
    if (!Number.isInteger(blockIndex) || blockIndex < 0) {
      return next(
        new ApiError(
          400,
          ApiCode.MAP_TILE_NOT_FOUND,
          `Invalid blockIndex: ${req.params.blockIndex}`
        )
      );
    }
    return handle(
      { kind: "message", messageId: req.params.messageId, blockIndex },
      req,
      res,
      next
    );
  }
);

/**
 * @openapi
 * /api/portal-map/tiles/pin/{portalResultId}/{z}/{x}/{y}:
 *   get:
 *     tags: [Portal Map]
 *     summary: Vector tile for a pinned map result's durable pipeline
 *     description: >
 *       Renders an ST_AsMVT vector tile from the persisted pipeline of the
 *       pinned portal result. Org-scoped; a missing, pipeline-less, or
 *       cross-org pin returns 404 MAP_TILE_NOT_FOUND.
 *     parameters:
 *       - { in: path, name: portalResultId, required: true, schema: { type: string } }
 *       - { in: path, name: z, required: true, schema: { type: integer, minimum: 0, maximum: 22 } }
 *       - { in: path, name: x, required: true, schema: { type: integer, minimum: 0 } }
 *       - { in: path, name: y, required: true, schema: { type: integer, minimum: 0 } }
 *     responses:
 *       200:
 *         description: A Mapbox Vector Tile (protobuf)
 *         content:
 *           application/vnd.mapbox-vector-tile:
 *             schema: { type: string, format: binary }
 *       204: { description: Empty tile }
 *       304: { description: Not modified (ETag match) }
 *       400:
 *         description: Invalid tile coordinates
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ApiErrorResponse' } } }
 *       404:
 *         description: No renderable tile for this reference (or cross-org)
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ApiErrorResponse' } } }
 *       504:
 *         description: Tile query timed out
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ApiErrorResponse' } } }
 */
portalMapRouter.get(
  "/tiles/pin/:portalResultId/:z/:x/:y",
  getApplicationMetadata,
  (req: Request, res: Response, next: NextFunction) =>
    handle(
      { kind: "pin", portalResultId: req.params.portalResultId },
      req,
      res,
      next
    )
);
