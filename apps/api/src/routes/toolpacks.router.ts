import { Router, Request, Response, NextFunction } from "express";

import {
  BUILTIN_TOOLPACKS,
  BUILTIN_TOOLPACK_BY_SLUG,
  type BuiltinToolpack,
  isBuiltinToolpackSlug,
} from "@portalai/core/registries";
import {
  OrganizationToolpackModelFactory,
  type OrganizationToolpack,
  type ToolpackToolDefinition,
} from "@portalai/core/models";
import {
  ToolpackListRequestQuerySchema,
  RegisterToolpackBodySchema,
  UpdateToolpackBodySchema,
  type Toolpack,
  type CustomToolpackRecord,
  type ToolpackListResponsePayload,
  type ToolpackGetResponsePayload,
  type ToolpackRegisterResponsePayload,
  type ToolpackUpdateResponsePayload,
  type ToolpackRefreshResponsePayload,
  type ToolpackRotateSigningSecretResponsePayload,
  type ToolpackDeleteResponsePayload,
} from "@portalai/core/contracts";

import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "../services/db.service.js";
import { TierService } from "../services/tier.service.js";
import { ToolpackRegistrationService } from "../services/toolpack-registration.service.js";
import { BUILTIN_TOOL_NAMES } from "../services/tools.service.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { eq, and, isNull } from "drizzle-orm";
import { stationToolpacks } from "../db/schema/index.js";
import { generateSigningSecret } from "../utils/webhook-signing.util.js";

const logger = createLogger({ module: "toolpacks" });

export const toolpacksRouter = Router();

// ── Conversion helpers ──────────────────────────────────────────────

