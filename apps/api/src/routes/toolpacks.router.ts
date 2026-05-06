import { Router, Request, Response, NextFunction } from "express";

import {
  BUILTIN_TOOLPACKS,
  BUILTIN_TOOLPACK_BY_SLUG,
  type BuiltinToolpack,
  isBuiltinToolpackSlug,
} from "@portalai/core/registries";
import {
  ToolpackListRequestQuerySchema,
  type Toolpack,
  type ToolpackListResponsePayload,
  type ToolpackGetResponsePayload,
} from "@portalai/core/contracts";

import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";

const logger = createLogger({ module: "toolpacks" });

export const toolpacksRouter = Router();

function toApiRecord(pack: BuiltinToolpack): Toolpack {
  return {
    id: `builtin:${pack.slug}`,
    kind: "builtin",
    slug: pack.slug,
    name: pack.name,
    description: pack.description,
    iconSlug: pack.iconSlug,
    tools: pack.tools,
  };
}

function matchesSearch(query: string, pack: BuiltinToolpack): boolean {
  if (
    pack.name.toLowerCase().includes(query) ||
    pack.description.toLowerCase().includes(query) ||
    pack.slug.toLowerCase().includes(query)
  ) {
    return true;
  }
  for (const tool of pack.tools) {
    if (
      tool.name.toLowerCase().includes(query) ||
      tool.description.toLowerCase().includes(query)
    ) {
      return true;
    }
  }
  return false;
}

// ── GET /api/toolpacks ──────────────────────────────────────────────────────

/**
 * @openapi
 * /api/toolpacks:
 *   get:
 *     tags:
 *       - Toolpacks
 *     summary: List toolpacks
 *     description: |
 *       Returns the merged list of toolpacks available to the
 *       authenticated user's organization. Phase 1 emits only
 *       built-in records; phase 2 will append organization-scoped
 *       custom packs via the same shape (kind="custom").
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Case-insensitive substring match against pack name, description, or any tool name/description.
 *       - in: query
 *         name: kind
 *         schema: { type: string, enum: [builtin, custom] }
 *         description: Filter to one kind.
 *     responses:
 *       200:
 *         description: Toolpacks retrieved successfully.
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiErrorResponse' }
 */
toolpacksRouter.get(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { search, kind } = ToolpackListRequestQuerySchema.parse(req.query);

      let candidates: BuiltinToolpack[] =
        kind === "custom" ? [] : [...BUILTIN_TOOLPACKS];

      if (search) {
        const q = search.toLowerCase();
        candidates = candidates.filter((p) => matchesSearch(q, p));
      }

      const toolpacks: Toolpack[] = candidates.map(toApiRecord);

      return HttpService.success<ToolpackListResponsePayload>(res, {
        toolpacks,
        total: toolpacks.length,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to list toolpacks"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.TOOLPACK_NOT_FOUND,
              "Failed to list toolpacks"
            )
      );
    }
  }
);

// ── GET /api/toolpacks/:id ──────────────────────────────────────────────────

/**
 * @openapi
 * /api/toolpacks/{id}:
 *   get:
 *     tags:
 *       - Toolpacks
 *     summary: Get a toolpack by id
 *     description: |
 *       Built-in pack ids are of the form `builtin:<slug>`. Phase 1 has
 *       no custom packs; ids prefixed `custom:` always return 404.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Toolpack found.
 *       404:
 *         description: Toolpack not found.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiErrorResponse' }
 */
toolpacksRouter.get(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      if (!id.startsWith("builtin:")) {
        return next(
          new ApiError(404, ApiCode.TOOLPACK_NOT_FOUND, "Toolpack not found")
        );
      }
      const slug = id.slice("builtin:".length);
      if (!isBuiltinToolpackSlug(slug)) {
        return next(
          new ApiError(404, ApiCode.TOOLPACK_NOT_FOUND, "Toolpack not found")
        );
      }
      const pack = BUILTIN_TOOLPACK_BY_SLUG[slug];
      return HttpService.success<ToolpackGetResponsePayload>(res, {
        toolpack: toApiRecord(pack),
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to fetch toolpack"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.TOOLPACK_NOT_FOUND,
              "Failed to fetch toolpack"
            )
      );
    }
  }
);
