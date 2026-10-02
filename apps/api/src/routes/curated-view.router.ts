import { Router, Request, Response, NextFunction } from "express";
import { eq, and, ilike, inArray, type SQL, type Column } from "drizzle-orm";

import {
  CuratedViewModelFactory,
  CuratedViewFieldMappingModelFactory,
  StationViewModelFactory,
} from "@portalai/core/models";
import {
  CuratedViewListRequestQuerySchema,
  type CuratedViewListResponsePayload,
  type CuratedViewGetResponsePayload,
  CuratedViewCreateRequestBodySchema,
  type CuratedViewCreateResponsePayload,
  CuratedViewUpdateRequestBodySchema,
  type CuratedViewUpdateResponsePayload,
  type CuratedViewDeleteResponsePayload,
  CuratedViewAttachRequestBodySchema,
  type CuratedViewAttachResponsePayload,
  CuratedViewRecordsRequestQuerySchema,
  type CuratedViewRecordsResponsePayload,
  validateFilterLimits,
  validateOperatorTypeCompat,
  type FilterGroup,
} from "@portalai/core/contracts";

import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "../services/db.service.js";
import { curatedViews, stationViews } from "../db/schema/index.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { PermissionService } from "../services/permission.service.js";
import type { PermissionSet } from "../services/permission-set.js";
import { StationAttachmentService } from "../services/station-attachment.service.js";
import { AuditService } from "../services/audit.service.js";
import { auditContextFromRequest } from "../utils/audit-context.util.js";
import { PortalSqlService } from "../services/portal-sql.service.js";
import { resolveColumns } from "../utils/resolve-columns.util.js";

const logger = createLogger({ module: "curated-view" });

export const curatedViewRouter = Router();

/** Sortable field names → their Drizzle columns. */
const SORTABLE_COLUMNS: Record<string, Column> = {
  label: curatedViews.label,
  key: curatedViews.key,
  created: curatedViews.created,
};

/**
 * Validate a `FilterGroup` against an entity's column types (depth/count
 * limits + operator↔type compatibility). Throws `CURATED_VIEW_INVALID_FILTER`.
 * Structural shape is already checked by the request-body schema.
 */
async function validateFilter(
  filter: FilterGroup,
  connectorEntityId: string
): Promise<void> {
  const limitsError = validateFilterLimits(filter);
  if (limitsError) {
    throw new ApiError(400, ApiCode.CURATED_VIEW_INVALID_FILTER, limitsError);
  }
  const columnTypes = Object.fromEntries(
    (await resolveColumns(connectorEntityId)).map((c) => [
      c.normalizedKey,
      c.type,
    ])
  );
  const compatErrors = validateOperatorTypeCompat(filter, columnTypes);
  if (compatErrors.length > 0) {
    throw new ApiError(
      400,
      ApiCode.CURATED_VIEW_INVALID_FILTER,
      compatErrors[0]
    );
  }
}

/**
 * The self-exposure guard: the caller must independently `read` every field
 * mapping in the *effective* projection — the explicit `fieldMappingIds`, or
 * (when omitted = unrestricted) all of the entity's current field mappings.
 * A view-editor can only expose fields they already hold. Throws
 * `CURATED_VIEW_FIELD_NOT_READABLE` (403).
 */
async function assertFieldsReadable(
  set: Awaited<ReturnType<typeof PermissionService.loadSet>>,
  connectorEntityId: string,
  fieldMappingIds: string[] | undefined
): Promise<void> {
  const effective =
    fieldMappingIds && fieldMappingIds.length > 0
      ? fieldMappingIds
      : (
          await DbService.repository.fieldMappings.findByConnectorEntityId(
            connectorEntityId
          )
        ).map((m) => m.id);
  for (const id of effective) {
    if (!set.can("resource.read", { type: "field_mapping", id })) {
      throw new ApiError(
        403,
        ApiCode.CURATED_VIEW_FIELD_NOT_READABLE,
        "You cannot project a field mapping you do not have read access to"
      );
    }
  }
}

