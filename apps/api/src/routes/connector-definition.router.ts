import { Router, Request, Response, NextFunction } from "express";
import { eq, and, ilike, type SQL, type Column } from "drizzle-orm";
import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "../services/db.service.js";
import { connectorDefinitions } from "../db/schema/index.js";
import {
  ConnectorDefinitionListRequestQuerySchema,
  type ConnectorDefinitionListResponsePayload,
  type ConnectorDefinitionGetResponsePayload,
} from "@mcp-ui/core/contracts";

const logger = createLogger({ module: "connector-definition" });

export const connectorDefinitionRouter = Router();

/** Map of sortable field names to their Drizzle columns. */
const SORTABLE_COLUMNS: Record<string, Column> = {
  display: connectorDefinitions.display,
  category: connectorDefinitions.category,
  slug: connectorDefinitions.slug,
  created: connectorDefinitions.created,
  version: connectorDefinitions.version,
};

/**
 * @openapi
 * /api/connector-definitions:
 *   get:
 *     tags:
 *       - ConnectorDefinitions
 *     summary: List connector definitions
 *     description: Returns a paginated, filterable, and sortable list of connector definitions.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/limitParam'
 *       - $ref: '#/components/parameters/offsetParam'
 *       - $ref: '#/components/parameters/sortOrderParam'
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [display, category, slug, created, version]
 *           default: created
 *         description: Field to sort by
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by connector category
 *       - in: query
 *         name: authType
 *         schema:
 *           type: string
 *         description: Filter by authentication type
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Case-insensitive search on display name
 *     responses:
 *       200:
 *         description: Paginated list of connector definitions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/ConnectorDefinitionListResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
connectorDefinitionRouter.get(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { limit, offset, sortBy, sortOrder, category, authType, isActive, search } =
        ConnectorDefinitionListRequestQuerySchema.parse(req.query);

      logger.info(
        { limit, offset, category, authType, isActive, search, sortBy, sortOrder },
        "GET /api/connector-definitions called"
      );

      // Build filter conditions
      const filters: SQL[] = [];

      if (category) {
        filters.push(eq(connectorDefinitions.category, category));
      }
      if (authType) {
        filters.push(eq(connectorDefinitions.authType, authType));
      }
      if (isActive !== undefined) {
        filters.push(eq(connectorDefinitions.isActive, isActive));
      }
      if (search) {
        filters.push(ilike(connectorDefinitions.display, `%${search}%`));
      }

      const where = filters.length > 0 ? and(...filters) : undefined;
      const column = SORTABLE_COLUMNS[sortBy] ?? SORTABLE_COLUMNS.display;

      const [data, total] = await Promise.all([
        DbService.repository.connectorDefinitions.findMany(where, {
          limit,
          offset,
          orderBy: { column, direction: sortOrder },
        }),
        DbService.repository.connectorDefinitions.count(where),
      ]);

      return HttpService.success<ConnectorDefinitionListResponsePayload>(res, {
        connectorDefinitions: data,
        total,
        limit,
        offset,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to list connector definitions"
      );

      if (error instanceof ApiError) {
        return next(error);
      }
      return next(
        new ApiError(
          500,
          ApiCode.CONNECTOR_DEFINITION_FETCH_FAILED,
          "Failed to list connector definitions"
        )
      );
    }
  }
);

/**
 * @openapi
 * /api/connector-definitions/{id}:
 *   get:
 *     tags:
 *       - ConnectorDefinitions
 *     summary: Get a connector definition by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Connector definition ID
 *     responses:
 *       200:
 *         description: Connector definition found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/ConnectorDefinitionGetResponse'
 *       404:
 *         description: Connector definition not found
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
connectorDefinitionRouter.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      logger.info({ id }, "GET /api/connector-definitions/:id called");

      const connectorDefinition =
        await DbService.repository.connectorDefinitions.findById(id);

      if (!connectorDefinition) {
        return next(
          new ApiError(
            404,
            ApiCode.CONNECTOR_DEFINITION_NOT_FOUND,
            "Connector definition not found"
          )
        );
      }

      return HttpService.success<ConnectorDefinitionGetResponsePayload>(res, {
        connectorDefinition,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to fetch connector definition"
      );

      if (error instanceof ApiError) {
        return next(error);
      }
      return next(
        new ApiError(
          500,
          ApiCode.CONNECTOR_DEFINITION_FETCH_FAILED,
          "Failed to fetch connector definition"
        )
      );
    }
  }
);