function toBuiltinApiRecord(pack: BuiltinToolpack): Toolpack {
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

function toCustomApiRecord(row: OrganizationToolpack): CustomToolpackRecord {
  return {
    id: row.id,
    kind: "custom",
    slug: row.name,
    name: row.name,
    description: row.description,
    iconSlug: "Extension",
    tools: row.tools,
    endpoints: row.endpoints,
    authHeadersStatus: {
      has: row.authHeaders !== null && Object.keys(row.authHeaders).length > 0,
    },
    // signingSecret is NOT NULL post-phase-6, so presence is always
    // true; the field exists for forward-compat with future shapes.
    signingSecretStatus: { has: true },
    schemaFetchedAt: row.schemaFetchedAt,
    metadataFetchedAt: row.metadataFetchedAt,
  };
}

function matchesBuiltinSearch(query: string, pack: BuiltinToolpack): boolean {
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

function matchesCustomSearch(
  query: string,
  pack: OrganizationToolpack
): boolean {
  if (
    pack.name.toLowerCase().includes(query) ||
    (pack.description ?? "").toLowerCase().includes(query)
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

// ---------------------------------------------------------------------------
// GET /api/toolpacks — merged list
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/toolpacks:
 *   get:
 *     tags:
 *       - Toolpacks
 *     summary: List toolpacks (built-in + custom)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: kind
 *         schema: { type: string, enum: [builtin, custom] }
 *     responses:
 *       200: { description: Toolpacks retrieved successfully. }
 */
toolpacksRouter.get(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { search, kind } = ToolpackListRequestQuerySchema.parse(req.query);
      const { organizationId } = req.application!.metadata;

      const builtinList: Toolpack[] =
        kind === "custom" ? [] : BUILTIN_TOOLPACKS.map(toBuiltinApiRecord);

      const customRows =
        kind === "builtin"
          ? []
          : await DbService.repository.organizationToolpacks.findByOrganizationId(
              organizationId
            );
      const customList: Toolpack[] = customRows.map((r) =>
        toCustomApiRecord(r as unknown as OrganizationToolpack)
      );

      const all = [...builtinList, ...customList];

      const filtered = search
        ? (() => {
            const q = search.toLowerCase();
            return all.filter((t) => {
              if (t.kind === "builtin") {
                const pack = BUILTIN_TOOLPACK_BY_SLUG[t.slug as never];
                return pack ? matchesBuiltinSearch(q, pack) : false;
              }
              const row = customRows.find((r) => r.id === t.id);
              return row
                ? matchesCustomSearch(q, row as unknown as OrganizationToolpack)
                : false;
            });
          })()
        : all;

      return HttpService.success<ToolpackListResponsePayload>(res, {
        toolpacks: filtered,
        total: filtered.length,
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

// ---------------------------------------------------------------------------
// GET /api/toolpacks/:id
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/toolpacks/{id}:
 *   get:
 *     tags: [Toolpacks]
 *     summary: Get a toolpack by id (builtin:<slug> or custom UUID)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Toolpack found. }
 *       404: { description: Toolpack not found. }
 */
toolpacksRouter.get(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { organizationId } = req.application!.metadata;

      if (id.startsWith("builtin:")) {
        const slug = id.slice("builtin:".length);
        if (!isBuiltinToolpackSlug(slug)) {
          return next(
            new ApiError(404, ApiCode.TOOLPACK_NOT_FOUND, "Toolpack not found")
          );
        }
        return HttpService.success<ToolpackGetResponsePayload>(res, {
          toolpack: toBuiltinApiRecord(BUILTIN_TOOLPACK_BY_SLUG[slug]),
        });
      }

      // Custom: id must be a stored row scoped to the requesting org.
      const row =
        await DbService.repository.organizationToolpacks.findByIdScoped(
          id,
          organizationId
        );
      if (!row) {
        return next(
          new ApiError(404, ApiCode.TOOLPACK_NOT_FOUND, "Toolpack not found")
        );
      }
      return HttpService.success<ToolpackGetResponsePayload>(res, {
        toolpack: toCustomApiRecord(row as unknown as OrganizationToolpack),
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

// ---------------------------------------------------------------------------
// POST /api/toolpacks — register
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/toolpacks:
 *   post:
 *     tags: [Toolpacks]
 *     summary: Register a custom toolpack
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Registered. }
 *       400: { description: Invalid payload. }
 *       403: { description: The organization's tier does not include custom toolpacks (#214). }
 *       409: { description: Pack name or tool-name conflict. }
 *       502: { description: Schema or metadata fetch / validation failure. }
 */
toolpacksRouter.post(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = RegisterToolpackBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.TOOLPACK_INVALID_PAYLOAD,
            "Invalid toolpack payload"
          )
        );
      }
      const { organizationId, userId } = req.application!.metadata;
      const { name, description, endpoints, authHeaders } = parsed.data;

      // #214 entitlement gate — register is the only gated toolpack
      // mutation (OQ3): it CREATES entitlement-bearing capability, and it
      // triggers outbound schema fetches. Management of existing packs
      // (PATCH/refresh/DELETE) stays open; their tools are already
      // excluded from the agent build while unentitled.
      const org =
        await DbService.repository.organizations.findById(organizationId);
      const policy = await TierService.resolveTier(org ?? { tier: "" });
      if (!policy.entitlements.customToolpacks) {
        return next(
          new ApiError(
            403,
            ApiCode.TOOLPACK_NOT_ENTITLED,
            "Your plan does not include custom toolpacks"
          )
        );
      }

      // Name uniqueness within org.
      const existing =
        await DbService.repository.organizationToolpacks.findByOrganizationId(
          organizationId
        );
      if (existing.some((p) => p.name === name)) {
        return next(
          new ApiError(
            409,
            ApiCode.TOOLPACK_NAME_CONFLICT,
            "A toolpack with this name already exists in this organization"
          )
        );
      }

      // Generate the signing secret first so the registration-time
      // schema/metadata fetches are signed with the same secret the
      // toolpack server will see on every subsequent runtime call.
      const signingSecret = generateSigningSecret();

      // Fetch + validate schema.
      const tools = await ToolpackRegistrationService.fetchSchema(
        endpoints.schema,
        authHeaders,
        signingSecret
      );
      ToolpackRegistrationService.validateNoBuiltinCollision(
        tools as ToolpackToolDefinition[],
        BUILTIN_TOOL_NAMES
      );

      // Optional metadata (best-effort).
      const metadata = endpoints.metadata
        ? await ToolpackRegistrationService.fetchMetadata(
            endpoints.metadata,
            authHeaders,
            signingSecret
          )
        : null;

      const now = Date.now();
      const factory = new OrganizationToolpackModelFactory();
      const model = factory.create(userId);
      model.update({
        organizationId,
        name,
        description: description ?? null,
        endpoints,
        authHeaders: authHeaders ?? null,
        signingSecret,
        tools,
        metadata,
        schemaFetchedAt: now,
        metadataFetchedAt: metadata !== null ? now : null,
      });

      const row = await DbService.repository.organizationToolpacks.create(
        model.parse() as never
      );

      logger.info({ id: row.id, organizationId }, "Toolpack registered");

      // Surface the freshly-generated signing secret exactly once.
      // GET / PATCH / refresh responses omit this field; admins who
      // lose the secret rotate via POST /:id/rotate-signing-secret.
      return HttpService.success<ToolpackRegisterResponsePayload>(
        res,
        {
          toolpack: toCustomApiRecord(row as unknown as OrganizationToolpack),
          signingSecret,
        },
        201
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to register toolpack"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.TOOLPACK_NOT_FOUND,
              "Failed to register toolpack"
            )
      );
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /api/toolpacks/:id — update
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/toolpacks/{id}:
 *   patch:
 *     tags: [Toolpacks]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Updated. }
 *       404: { description: Not found. }
 *       409: { description: Name conflict. }
 *       502: { description: Schema fetch / validation failure. }
 */
toolpacksRouter.patch(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { organizationId, userId } = req.application!.metadata;

      const parsed = UpdateToolpackBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.TOOLPACK_INVALID_PAYLOAD,
            "Invalid toolpack payload"
          )
        );
      }

      const existing =
        await DbService.repository.organizationToolpacks.findByIdScoped(
          id,
          organizationId
        );
      if (!existing) {
        return next(
          new ApiError(404, ApiCode.TOOLPACK_NOT_FOUND, "Toolpack not found")
        );
      }

      const { name, description, endpoints, authHeaders } = parsed.data;

      // Name uniqueness on rename.
      if (name !== undefined && name !== existing.name) {
        const others =
          await DbService.repository.organizationToolpacks.findByOrganizationId(
            organizationId
          );
        if (others.some((p) => p.name === name)) {
          return next(
            new ApiError(
              409,
              ApiCode.TOOLPACK_NAME_CONFLICT,
              "A toolpack with this name already exists in this organization"
            )
          );
        }
      }

      const updates: Record<string, unknown> = {
        updated: Date.now(),
        updatedBy: userId,
      };
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (authHeaders !== undefined) updates.authHeaders = authHeaders;

      // Re-fetch schema if endpoints changed.
      if (endpoints !== undefined) {
        const effectiveAuth = authHeaders ?? existing.authHeaders ?? undefined;
        const tools = await ToolpackRegistrationService.fetchSchema(
          endpoints.schema,
          effectiveAuth as Record<string, string> | undefined,
          existing.signingSecret
        );
        ToolpackRegistrationService.validateNoBuiltinCollision(
          tools as ToolpackToolDefinition[],
          BUILTIN_TOOL_NAMES
        );
        const metadata = endpoints.metadata
          ? await ToolpackRegistrationService.fetchMetadata(
              endpoints.metadata,
              effectiveAuth as Record<string, string> | undefined,
              existing.signingSecret
            )
          : null;
        const now = Date.now();
        updates.endpoints = endpoints;
        updates.tools = tools;
        updates.metadata = metadata;
        updates.schemaFetchedAt = now;
        updates.metadataFetchedAt = metadata !== null ? now : null;
      }

      const row = await DbService.repository.organizationToolpacks.update(
        id,
        updates as never
      );

      logger.info({ id }, "Toolpack updated");

      return HttpService.success<ToolpackUpdateResponsePayload>(res, {
        toolpack: toCustomApiRecord(row as unknown as OrganizationToolpack),
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to update toolpack"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.TOOLPACK_NOT_FOUND,
              "Failed to update toolpack"
            )
      );
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/toolpacks/:id — soft-delete + cascade station_toolpacks
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/toolpacks/{id}:
 *   delete:
 *     tags: [Toolpacks]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Soft-deleted. }
 *       404: { description: Not found. }
 */
toolpacksRouter.delete(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { organizationId, userId } = req.application!.metadata;

      const existing =
        await DbService.repository.organizationToolpacks.findByIdScoped(
          id,
          organizationId
        );
      if (!existing) {
        return next(
          new ApiError(404, ApiCode.TOOLPACK_NOT_FOUND, "Toolpack not found")
        );
      }

      // Find affected station_toolpack rows BEFORE the soft-delete so we
      // can return their stationIds.
      const affected = await DbService.transaction(async (tx) => {
        const stRows = await tx
          .select()
          .from(stationToolpacks)
          .where(
            and(
              eq(stationToolpacks.organizationToolpackId, id),
              isNull(stationToolpacks.deleted)
            )
          );
        const affectedStationIds = stRows.map((r) => r.stationId);

        // Cascade soft-delete the join rows.
        if (stRows.length > 0) {
          await DbService.repository.stationToolpacks.softDeleteMany(
            stRows.map((r) => r.id),
            userId,
            tx
          );
        }
        // Soft-delete the toolpack itself.
        await DbService.repository.organizationToolpacks.softDelete(
          id,
          userId,
          tx
        );

        return affectedStationIds;
      });

      logger.info({ id, affected }, "Toolpack soft-deleted");

      return HttpService.success<ToolpackDeleteResponsePayload>(res, {
        id,
        affectedStationIds: affected,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to delete toolpack"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.TOOLPACK_NOT_FOUND,
              "Failed to delete toolpack"
            )
      );
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/toolpacks/:id/refresh — re-fetch schema (and metadata)
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/toolpacks/{id}/refresh:
 *   post:
 *     tags: [Toolpacks]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Refreshed. }
 *       404: { description: Not found. }
 *       502: { description: Schema fetch failed (cached values preserved). }
 */
toolpacksRouter.post(
  "/:id/refresh",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { organizationId, userId } = req.application!.metadata;

      const existing =
        await DbService.repository.organizationToolpacks.findByIdScoped(
          id,
          organizationId
        );
      if (!existing) {
        return next(
          new ApiError(404, ApiCode.TOOLPACK_NOT_FOUND, "Toolpack not found")
        );
      }

      const auth = (existing.authHeaders ?? undefined) as
        | Record<string, string>
        | undefined;
      const tools = await ToolpackRegistrationService.fetchSchema(
        existing.endpoints.schema,
        auth,
        existing.signingSecret
      );
      ToolpackRegistrationService.validateNoBuiltinCollision(
        tools as ToolpackToolDefinition[],
        BUILTIN_TOOL_NAMES
      );
      const metadata = existing.endpoints.metadata
        ? await ToolpackRegistrationService.fetchMetadata(
            existing.endpoints.metadata,
            auth,
            existing.signingSecret
          )
        : null;

      const now = Date.now();
      const row = await DbService.repository.organizationToolpacks.update(id, {
        updated: now,
        updatedBy: userId,
        tools,
        metadata,
        schemaFetchedAt: now,
        metadataFetchedAt: metadata !== null ? now : null,
      } as never);

      logger.info({ id }, "Toolpack refreshed");

      return HttpService.success<ToolpackRefreshResponsePayload>(res, {
        toolpack: toCustomApiRecord(row as unknown as OrganizationToolpack),
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to refresh toolpack"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.TOOLPACK_NOT_FOUND,
              "Failed to refresh toolpack"
            )
      );
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/toolpacks/:id/rotate-signing-secret — invalidate + reveal a fresh
// HMAC signing secret. Stripe-style: the new value is returned exactly once;
// the old value is invalidated immediately on success.
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/toolpacks/{id}/rotate-signing-secret:
 *   post:
 *     tags: [Toolpacks]
 *     summary: Rotate the per-toolpack HMAC signing secret
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Rotated. Returns the new signingSecret once. }
 *       404: { description: Not found. }
 */
toolpacksRouter.post(
  "/:id/rotate-signing-secret",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { organizationId, userId } = req.application!.metadata;

      const existing =
        await DbService.repository.organizationToolpacks.findByIdScoped(
          id,
          organizationId
        );
      if (!existing) {
        return next(
          new ApiError(404, ApiCode.TOOLPACK_NOT_FOUND, "Toolpack not found")
        );
      }

      const newSecret = generateSigningSecret();
      const now = Date.now();
      await DbService.repository.organizationToolpacks.update(id, {
        signingSecret: newSecret,
        updated: now,
        updatedBy: userId,
      } as never);

      logger.info({ id, organizationId }, "Toolpack signing secret rotated");

      return HttpService.success<ToolpackRotateSigningSecretResponsePayload>(
        res,
        { id, signingSecret: newSecret, rotatedAt: now }
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown" },
        "Failed to rotate toolpack signing secret"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.TOOLPACK_NOT_FOUND,
              "Failed to rotate signing secret"
            )
      );
    }
  }
);