/**
 * @openapi
 * /api/curated-views:
 *   get:
 *     tags: [Curated Views]
 *     summary: List curated views
 *     description: Paginated list of curated views the caller may read, scoped to their organization.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/limitParam'
 *       - $ref: '#/components/parameters/offsetParam'
 *       - $ref: '#/components/parameters/sortOrderParam'
 *       - { in: query, name: sortBy, schema: { type: string, enum: [label, key, created], default: created } }
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: connectorEntityId, schema: { type: string } }
 *       - { in: query, name: stationId, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Paginated curated views
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 payload:
 *                   type: object
 *                   properties:
 *                     curatedViews: { type: array, items: { $ref: '#/components/schemas/CuratedViewListItem' } }
 *                     total: { type: integer }
 *                     limit: { type: integer }
 *                     offset: { type: integer }
 */
curatedViewRouter.get(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        limit,
        offset,
        sortBy,
        sortOrder,
        search,
        connectorEntityId,
        stationId,
      } = CuratedViewListRequestQuerySchema.parse(req.query);
      const { organizationId } = req.application!.metadata;

      const filters: SQL[] = [eq(curatedViews.organizationId, organizationId)];
      if (connectorEntityId) {
        filters.push(eq(curatedViews.connectorEntityId, connectorEntityId));
      }
      // #599: restrict to a station's attached views (station_views). Resolve
      // the attachment ids first; none → empty result (the caller sees no views
      // attached to this station).
      if (stationId) {
        const attachments =
          await DbService.repository.stationViews.findByStationId(stationId);
        const attachedIds = attachments.map((a) => a.curatedViewId);
        if (attachedIds.length === 0) {
          return HttpService.success<CuratedViewListResponsePayload>(res, {
            curatedViews: [],
            total: 0,
            limit,
            offset,
          });
        }
        filters.push(inArray(curatedViews.id, attachedIds));
      }
      if (search) {
        filters.push(ilike(curatedViews.label, `%${search}%`));
      }
      // Row-level read scoping: only the views the caller may read.
      const visibility = (
        await PermissionService.loadSet(req.application!.metadata)
      ).visibilityPredicate("curated_view", {
        createdByCol: curatedViews.createdBy,
        idCol: curatedViews.id,
      });
      if (visibility) filters.push(visibility);

      const where = and(...filters);
      const column = SORTABLE_COLUMNS[sortBy] ?? SORTABLE_COLUMNS.created;

      const [data, total] = await Promise.all([
        // #646: enrich each view with its connector entity's key + label.
        DbService.repository.curatedViews.findManyWithEntity(where, {
          limit,
          offset,
          orderBy: { column, direction: sortOrder },
        }),
        DbService.repository.curatedViews.count(where),
      ]).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          500,
          ApiCode.CURATED_VIEW_FETCH_FAILED,
          "Failed to list curated views"
        );
      });

      return HttpService.success<CuratedViewListResponsePayload>(res, {
        curatedViews:
          data as unknown as CuratedViewListResponsePayload["curatedViews"],
        total,
        limit,
        offset,
      });
    } catch (error) {
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.CURATED_VIEW_FETCH_FAILED,
              "Failed to list curated views"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/curated-views/{id}:
 *   get:
 *     tags: [Curated Views]
 *     summary: Get a curated view (with its projection)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: The curated view }
 *       404: { description: Not found or not readable }
 */
