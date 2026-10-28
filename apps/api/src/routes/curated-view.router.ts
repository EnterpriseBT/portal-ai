import { Router, Response, NextFunction } from "express";
import { StationViewModelFactory } from "@portalai/core/models";
import {
  CuratedViewListRequestQuerySchema,
  type CuratedViewListResponsePayload,
  type CuratedViewGetResponsePayload,
  CuratedViewCreateRequestBodySchema,
  type CuratedViewCreateResponsePayload,
  CuratedViewUpdateRequestBodySchema,
  CuratedViewFilterSqlPreviewRequestBodySchema,
  type CuratedViewFilterSqlPreviewResponsePayload,
  CuratedViewFilterSqlSuggestRequestBodySchema,
  type CuratedViewFilterSqlSuggestResponsePayload,
  type CuratedViewUpdateResponsePayload,
  type CuratedViewDeleteResponsePayload,
  CuratedViewAttachRequestBodySchema,
  type CuratedViewAttachResponsePayload,
  CuratedViewRecordsRequestQuerySchema,
  type CuratedViewRecordsResponsePayload,
} from "@portalai/core/contracts";

import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { invalidPayload } from "../utils/zod-issue.util.js";
import { DbService } from "../services/db.service.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { PermissionService } from "../services/permission.service.js";
import { ObjectAccessService } from "../services/object-access.service.js";
import type { PermissionSet } from "../services/permission-set.js";
import { StationAttachmentService } from "../services/station-attachment.service.js";
import { AuditService } from "../services/audit.service.js";
import { auditContextFromRequest } from "../utils/audit-context.util.js";
import { PortalSqlService } from "../services/portal-sql.service.js";
import { CuratedViewService } from "../services/curated-view.service.js";
import { CuratedViewFilterSqlService } from "../services/curated-view-filter-sql.service.js";

import type { Request } from "../types/request.js";

export const curatedViewRouter = Router();

/**
 * @openapi
 * /api/curated-views:
 *   get:
 *     tags: [Curated Views]
 *     summary: List curated views
 *     description: Paginated list of curated views the caller may read, scoped to their organization. Each row's `filter` is null for a caller without write on that view; `filtered` / `projected` say whether it filters rows or selects columns (#680).
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
 *       400:
 *         description: Malformed query, e.g. limit, offset or sortOrder (CURATED_VIEW_INVALID_QUERY)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
curatedViewRouter.get(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    // #756: a malformed query is a 400 naming the field, not a 500.
    const parsedQuery = CuratedViewListRequestQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return next(
        invalidPayload(
          ApiCode.CURATED_VIEW_INVALID_QUERY,
          "Invalid curated view list query",
          parsedQuery.error
        )
      );
    }
    try {
      return HttpService.success<CuratedViewListResponsePayload>(
        res,
        await CuratedViewService.list(
          req.application!.metadata,
          parsedQuery.data
        )
      );
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
 *     description: >
 *       A caller with write on the view gets its full definition. Any other
 *       reader gets `filter: null`, only the projection's field mappings they
 *       can read in `fieldMappingIds`, and `filtered` / `projected` (#680).
 *       `columns` pairs each projected field mapping with its key, null for a
 *       mapping that has since been deleted (#645).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: The curated view, as the caller may see it
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CuratedViewGetResponsePayload'
 *       404: { description: Not found or not readable }
 */
