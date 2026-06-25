/**
 * REST API connector — endpoint CRUD router.
 *
 * Mounted at `/api/connector-instances/:instanceId/api-endpoints`.
 * Manages the per-entity `api_endpoint_configs` rows belonging to a
 * `rest-api` connector instance. Sync invocation goes through the
 * shared `POST /api/connector-instances/:id/sync` route — this router
 * only handles configuration.
 *
 * All mutating routes (POST/PATCH/DELETE) gate on the existing
 * `ENTITY_LOCKED_BY_JOB` lock model via `JobLockService` so an
 * in-flight `connector_sync` job can't race a config change.
 */

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";

import { ApiCode } from "../constants/api-codes.constants.js";
import { ApiError, HttpService } from "../services/http.service.js";
import { DbService } from "../services/db.service.js";
import { JobLockService } from "../services/job-lock.service.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { createLogger } from "../utils/logger.util.js";
import {
  ApiEndpointConfigBaseSchema,
  ColumnDefinitionModelFactory,
  FieldMappingModelFactory,
  type ApiEndpointConfig,
  type PaginationConfig,
} from "@portalai/core/models";
import {
  CreateApiEndpointRequestBodySchema,
  DiscoverColumnsRequestBodySchema,
  type CreateApiEndpointColumnDraft,
} from "@portalai/core/contracts";
import type { ApiEndpoint } from "../db/repositories/api-endpoints.repository.js";
import { reconstructPagination } from "../adapters/rest-api/pagination/index.js";
import { restApiAdapter } from "../adapters/rest-api/rest-api.adapter.js";
import { wideTableReconcilerService } from "../services/wide-table-reconciler.service.js";

const logger = createLogger({ module: "api-endpoints" });

// The router is mounted with `mergeParams: true` under
// `/api/connector-instances/:instanceId/api-endpoints` so it can read
// `req.params.instanceId` from the parent path.
export const apiEndpointsRouter = Router({ mergeParams: true });

// ── Validation schemas ────────────────────────────────────────────────
//
// `CreateApiEndpointRequestBodySchema` is sourced from
// `@portalai/core/contracts` so the wire shape stays in lockstep with
// the SDK + swagger + the rest of the codebase.

const PatchApiEndpointRequestBodySchema = z.object({
  label: z.string().min(1).optional(),
  // Partial of the *base* shape — refines (e.g. bodyTemplate vs method)
  // can't survive `.partial()`, so PATCH-time validation accepts any
  // subset of fields and the route enforces refinements only on full
  // create payloads. Cross-field consistency on edit is enforced at
  // the adapter layer (slice 5).
  config: ApiEndpointConfigBaseSchema.partial().optional(),
});

// ── Pagination flatten / reconstruct helpers ─────────────────────────
//
// The table stores `pagination` as a discriminator string + a free-form
// `paginationConfig` jsonb for the rest of the union arm. The contract
// model surfaces both as a single `PaginationConfig` discriminated
// union. These helpers do the bridge.

function flattenPaginationForTable(pagination: PaginationConfig): {
  pagination: string;
  paginationConfig: Record<string, unknown> | null;
} {
  const { strategy, ...rest } = pagination as Record<string, unknown> & {
    strategy: string;
  };
  return {
    pagination: strategy,
    paginationConfig: Object.keys(rest).length > 0 ? rest : null,
  };
}

// ── Wire-shape mapping ────────────────────────────────────────────────

function toWire(pair: ApiEndpoint): {
  entity: { id: string; key: string; label: string };
  config: ApiEndpointConfig;
} {
  return {
    entity: {
      id: pair.entity.id,
      key: pair.entity.key,
      label: pair.entity.label,
    },
    config: {
      path: pair.config.path,
      method: pair.config.method as "GET" | "POST",
      recordsPath: pair.config.recordsPath,
      transform: pair.config.transform ?? undefined,
      idField: pair.config.idField ?? null,
      headers: (pair.config.headers as Record<string, string> | null) ?? undefined,
      queryParams: (pair.config.queryParams as Record<string, string> | null) ?? undefined,
      bodyTemplate: pair.config.bodyTemplate ?? undefined,
      pagination: reconstructPagination(
        pair.config.pagination,
        (pair.config.paginationConfig as Record<string, unknown> | null) ?? null
      ),
    },
  };
}