curatedViewRouter.get(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { organizationId } = req.application!.metadata;
      const view = await DbService.repository.curatedViews.findById(id);
      if (!view || view.organizationId !== organizationId) {
        return next(
          new ApiError(
            404,
            ApiCode.CURATED_VIEW_NOT_FOUND,
            "Curated view not found"
          )
        );
      }
      // Unreadable == absent.
      const canRead = (
        await PermissionService.loadSet(req.application!.metadata)
      ).can("resource.read", {
        type: "curated_view",
        id: view.id,
        createdBy: view.createdBy,
      });
      if (!canRead) {
        return next(
          new ApiError(
            404,
            ApiCode.CURATED_VIEW_NOT_FOUND,
            "Curated view not found"
          )
        );
      }
      const projection =
        await DbService.repository.curatedViewFieldMappings.findByCuratedViewId(
          view.id
        );
      return HttpService.success<CuratedViewGetResponsePayload>(res, {
        curatedView: {
          ...(view as unknown as CuratedViewGetResponsePayload["curatedView"]),
          fieldMappingIds: projection.map((p) => p.fieldMappingId),
        },
      });
    } catch (error) {
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.CURATED_VIEW_FETCH_FAILED,
              "Failed to fetch curated view"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/curated-views:
 *   post:
 *     tags: [Curated Views]
 *     summary: Create a curated view
 *     description: Admin-only (holds unconditional `write curated_view`). Validates the filter and enforces the self-exposure guard on the projection.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Created }
 *       400: { description: Invalid payload or filter }
 *       403: { description: "Not permitted, or a projected field is not readable" }
 *       409: { description: Duplicate key }
 */
curatedViewRouter.post(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CuratedViewCreateRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.CURATED_VIEW_INVALID_PAYLOAD,
            "Invalid curated view payload"
          )
        );
      }
      const { organizationId, userId } = req.application!.metadata;
      const body = parsed.data;

      // Creation is reserved to holders of an unconditional `write curated_view`
      // (owner/admin) — a class-level check (no ownership) excludes a member's
      // `created_by_caller` write.
      const set = await PermissionService.loadSet(req.application!.metadata);
      set.check("resource.write", { type: "curated_view" });

      // The connector entity must exist in this org.
      const entity = await DbService.repository.connectorEntities.findById(
        body.connectorEntityId
      );
      if (!entity || entity.organizationId !== organizationId) {
        return next(
          new ApiError(
            400,
            ApiCode.CURATED_VIEW_INVALID_PAYLOAD,
            "Unknown connector entity"
          )
        );
      }

      if (body.filter)
        await validateFilter(body.filter, body.connectorEntityId);
      await assertFieldsReadable(
        set,
        body.connectorEntityId,
        body.fieldMappingIds
      );

      const duplicate = await DbService.repository.curatedViews.findByKey(
        organizationId,
        body.key
      );
      if (duplicate) {
        return next(
          new ApiError(
            409,
            ApiCode.CURATED_VIEW_DUPLICATE_KEY,
            "A curated view with this key already exists in this organization"
          )
        );
      }

      const factory = new CuratedViewModelFactory();
      const model = factory.create(userId);
      model.update({
        organizationId,
        connectorEntityId: body.connectorEntityId,
        key: body.key,
        label: body.label,
        description: body.description ?? null,
        filter: body.filter ?? null,
      });
      const row = model.parse();

      const created = await DbService.transaction(async (tx) => {
        const view = await DbService.repository.curatedViews.create(
          row as never,
          tx
        );
        if (body.fieldMappingIds && body.fieldMappingIds.length > 0) {
          const fmFactory = new CuratedViewFieldMappingModelFactory();
          const rows = body.fieldMappingIds.map((fieldMappingId) => {
            const m = fmFactory.create(userId);
            m.update({
              organizationId,
              curatedViewId: (view as { id: string }).id,
              fieldMappingId,
            });
            return m.parse();
          });
          await DbService.repository.curatedViewFieldMappings.createMany(
            rows as never,
            tx
          );
        }
        return view;
      }).catch((error) => {
        if (error instanceof ApiError) throw error;
        logger.error({ error }, "curated view create failed");
        throw new ApiError(
          500,
          ApiCode.CURATED_VIEW_CREATE_FAILED,
          "Failed to create curated view"
        );
      });

      return HttpService.success<CuratedViewCreateResponsePayload>(
        res,
        {
          curatedView:
            created as unknown as CuratedViewCreateResponsePayload["curatedView"],
        },
        201
      );
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * @openapi
 * /api/curated-views/{id}:
 *   patch:
 *     tags: [Curated Views]
 *     summary: Update a curated view
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Updated }
 *       403: { description: "Not permitted, or an added field is not readable" }
 *       404: { description: Not found }
 */
