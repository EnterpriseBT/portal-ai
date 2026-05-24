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
  ApiEndpointConfigSchema,
  type ApiEndpointConfig,
  type PaginationConfig,
} from "@portalai/core/models";
import { DiscoverColumnsRequestBodySchema } from "@portalai/core/contracts";
import type { ApiEndpoint } from "../db/repositories/api-endpoints.repository.js";
import { reconstructPagination } from "../adapters/rest-api/pagination/index.js";
import { restApiAdapter } from "../adapters/rest-api/rest-api.adapter.js";

const logger = createLogger({ module: "api-endpoints" });

// The router is mounted with `mergeParams: true` under
// `/api/connector-instances/:instanceId/api-endpoints` so it can read
// `req.params.instanceId` from the parent path.
export const apiEndpointsRouter = Router({ mergeParams: true });

// ── Validation schemas ────────────────────────────────────────────────

const CreateApiEndpointRequestBodySchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  config: ApiEndpointConfigSchema,
});

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

// ── Routes ────────────────────────────────────────────────────────────

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

      logger.info(
        {
          event: "api-endpoints.created",
          connectorInstanceId: instance.id,
          connectorEntityId: result.entity.id,
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
 * POST /api/connector-instances/:instanceId/api-endpoints/:entityId/discover-columns
 *
 * Phase 4 probe entry point. Drives a single page-1 fetch against the
 * configured endpoint, runs the heuristic + (optional) AI-assist
 * inference pipeline, and returns a `DiscoverColumnsResult` shape
 * (columns + samples + suggestions + degradation + source).
 *
 * The route layer is intentionally thin: ownership / locking guards,
 * body parsing, and dispatch into the adapter. The adapter owns
 * cache lookup, classifier failure handling, and merge logic.
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