// ── Shared instance guard ─────────────────────────────────────────────
//
// Loads the instance + its definition and verifies the definition's
// slug is `rest-api`. Returns the resolved instance (already org-
// scoped) so the route handlers can use its organizationId. Throws
// `INSTANCE_NOT_FOUND` for missing or non-rest-api instances — the
// 404 is uniform from the client's perspective.

async function requireRestApiInstance(
  instanceId: string,
  organizationId: string
): Promise<{ id: string; organizationId: string }> {
  const instance =
    await DbService.repository.connectorInstances.findById(instanceId);
  if (
    !instance ||
    instance.organizationId !== organizationId ||
    instance.deleted !== null
  ) {
    throw new ApiError(
      404,
      ApiCode.CONNECTOR_INSTANCE_NOT_FOUND,
      `Connector instance ${instanceId} not found`
    );
  }
  const definition =
    await DbService.repository.connectorDefinitions.findById(
      instance.connectorDefinitionId
    );
  if (!definition || definition.slug !== "rest-api") {
    throw new ApiError(
      404,
      ApiCode.CONNECTOR_INSTANCE_NOT_FOUND,
      `Connector instance ${instanceId} is not a rest-api instance`
    );
  }
  return { id: instance.id, organizationId: instance.organizationId };
}

// ── Column materialization (used by POST when `columns` is sent) ─────

/**
 * Materialize the workflow's per-endpoint `columns` draft as
 * column_definition + field_mapping rows so the user lands on a
 * connector that's ready to sync without a second pass through the
 * field-mapping UI.
 *
 * Per-column flow:
 *   1. Resolve the columnDefinitionId:
 *      - if the draft adopted an AI-assist suggestion (`columnDefinitionId`
 *        already set), use it verbatim;
 *      - else look up an existing org column_definition by `key ===
 *        normalizedKey` and reuse it (avoids duplicate-key conflicts
 *        when two endpoints share a column name);
 *      - else create a fresh column_definition with key/label/type
 *        derived from the draft.
 *   2. Create the field_mapping pointing at that column_definition.
 *   3. After all rows in the batch are inserted, reconcile the wide
 *      table once so the `c_<key>` columns appear in `er__<entityId>`.
 *
 * Bails on the first error so the workflow can surface the failure
 * without leaving the connector half-configured.
 */
async function materializeColumns(
  organizationId: string,
  connectorEntityId: string,
  columns: CreateApiEndpointColumnDraft[],
  userId: string
): Promise<void> {
  if (columns.length === 0) return;

  // Build a key→id map of existing org column_definitions so we don't
  // race-create duplicates across endpoints (or across columns within
  // one endpoint that share a normalizedKey).
  const existing =
    await DbService.repository.columnDefinitions.findByOrganizationId(
      organizationId
    );
  const byKey = new Map<string, string>();
  for (const cd of existing) byKey.set(cd.key, cd.id);

  for (const col of columns) {
    let columnDefinitionId = col.columnDefinitionId ?? null;

    if (!columnDefinitionId) {
      const cached = byKey.get(col.normalizedKey);
      if (cached) {
        columnDefinitionId = cached;
      } else {
        // Create a fresh column_definition for this normalizedKey.
        const cdFactory = new ColumnDefinitionModelFactory();
        const cdModel = cdFactory.create(userId);
        cdModel.update({
          organizationId,
          key: col.normalizedKey,
          label: col.normalizedKey,
          type: col.type,
          description: null,
          validationPattern: null,
          validationMessage: null,
          canonicalFormat: null,
          system: false,
        });
        const created = await DbService.repository.columnDefinitions.create(
          cdModel.parse()
        );
        columnDefinitionId = created.id;
        byKey.set(col.normalizedKey, columnDefinitionId);
      }
    }

    const fmFactory = new FieldMappingModelFactory();
    const fmModel = fmFactory.create(userId);
    fmModel.update({
      organizationId,
      connectorEntityId,
      columnDefinitionId,
      sourceField: col.sourceField,
      isPrimaryKey: false,
      normalizedKey: col.normalizedKey,
      required: col.required,
      defaultValue: null,
      format: null,
      enumValues: null,
      refNormalizedKey: null,
      refEntityKey: null,
    });
    await DbService.repository.fieldMappings.create(fmModel.parse());
  }

  // Reconcile the wide table once at the end — adds the `c_<key>`
  // columns to `er__<entityId>` so the sync writes will land + the
  // entity-record route's JOIN succeeds.
  await wideTableReconcilerService.reconcileEntity(connectorEntityId);
}