curatedViewRouter.patch(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CuratedViewUpdateRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.CURATED_VIEW_INVALID_PAYLOAD,
            "Invalid curated view payload"
          )
        );
      }
      const { organizationId, userId } = req.application!.metadata;
      const body = parsed.data;

      const existing = await DbService.repository.curatedViews.findById(
        req.params.id
      );
      if (!existing || existing.organizationId !== organizationId) {
        return next(
          new ApiError(
            404,
            ApiCode.CURATED_VIEW_NOT_FOUND,
            "Curated view not found"
          )
        );
      }
      await PermissionService.check(
        req.application!.metadata,
        "resource.write",
        {
          type: "curated_view",
          id: existing.id,
          createdBy: existing.createdBy,
        }
      );

      if (body.filter) {
        await validateFilter(body.filter, existing.connectorEntityId);
      }
      if (body.fieldMappingIds) {
        const set = await PermissionService.loadSet(req.application!.metadata);
        await assertFieldsReadable(
          set,
          existing.connectorEntityId,
          body.fieldMappingIds
        );
      }

      const updated = await DbService.transaction(async (tx) => {
        const patch: Record<string, unknown> = {
          updated: Date.now(),
          updatedBy: userId,
        };
        if (body.label !== undefined) patch.label = body.label;
        if (body.description !== undefined)
          patch.description = body.description;
        if (body.filter !== undefined) patch.filter = body.filter;
        const view = await DbService.repository.curatedViews.update(
          existing.id,
          patch as never,
          tx
        );
        // Projection replace: drop the old rows, insert the new set.
        if (body.fieldMappingIds) {
          const old =
            await DbService.repository.curatedViewFieldMappings.findByCuratedViewId(
              existing.id,
              tx
            );
          if (old.length > 0) {
            await DbService.repository.curatedViewFieldMappings.softDeleteMany(
              old.map((r) => r.id),
              userId,
              tx
            );
          }
          if (body.fieldMappingIds.length > 0) {
            const fmFactory = new CuratedViewFieldMappingModelFactory();
            const rows = body.fieldMappingIds.map((fieldMappingId) => {
              const m = fmFactory.create(userId);
              m.update({
                organizationId,
                curatedViewId: existing.id,
                fieldMappingId,
              });
              return m.parse();
            });
            await DbService.repository.curatedViewFieldMappings.createMany(
              rows as never,
              tx
            );
          }
        }
        return view;
      }).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          500,
          ApiCode.CURATED_VIEW_UPDATE_FAILED,
          "Failed to update curated view"
        );
      });

      return HttpService.success<CuratedViewUpdateResponsePayload>(res, {
        curatedView:
          updated as unknown as CuratedViewUpdateResponsePayload["curatedView"],
      });
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * @openapi
 * /api/curated-views/{id}:
 *   delete:
 *     tags: [Curated Views]
 *     summary: Delete a curated view (cascades projection, attachments, grants)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Deleted }
 *       404: { description: Not found }
 */
curatedViewRouter.delete(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { organizationId, userId } = req.application!.metadata;
      const existing = await DbService.repository.curatedViews.findById(
        req.params.id
      );
      if (!existing || existing.organizationId !== organizationId) {
        return next(
          new ApiError(
            404,
            ApiCode.CURATED_VIEW_NOT_FOUND,
            "Curated view not found"
          )
        );
      }
      await PermissionService.check(
        req.application!.metadata,
        "resource.delete",
        {
          type: "curated_view",
          id: existing.id,
          createdBy: existing.createdBy,
        }
      );

      const cascaded = await DbService.transaction(async (tx) => {
        const fm =
          await DbService.repository.curatedViewFieldMappings.findByCuratedViewId(
            existing.id,
            tx
          );
        if (fm.length > 0) {
          await DbService.repository.curatedViewFieldMappings.softDeleteMany(
            fm.map((r) => r.id),
            userId,
            tx
          );
        }
        const attachments = await DbService.repository.stationViews.findMany(
          eq(stationViews.curatedViewId, existing.id),
          {},
          tx
        );
        if (attachments.length > 0) {
          await DbService.repository.stationViews.softDeleteMany(
            attachments.map((r) => r.id),
            userId,
            tx
          );
        }
        const grants =
          await DbService.repository.permissionGrants.hardDeleteByResource(
            organizationId,
            "curated_view",
            existing.id,
            tx
          );
        // #599: also drop the composed `in_curated_view` field grants for every
        // principal — `hardDeleteByResource` (keyed on the view id) can't match
        // them (resourceType field_mapping, resourceId null).
        await DbService.repository.permissionGrants.hardDeleteFieldGrantsByCuratedView(
          organizationId,
          existing.id,
          tx
        );
        await DbService.repository.curatedViews.softDelete(
          existing.id,
          userId,
          tx
        );
        return {
          fieldMappings: fm.length,
          stationViews: attachments.length,
          grants,
        };
      }).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          500,
          ApiCode.CURATED_VIEW_DELETE_FAILED,
          "Failed to delete curated view"
        );
      });

      return HttpService.success<CuratedViewDeleteResponsePayload>(res, {
        id: existing.id,
        cascaded,
      });
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * #674: load the station an attach/detach targets and require `resource.write`
 * on it — attaching is an edit to the station, not to the view. A station
 * that's missing, in another org or unreadable 404s, as the station GET does.
 */