curatedViewRouter.get(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      return HttpService.success<CuratedViewGetResponsePayload>(res, {
        curatedView: await CuratedViewService.get(
          req.application!.metadata,
          req.params.id
        ),
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
 *     description: Needs an unconditional `write curated_view` (a create rule of `class`, #708). Validates the filter, and checks the projection (fieldMappingIds): every id is a column of the entity, there are no duplicates, and the caller can read the entity.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Created }
 *       400: { description: "Invalid payload or filter, or a projection (fieldMappingIds) with a duplicate or an id that is not a column of the entity (CURATED_VIEW_INVALID_PAYLOAD). A `filterSql` that fails validation or its dry-run against the entity's columns is CURATED_VIEW_INVALID_FILTER_SQL (details.position for a refused construct, #644)" }
 *       403: { description: "Not permitted, or a `filterSql` on a plan without advanced view filters (CURATED_VIEW_FILTER_SQL_NOT_ENTITLED, #644)" }
 *       409: { description: Duplicate key }
 *       503: { description: "A `filterSql` can't be checked: the SQL reader role is unavailable (PORTAL_SQL_UNAVAILABLE)" }
 */
curatedViewRouter.post(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CuratedViewCreateRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          invalidPayload(
            ApiCode.CURATED_VIEW_INVALID_PAYLOAD,
            "Invalid curated view payload",
            parsed.error
          )
        );
      }
      const created = await CuratedViewService.create(
        req.application!.metadata,
        parsed.data
      );
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
 *       400: { description: "Invalid filter, or a projection (fieldMappingIds) with a duplicate or an id that is not a column of the view's entity (CURATED_VIEW_INVALID_PAYLOAD). A new `filterSql` that fails validation or its dry-run is CURATED_VIEW_INVALID_FILTER_SQL (#644). Setting `filter` clears `filterSql` and vice versa; both at once is a 400" }
 *       403: { description: "Not permitted, or the projection or filter changes and the caller can't read the view's entity (#829, PERMISSION_DENIED). Resending the stored fieldMappingIds (in any order) or filter is no change and isn't checked. A new `filterSql` on a plan without advanced view filters is CURATED_VIEW_FILTER_SQL_NOT_ENTITLED (#644); resending the stored one, or clearing it, needs no entitlement." }
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
          invalidPayload(
            ApiCode.CURATED_VIEW_INVALID_PAYLOAD,
            "Invalid curated view payload",
            parsed.error
          )
        );
      }
      const updated = await CuratedViewService.update(
        req.application!.metadata,
        req.params.id,
        parsed.data
      );
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
      return HttpService.success<CuratedViewDeleteResponsePayload>(
        res,
        await CuratedViewService.delete(
          req.application!.metadata,
          req.params.id
        )
      );
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
 * #644: who may author a SQL filter for `connectorEntityId`, in the order a
 * refusal is decided (permission before tier, #688). The entity must be in
 * the org and readable (else 404). Editing an existing view (`curatedViewId`)
 * needs write on it, and it must be a view of that entity; drafting a new one
 * needs the curated-view create rule. Then the tier's entitlement.
 */
async function authorizeFilterSqlAuthoring(
  req: Request,
  body: { connectorEntityId: string; curatedViewId?: string }
): Promise<void> {
  const { organizationId } = req.application!.metadata;
  const set = await PermissionService.loadSet(req.application!.metadata);
  const entity = await DbService.repository.connectorEntities.findById(
    body.connectorEntityId
  );
  if (
    !ObjectAccessService.readableInOrg(set, organizationId, "entity", entity)
  ) {
    throw new ApiError(
      404,
      ApiCode.CONNECTOR_ENTITY_NOT_FOUND,
      "Connector entity not found"
    );
  }
  if (body.curatedViewId) {
    const view = ObjectAccessService.loadForVerb(
      set,
      organizationId,
      "curated_view",
      await DbService.repository.curatedViews.findById(body.curatedViewId),
      "write",
      () =>
        new ApiError(
          404,
          ApiCode.CURATED_VIEW_NOT_FOUND,
          "Curated view not found"
        )
    );
    if (view.connectorEntityId !== body.connectorEntityId) {
      throw new ApiError(
        400,
        ApiCode.CURATED_VIEW_INVALID_PAYLOAD,
        "The view belongs to a different entity"
      );
    }
  } else {
    // The same class-level rule as creating a view (#708).
    set.check("resource.write", { type: "curated_view" });
  }
  await CuratedViewFilterSqlService.assertEntitled(organizationId);
}

/**
 * @openapi
 * /api/curated-views/filter-sql/preview:
 *   post:
 *     tags: [Curated Views]
 *     summary: Preview the rows a draft SQL filter selects
 *     description: "#644. Validates the filter like a save would, then returns up to 25 of the rows it selects (no total), read as the restricted SQL role under the statement timeout. Needs read on the entity, write on `curatedViewId` when given (else the curated-view create rule), and a plan with advanced view filters. Writes nothing."
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CuratedViewFilterSqlPreviewRequestBody' }
 *     responses:
 *       200:
 *         description: The first rows
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 payload: { $ref: '#/components/schemas/CuratedViewFilterSqlPreviewResponsePayload' }
 *       400: { description: "Invalid payload (CURATED_VIEW_INVALID_PAYLOAD), or a filter refused by validation or by Postgres (CURATED_VIEW_INVALID_FILTER_SQL)" }
 *       403: { description: "Not permitted (PERMISSION_DENIED), or the plan excludes advanced view filters (CURATED_VIEW_FILTER_SQL_NOT_ENTITLED)" }
 *       404: { description: "The entity or the view isn't readable here" }
 *       503: { description: "The restricted SQL role is unavailable (PORTAL_SQL_UNAVAILABLE)" }
 */
curatedViewRouter.post(
  "/filter-sql/preview",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CuratedViewFilterSqlPreviewRequestBodySchema.safeParse(
        req.body
      );
      if (!parsed.success) {
        return next(
          invalidPayload(
            ApiCode.CURATED_VIEW_INVALID_PAYLOAD,
            "Invalid filter preview payload",
            parsed.error
          )
        );
      }
      const body = parsed.data;
      await authorizeFilterSqlAuthoring(req, body);
      const payload = await CuratedViewFilterSqlService.preview({
        organizationId: req.application!.metadata.organizationId,
        connectorEntityId: body.connectorEntityId,
        filterSql: body.filterSql,
        fieldMappingIds: body.fieldMappingIds,
      });
      return HttpService.success<CuratedViewFilterSqlPreviewResponsePayload>(
        res,
        payload
      );
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * @openapi
 * /api/curated-views/filter-sql/suggest:
 *   post:
 *     tags: [Curated Views]
 *     summary: Suggest a SQL filter from a description
 *     description: "#644. Asks a model for a filter matching `prompt`, given the entity's column keys and types and its JSON columns' top-level key names (no record values). The suggestion passes the same validation and dry-run as a hand-written filter; a refused one is revised once. Same authorization as the preview. Not metered. Writes nothing."
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CuratedViewFilterSqlSuggestRequestBody' }
 *     responses:
 *       200:
 *         description: A validated filter
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 payload: { $ref: '#/components/schemas/CuratedViewFilterSqlSuggestResponsePayload' }
 *       400: { description: "Invalid payload (CURATED_VIEW_INVALID_PAYLOAD)" }
 *       403: { description: "Not permitted (PERMISSION_DENIED), or the plan excludes advanced view filters (CURATED_VIEW_FILTER_SQL_NOT_ENTITLED)" }
 *       404: { description: "The entity or the view isn't readable here" }
 *       502: { description: "The model failed, or its revised suggestion still didn't validate (CURATED_VIEW_FILTER_SUGGEST_FAILED)" }
 *       503: { description: "The restricted SQL role is unavailable (PORTAL_SQL_UNAVAILABLE)" }
 */
curatedViewRouter.post(
  "/filter-sql/suggest",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CuratedViewFilterSqlSuggestRequestBodySchema.safeParse(
        req.body
      );
      if (!parsed.success) {
        return next(
          invalidPayload(
            ApiCode.CURATED_VIEW_INVALID_PAYLOAD,
            "Invalid filter suggestion payload",
            parsed.error
          )
        );
      }
      const body = parsed.data;
      await authorizeFilterSqlAuthoring(req, body);
      const payload = await CuratedViewFilterSqlService.suggest({
        organizationId: req.application!.metadata.organizationId,
        connectorEntityId: body.connectorEntityId,
        prompt: body.prompt,
        currentSql: body.currentSql,
      });
      return HttpService.success<CuratedViewFilterSqlSuggestResponsePayload>(
        res,
        payload
      );
    } catch (error) {
      return next(error);
    }
  }
);

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
          invalidPayload(
            ApiCode.CURATED_VIEW_INVALID_PAYLOAD,
            "Invalid curated view attach payload",
            parsed.error
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
 *       plus `_record_id` and `_source_id`. `sortBy` is `created` (the default, the record's creation time) or a
 *       projected column's normalizedKey; anything else falls back to the stable record-id order, and an
 *       unsortable type such as json or an array is a 400. Pages by keyset `cursor` (#649): pass the previous
 *       response's `nextCursor`. `offset` stays valid. `search` is a case-insensitive substring match across
 *       the caller's readable projected **text** columns (string, enum, reference); number and date values
 *       are reached through `filters` (#649). Unreadable == 404.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - $ref: '#/components/parameters/limitParam'
 *       - $ref: '#/components/parameters/offsetParam'
 *       - $ref: '#/components/parameters/cursorParam'
 *       - $ref: '#/components/parameters/reverseParam'
 *       - $ref: '#/components/parameters/sortByParam'
 *       - $ref: '#/components/parameters/sortOrderParam'
 *       - { in: query, name: search, required: false, schema: { type: string }, description: "Case-insensitive substring match across the readable projected text columns (#649). A view with no text column matches nothing." }
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
 *                 nextCursor: { type: [string, "null"], description: "Cursor for the following page; null on the last page (#649)" }
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
          invalidPayload(
            ApiCode.CURATED_VIEW_INVALID_QUERY,
            "Invalid curated view records query",
            query.error
          )
        );
      }
      const {
        limit,
        offset,
        sortBy,
        sortOrder,
        search,
        filters,
        cursor,
        reverse,
      } = query.data;
      const { organizationId, userId } = req.application!.metadata;

      const result = await PortalSqlService.queryCuratedViewRecords(
        req.params.id,
        organizationId,
        userId,
        { limit, offset, sortBy, sortOrder, search, filters, cursor, reverse }
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
        nextCursor: result.nextCursor,
      });
    } catch (error) {
      return next(error);
    }
  }
);