// ── Routes ────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/connector-instances/{instanceId}/api-endpoints:
 *   get:
 *     tags:
 *       - REST API Endpoints
 *     summary: List endpoints for a REST API connector instance
 *     description: >
 *       Returns every `api_endpoint_config` row attached to the given
 *       REST API connector instance, joined with the matching
 *       `connector_entity`. Soft-deleted rows are excluded.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: instanceId
 *         required: true
 *         schema:
 *           type: string
 *         description: Connector instance ID
 *     responses:
 *       200:
 *         description: Endpoints list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [success, payload]
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/ApiEndpointListResponse'
 *       404:
 *         description: Instance not found or is not a REST API connector
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
apiEndpointsRouter.get(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { instanceId } = req.params as { instanceId: string };
      const { organizationId } = req.application!.metadata;
      const instance = await requireRestApiInstance(instanceId, organizationId);

      const rows = await DbService.repository.apiEndpoints.findByInstance(
        instance.id
      );
      return HttpService.success(res, {
        endpoints: rows.map(toWire),
      });
    } catch (error) {
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.REST_API_OPERATION_FAILED,
              `Failed to list api endpoints: ${(error as Error).message}`
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/connector-instances/{instanceId}/api-endpoints/{entityId}:
 *   get:
 *     tags:
 *       - REST API Endpoints
 *     summary: Fetch a single endpoint
 *     description: >
 *       Returns the joined `connector_entity` + `api_endpoint_config`
 *       row for the given entity ID, scoped to the instance.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: instanceId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Connector entity ID
 *     responses:
 *       200:
 *         description: Endpoint payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [success, payload]
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/ApiEndpoint'
 *       404:
 *         description: Instance or endpoint not found
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
apiEndpointsRouter.get(
  "/:entityId",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { instanceId, entityId } = req.params as {
        instanceId: string;
        entityId: string;
      };
      const { organizationId } = req.application!.metadata;
      await requireRestApiInstance(instanceId, organizationId);

      const found = await DbService.repository.apiEndpoints.findByEntityId(
        entityId
      );
      if (!found) {
        throw new ApiError(
          404,
          ApiCode.REST_API_ENDPOINT_NOT_FOUND,
          `Api endpoint for entity ${entityId} not found`
        );
      }
      return HttpService.success(res, toWire(found));
    } catch (error) {
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.REST_API_OPERATION_FAILED,
              `Failed to get api endpoint: ${(error as Error).message}`
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/connector-instances/{instanceId}/api-endpoints:
 *   post:
 *     tags:
 *       - REST API Endpoints
 *     summary: Create an endpoint (and its connector_entity)
 *     description: >
 *       Inserts a `connector_entity` + matching `api_endpoint_config`
 *       pair in one transaction. The `config.pagination` discriminated
 *       union is flattened into the table's `pagination` (string) +
 *       `pagination_config` (jsonb) columns. Org-wide entity-key
 *       uniqueness is enforced — 409 on conflict.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: instanceId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateApiEndpointRequestBody'
 *     responses:
 *       201:
 *         description: Endpoint created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [success, payload]
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/ApiEndpoint'
 *       400:
 *         description: Invalid payload (Zod schema failure)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Instance not found or is not a REST API connector
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       409:
 *         description: >
 *           `CONNECTOR_ENTITY_KEY_CONFLICT` (the org already has an
 *           entity with this `key`) or `ENTITY_LOCKED_BY_JOB`
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
apiEndpointsRouter.post(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { instanceId } = req.params as { instanceId: string };
      const { organizationId, userId } = req.application!.metadata;
      const instance = await requireRestApiInstance(instanceId, organizationId);

      let body: z.infer<typeof CreateApiEndpointRequestBodySchema>;
      try {
        body = CreateApiEndpointRequestBodySchema.parse(req.body);
      } catch (err) {
        throw new ApiError(
          400,
          ApiCode.REST_API_INVALID_CONFIG,
          `Invalid api endpoint payload: ${(err as Error).message}`,
          { issues: (err as z.ZodError).issues }
        );
      }

      await JobLockService.assertConnectorInstanceUnlocked(
        instance.id,
        organizationId
      );

      const flattened = flattenPaginationForTable(body.config.pagination);
      const result = await DbService.repository.apiEndpoints
        .createWithEntity(
          {
            organizationId: instance.organizationId,
            connectorInstanceId: instance.id,
            key: body.key,
            label: body.label,
            config: {
              path: body.config.path,
              method: body.config.method,
              recordsPath: body.config.recordsPath ?? "",
              transform: body.config.transform ?? null,
              idField: body.config.idField ?? null,
              headers: body.config.headers ?? null,
              queryParams: body.config.queryParams ?? null,
              bodyTemplate: body.config.bodyTemplate ?? null,
              pagination: flattened.pagination,
              paginationConfig: flattened.paginationConfig,
            },
          },
          userId
        )
        .catch((err: Error & { code?: string; constraint_name?: string; cause?: unknown }) => {
          // Drizzle wraps the postgres-driver error inside `err.cause`.
          // The driver populates `.code` (SQLSTATE) and `.constraint_name`.
          const cause = err.cause as
            | { code?: string; constraint_name?: string; message?: string }
            | undefined;
          const code = cause?.code ?? err.code;
          const constraint = cause?.constraint_name ?? err.constraint_name;
          const message = cause?.message ?? err.message ?? "";
          const isOrgKeyConflict =
            code === "23505" &&
            (constraint === "connector_entities_org_key_unique" ||
              message.includes("connector_entities_org_key_unique"));
          if (isOrgKeyConflict) {
            throw new ApiError(
              409,
              ApiCode.CONNECTOR_ENTITY_KEY_CONFLICT,
              `An entity with key "${body.key}" already exists for this organization`,
              { key: body.key }
            );
          }
          throw err;
        });

      // Provision the wide-table partition for the new connector_entity.
      // The reconciler owns DDL on `er__<id>` tables; calling
      // `ensureTable` here keeps the entity ready for sync writes +
      // record-fetch reads even before any field_mapping is added.
      // Mirrors the direct connector-entity POST route.
      try {
        await wideTableReconcilerService.ensureTable(result.entity.id);
      } catch (error) {
        logger.error(
          {
            connectorEntityId: result.entity.id,
            error: error instanceof Error ? error.message : "Unknown error",
          },
          "Wide-table provisioning failed after api-endpoint create"
        );
        throw new ApiError(
          500,
          ApiCode.WIDE_TABLE_RECONCILE_FAILED,
          error instanceof Error
            ? error.message
            : "Failed to provision wide table"
        );
      }

      // Materialize the workflow's per-endpoint column drafts as
      // column_definitions + field_mappings + a reconcile pass.
      // No-op when `columns` is absent (legacy callers / unconfigured
      // endpoints).
      if (body.columns && body.columns.length > 0) {
        try {
          await materializeColumns(
            instance.organizationId,
            result.entity.id,
            body.columns,
            userId
          );
        } catch (error) {
          logger.error(
            {
              connectorEntityId: result.entity.id,
              error: error instanceof Error ? error.message : "Unknown error",
            },
            "Column materialization failed after api-endpoint create"
          );
          throw error instanceof ApiError
            ? error
            : new ApiError(
                500,
                ApiCode.FIELD_MAPPING_CREATE_FAILED,
                error instanceof Error
                  ? error.message
                  : "Failed to materialize field mappings"
              );
        }
      }

      logger.info(
        {
          event: "api-endpoints.created",
          connectorInstanceId: instance.id,
          connectorEntityId: result.entity.id,
          columnsMaterialized: body.columns?.length ?? 0,
        },
        "API endpoint created"
      );

      return HttpService.success(res, toWire(result), 201);
    } catch (error) {
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.REST_API_OPERATION_FAILED,
              `Failed to create api endpoint: ${(error as Error).message}`
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/connector-instances/{instanceId}/api-endpoints/{entityId}:
 *   patch:
 *     tags:
 *       - REST API Endpoints
 *     summary: Patch endpoint config (and/or label)
 *     description: >
 *       Updates a subset of `connector_entity.label` and/or
 *       `api_endpoint_config.*` fields. Cross-field refinements
 *       (bodyTemplate-vs-method) are NOT re-checked on PATCH — that
 *       only fires on full-create payloads. The adapter layer
 *       enforces consistency at sync/probe time.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: instanceId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PatchApiEndpointRequestBody'
 *     responses:
 *       200:
 *         description: Endpoint patched
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [success, payload]
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/ApiEndpoint'
 *       400:
 *         description: Invalid patch payload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Instance or endpoint not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       409:
 *         description: "ENTITY_LOCKED_BY_JOB — a connector_sync job is in flight against this instance"
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
apiEndpointsRouter.patch(
  "/:entityId",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { instanceId, entityId } = req.params as {
        instanceId: string;
        entityId: string;
      };
      const { organizationId, userId } = req.application!.metadata;
      const instance = await requireRestApiInstance(instanceId, organizationId);

      let body: z.infer<typeof PatchApiEndpointRequestBodySchema>;
      try {
        body = PatchApiEndpointRequestBodySchema.parse(req.body);
      } catch (err) {
        throw new ApiError(
          400,
          ApiCode.REST_API_INVALID_CONFIG,
          `Invalid api endpoint patch: ${(err as Error).message}`,
          { issues: (err as z.ZodError).issues }
        );
      }

      const existing = await DbService.repository.apiEndpoints.findByEntityId(
        entityId
      );
      if (!existing) {
        throw new ApiError(
          404,
          ApiCode.REST_API_ENDPOINT_NOT_FOUND,
          `Api endpoint for entity ${entityId} not found`
        );
      }

      await JobLockService.assertConnectorInstanceUnlocked(
        instance.id,
        organizationId
      );

      // Update the entity row's label if provided (separate from config).
      if (body.label !== undefined && body.label !== existing.entity.label) {
        await DbService.repository.connectorEntities.update(entityId, {
          label: body.label,
          updated: Date.now(),
          updatedBy: userId,
        });
      }

      // Update the config row if any config fields were sent.
      if (body.config && Object.keys(body.config).length > 0) {
        const { pagination, ...rest } = body.config;
        const patch = {
          ...rest,
          ...(pagination !== undefined
            ? flattenPaginationForTable(pagination as PaginationConfig)
            : {}),
        };
        const updated = await DbService.repository.apiEndpoints.updateConfig(
          entityId,
          patch as never,
          userId
        );
        if (!updated) {
          throw new ApiError(
            404,
            ApiCode.REST_API_ENDPOINT_NOT_FOUND,
            `Api endpoint for entity ${entityId} not found`
          );
        }
        return HttpService.success(res, toWire(updated));
      }

      // Label-only change — re-read joined pair.
      const refreshed = await DbService.repository.apiEndpoints.findByEntityId(
        entityId
      );
      return HttpService.success(res, toWire(refreshed!));
    } catch (error) {
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.REST_API_OPERATION_FAILED,
              `Failed to patch api endpoint: ${(error as Error).message}`
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/connector-instances/{instanceId}/api-endpoints/{entityId}:
 *   delete:
 *     tags:
 *       - REST API Endpoints
 *     summary: Soft-delete an endpoint
 *     description: >
 *       Soft-deletes the `connector_entity` + matching
 *       `api_endpoint_config` pair in one transaction. The entity_records
 *       attached to this entity remain — entity-records cascade deletion
 *       is a separate concern that the connector-entity delete route
 *       handles.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: instanceId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Endpoint deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [success, payload]
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/DeleteApiEndpointResponse'
 *       404:
 *         description: Instance or endpoint not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       409:
 *         description: "ENTITY_LOCKED_BY_JOB — a connector_sync job is in flight against this instance"
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
apiEndpointsRouter.delete(
  "/:entityId",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { instanceId, entityId } = req.params as {
        instanceId: string;
        entityId: string;
      };
      const { organizationId, userId } = req.application!.metadata;
      const instance = await requireRestApiInstance(instanceId, organizationId);

      const existing = await DbService.repository.apiEndpoints.findByEntityId(
        entityId
      );
      if (!existing) {
        throw new ApiError(
          404,
          ApiCode.REST_API_ENDPOINT_NOT_FOUND,
          `Api endpoint for entity ${entityId} not found`
        );
      }

      await JobLockService.assertConnectorInstanceUnlocked(
        instance.id,
        organizationId
      );

      const ok = await DbService.repository.apiEndpoints.softDeleteWithEntity(
        entityId,
        userId
      );
      if (!ok) {
        throw new ApiError(
          404,
          ApiCode.REST_API_ENDPOINT_NOT_FOUND,
          `Api endpoint for entity ${entityId} not found`
        );
      }

      logger.info(
        {
          event: "api-endpoints.deleted",
          connectorInstanceId: instance.id,
          connectorEntityId: entityId,
        },
        "API endpoint soft-deleted"
      );

      return HttpService.success(res, { ok: true });
    } catch (error) {
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.REST_API_OPERATION_FAILED,
              `Failed to delete api endpoint: ${(error as Error).message}`
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/connector-instances/{instanceId}/api-endpoints/{entityId}/discover-columns:
 *   post:
 *     tags:
 *       - REST API Endpoints
 *     summary: Probe + infer columns for a configured endpoint
 *     description: >
 *       Phase-4 probe entry point. Drives a single page-1 fetch
 *       against the endpoint, runs heuristic type inference over up
 *       to 25 records, and optionally enriches each column with an
 *       AI-assist suggestion (Haiku 4.5) when the classifier dep is
 *       wired. Results are cached for 60 seconds per `connectorEntityId`.
 *       `forceRefresh: true` invalidates the cache and re-runs both
 *       layers. The response's `degradation` field communicates
 *       AI-assist availability — `null` is fully successful,
 *       `"llm-disabled"` means no classifier wired, `"llm-failed"`
 *       means the classifier errored and the heuristic-only result is
 *       returned.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: instanceId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DiscoverColumnsRequestBody'
 *     responses:
 *       200:
 *         description: Probe completed (possibly with degradation)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [success, payload]
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/DiscoverColumnsResult'
 *       400:
 *         description: Invalid body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Instance or endpoint not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       502:
 *         description: >
 *           Upstream fetch failed — REST_API_FETCH_FAILED on 5xx,
 *           REST_API_AUTH_FAILED on 401/403, REST_API_INVALID_JSON on
 *           non-JSON bodies, REST_API_RECORDS_PATH_NOT_FOUND /
 *           REST_API_RECORDS_PATH_NOT_ARRAY on misconfigured
 *           recordsPath, REST_API_RATE_LIMITED on exhausted 429
 *           retries.
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
apiEndpointsRouter.post(
  "/:entityId/discover-columns",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { instanceId, entityId } = req.params as {
        instanceId: string;
        entityId: string;
      };
      const { organizationId } = req.application!.metadata;
      await requireRestApiInstance(instanceId, organizationId);

      // Parse optional body. Empty body is fine — `forceRefresh`
      // defaults to false.
      let body: { forceRefresh?: boolean };
      try {
        body = DiscoverColumnsRequestBodySchema.parse(req.body ?? {});
      } catch (err) {
        throw new ApiError(
          400,
          ApiCode.REST_API_INVALID_CONFIG,
          `Invalid discover-columns body: ${(err as Error).message}`,
          { issues: (err as z.ZodError).issues }
        );
      }

      // Load the full instance row (config + decrypted credentials)
      // so the adapter can read `baseUrl` + `auth`. requireRestApiInstance
      // returns only an id-pair for the guard.
      const fullInstance =
        await DbService.repository.connectorInstances.findById(instanceId);
      if (!fullInstance) {
        throw new ApiError(
          404,
          ApiCode.CONNECTOR_INSTANCE_NOT_FOUND,
          `Connector instance ${instanceId} not found`
        );
      }

      const endpoint = await DbService.repository.apiEndpoints.findByEntityId(
        entityId
      );
      if (!endpoint || endpoint.entity.connectorInstanceId !== instanceId) {
        throw new ApiError(
          404,
          ApiCode.REST_API_ENDPOINT_NOT_FOUND,
          `Api endpoint for entity ${entityId} not configured on instance ${instanceId}`
        );
      }

      const result = await restApiAdapter.discoverColumnsWithSamples(
        fullInstance as never,
        endpoint.entity.key,
        { forceRefresh: body.forceRefresh ?? false }
      );

      return HttpService.success(res, result, 200);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to discover columns"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.REST_API_OPERATION_FAILED,
              `Failed to discover columns: ${(error as Error).message}`
            )
      );
    }
  }
);