async function loadWritableStation(
  req: Request,
  stationId: string
): Promise<{ set: PermissionSet }> {
  const ctx = req.application!.metadata;
  const station = await DbService.repository.stations.findById(stationId);
  const set = await PermissionService.loadSet(ctx);
  const object = station
    ? { type: "station", id: station.id, createdBy: station.createdBy }
    : undefined;
  if (
    !station ||
    station.organizationId !== ctx.organizationId ||
    !set.can("resource.read", object)
  ) {
    throw new ApiError(404, ApiCode.STATION_NOT_FOUND, "Station not found");
  }
  set.check("resource.write", object);
  return { set };
}

/** #674: the `station.attachments.change` event for a single view (post-commit, fail-open). */
async function auditViewAttachment(
  req: Request,
  stationId: string,
  change: { added: string[]; removed: string[] }
): Promise<void> {
  if (change.added.length === 0 && change.removed.length === 0) return;
  await AuditService.record({
    ...auditContextFromRequest(req),
    action: "station.attachments.change",
    targetType: "station",
    targetId: stationId,
    metadata: {
      added: { curatedViewIds: change.added, connectorInstanceIds: [] },
      removed: { curatedViewIds: change.removed, connectorInstanceIds: [] },
    },
  });
}

/**
 * @openapi
 * /api/curated-views/{id}/attach:
 *   post:
 *     tags: [Curated Views]
 *     summary: Attach a curated view to a station (station_views)
 *     description: >
 *       Requires `resource.write` on the station and `resource.read` on the view
 *       (#674); write access to the view isn't needed. Idempotent.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Attached }
 *       403: { description: "No write on the station, or the view is missing, in another org or unreadable (STATION_ATTACHMENT_NOT_READABLE)" }
 *       404: { description: Station not found }
 */
curatedViewRouter.post(
  "/:id/attach",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CuratedViewAttachRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.CURATED_VIEW_INVALID_PAYLOAD,
            "Invalid attach payload — expected { stationId }"
          )
        );
      }
      const { organizationId, userId } = req.application!.metadata;
      const { stationId } = parsed.data;
      const curatedViewId = req.params.id;

      const { set } = await loadWritableStation(req, stationId);
      await StationAttachmentService.assertAttachable(set, organizationId, {
        curatedViewIds: [curatedViewId],
      });

      const factory = new StationViewModelFactory();
      const m = factory.create(userId);
      m.update({ organizationId, stationId, curatedViewId });
      const inserted =
        await DbService.repository.stationViews.insertManyIgnoreConflicts([
          m.parse() as never,
        ]);
      await auditViewAttachment(req, stationId, {
        added: inserted.map((r) => r.curatedViewId),
        removed: [],
      });

      return HttpService.success<CuratedViewAttachResponsePayload>(res, {
        stationId,
        curatedViewId,
      });
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * @openapi
 * /api/curated-views/{id}/attach/{stationId}:
 *   delete:
 *     tags: [Curated Views]
 *     summary: Detach a curated view from a station
 *     description: >
 *       Requires `resource.write` on the station (#674). Read on the view isn't
 *       needed: detaching is an edit to the station. Soft-deletes the link.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: path, name: stationId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Detached }
 *       403: { description: No write on the station }
 *       404: { description: Station not found }
 */
curatedViewRouter.delete(
  "/:id/attach/:stationId",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.application!.metadata;
      const { id: curatedViewId, stationId } = req.params;
      await loadWritableStation(req, stationId);
      const removed =
        await DbService.repository.stationViews.softDeleteByStationAndViews(
          stationId,
          [curatedViewId],
          userId
        );
      await auditViewAttachment(req, stationId, {
        added: [],
        removed: removed > 0 ? [curatedViewId] : [],
      });
      return HttpService.success<CuratedViewAttachResponsePayload>(res, {
        stationId,
        curatedViewId,
      });
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * @openapi
 * /api/curated-views/{id}/records:
 *   get:
 *     tags: [Curated Views]
 *     summary: List the rows of a curated view (projection + filter applied)
 *     description: >
 *       Returns the view's rows scoped to the caller's readable columns and the view's filter, plus the
 *       caller's readable projected `columns` as ResolvedColumns (#678). Rows are keyed by `normalizedKey`,
 *       plus `_record_id` and `_source_id`. `sortBy` names a projected column's normalizedKey (anything else,
 *       e.g. the default `created`, falls back to the stable record-id order; an unsortable type such as json
 *       or an array is a 400). `search` is a case-insensitive substring match across the projected columns.
 *       Unreadable == 404.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - $ref: '#/components/parameters/limitParam'
 *       - $ref: '#/components/parameters/offsetParam'
 *       - $ref: '#/components/parameters/sortByParam'
 *       - $ref: '#/components/parameters/sortOrderParam'
 *       - { in: query, name: search, required: false, schema: { type: string }, description: Case-insensitive substring match across projected columns }
 *       - { in: query, name: filters, required: false, schema: { type: string }, description: "#678: base64 JSON FilterExpression (the entity records list's format) over the caller's readable projected columns, ANDed after the view's own filter (narrow-only)" }
 *     responses:
 *       200:
 *         description: Paginated records with the projected columns
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 columns:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/ResolvedColumn' }
 *                 records: { type: array, items: { type: object } }
 *                 total: { type: number }
 *                 limit: { type: number }
 *                 offset: { type: number }
 *       400: { description: "Invalid query parameters, e.g. sortOrder or limit (CURATED_VIEW_INVALID_QUERY); invalid filters, or one naming a column outside the caller's readable projection (CURATED_VIEW_INVALID_FILTER); sortBy names an unsortable column (CURATED_VIEW_INVALID_SORT)" }
 *       404: { description: Not found or not readable }
 */
curatedViewRouter.get(
  "/:id/records",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // safeParse: a bad sortOrder / limit is the caller's error (400), not a
      // thrown ZodError (500).
      const query = CuratedViewRecordsRequestQuerySchema.safeParse(req.query);
      if (!query.success) {
        return next(
          new ApiError(
            400,
            ApiCode.CURATED_VIEW_INVALID_QUERY,
            "Invalid query parameters"
          )
        );
      }
      const { limit, offset, sortBy, sortOrder, search, filters } = query.data;
      const { organizationId, userId } = req.application!.metadata;

      const result = await PortalSqlService.queryCuratedViewRecords(
        req.params.id,
        organizationId,
        userId,
        { limit, offset, sortBy, sortOrder, search, filters }
      ).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          500,
          ApiCode.CURATED_VIEW_FETCH_FAILED,
          "Failed to fetch curated view records"
        );
      });
      if (!result) {
        return next(
          new ApiError(
            404,
            ApiCode.CURATED_VIEW_NOT_FOUND,
            "Curated view not found"
          )
        );
      }

      return HttpService.success<CuratedViewRecordsResponsePayload>(res, {
        columns: result.columns,
        records: result.records,
        total: result.total,
        limit,
        offset,
      });
    } catch (error) {
      return next(error);
    }
  }
);
