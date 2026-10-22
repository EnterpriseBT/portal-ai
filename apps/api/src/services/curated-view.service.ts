import {
  eq,
  and,
  ilike,
  inArray,
  isNotNull,
  type SQL,
  type Column,
} from "drizzle-orm";

import {
  CuratedViewModelFactory,
  CuratedViewFieldMappingModelFactory,
} from "@portalai/core/models";
import {
  type CuratedViewListResponsePayload,
  type CuratedViewGetResponsePayload,
  type CuratedViewCreateRequestBody,
  type CuratedViewUpdateRequestBody,
  type CuratedViewDeleteResponsePayload,
  type CuratedViewListRequestQuery,
  validateFilterLimits,
  validateOperatorTypeCompat,
  type FilterGroup,
} from "@portalai/core/contracts";

import { createLogger } from "../utils/logger.util.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "./db.service.js";
import type { DbClient } from "../db/repositories/base.repository.js";
import type { CuratedViewSelect } from "../db/schema/zod.js";
import { curatedViews, fieldMappings } from "../db/schema/index.js";
import {
  PermissionService,
  type PermissionContext,
} from "./permission.service.js";
import { ObjectCapabilitiesService } from "./object-capabilities.service.js";
import { ObjectAccessService } from "./object-access.service.js";
import { permissionDenied } from "./permission-refusal.js";
import type { PermissionSet } from "./permission-set.js";
import { CuratedViewPayloadService } from "./curated-view-payload.service.js";
import { CuratedViewDeleteService } from "./curated-view-delete.service.js";
import { CuratedViewDependencyService } from "./curated-view-dependency.service.js";
import { CuratedViewFilterSqlService } from "./curated-view-filter-sql.service.js";
import { resolveColumns } from "../utils/resolve-columns.util.js";

const logger = createLogger({ module: "curated-view-service" });

/** #645: create input. `columnKeys` (tool-only) names the projection by
 *  field-mapping key instead of id; exclusive with `fieldMappingIds`. */
export type CuratedViewCreateInput = CuratedViewCreateRequestBody & {
  columnKeys?: string[];
};

/** #645: update input, with the same tool-only `columnKeys`. */
export type CuratedViewUpdateInput = CuratedViewUpdateRequestBody & {
  columnKeys?: string[];
};

/**
 * #645: the curated-view create/read/update/delete logic, shared by the REST
 * routes (`curated-view.router.ts`) and the `view_management` agent tools, so
 * the two can't drift. Every method takes the caller's `PermissionContext`,
 * loads their `PermissionSet` and runs the same checks, in the same order, the
 * routes always ran. Failures throw `ApiError`.
 */

/** Sortable field names → their Drizzle columns. */
// #756: keyed by the schema's `sortBy` enum, so every value the schema
// accepts has a column and nothing else reaches the lookup.
const SORTABLE_COLUMNS: Record<CuratedViewListRequestQuery["sortBy"], Column> =
  {
    label: curatedViews.label,
    key: curatedViews.key,
    created: curatedViews.created,
  };

const notFound = () =>
  new ApiError(404, ApiCode.CURATED_VIEW_NOT_FOUND, "Curated view not found");

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

/** #729: an entity's live field mappings, id → createdBy. */
async function fieldMappingCreators(
  connectorEntityId: string,
  client?: DbClient
): Promise<Map<string, string>> {
  return new Map(
    (
      await DbService.repository.fieldMappings.findByConnectorEntityId(
        connectorEntityId,
        client
      )
    ).map((m) => [m.id, m.createdBy])
  );
}

/** A repeated id would hit the projection's unique index: 400. */
function assertNoDuplicates(fieldMappingIds: string[]): void {
  if (new Set(fieldMappingIds).size !== fieldMappingIds.length) {
    throw new ApiError(
      400,
      ApiCode.CURATED_VIEW_INVALID_PAYLOAD,
      "Duplicate field mapping in projection"
    );
  }
}

/** Whether two duplicate-free id lists hold the same ids, in any order. */
function sameIdSet(a: string[], b: string[]): boolean {
  const sb = new Set(b);
  return a.length === sb.size && a.every((id) => sb.has(id));
}

/**
 * Validate a projection (`fieldMappingIds`) against the view's entity and
 * return the ids to store, in order:
 *
 * 1. **No duplicates** (`assertNoDuplicates`).
 * 2. **Every id is a column of this entity** (#736). A projection is a subset
 *    of its entity's columns, so an id from another entity or org, or an
 *    unknown id, is bad input: 400, the same answer for each, so it says
 *    nothing about ids elsewhere. It runs before the read check because a
 *    caller with an unconditional grant would otherwise pass a foreign id.
 * 3. **A deleted column of this entity is dropped, not refused.** Deleting a
 *    field mapping leaves it in the projections that name it, and the editor
 *    sends a view's stored ids back on every save, so refusing it would make
 *    the view uneditable. It is dropped on the next save that changes the
 *    projection; a save that resends the stored ids changes nothing (#738).
 * 4. **Never widen by dropping.** An empty projection means "all columns", so
 *    a non-empty request left with nothing is refused, not stored as `[]`.
 * 5. **The caller reads the entity** (#829). A view conveys its projection
 *    to everyone who reads the view, and a column is part of its entity, so
 *    choosing columns needs read on the entity, which covers every column of
 *    it. Throws `403 PERMISSION_DENIED`. (Create already 404s an unreadable
 *    entity; this is the PATCH case, a view writer who can't read the entity.)
 *
 * Reads run on `client`, so PATCH can call this inside its transaction.
 */
async function assertProjection(
  set: PermissionSet,
  organizationId: string,
  connectorEntityId: string,
  fieldMappingIds: string[],
  client?: DbClient
): Promise<string[]> {
  assertNoDuplicates(fieldMappingIds);
  const createdByFm = await fieldMappingCreators(connectorEntityId, client);
  const live = fieldMappingIds.filter((id) => createdByFm.has(id));
  const rest = fieldMappingIds.filter((id) => !createdByFm.has(id));
  if (rest.length > 0) {
    const deleted = new Set(
      (
        await DbService.repository.fieldMappings.findMany(
          and(
            eq(fieldMappings.connectorEntityId, connectorEntityId),
            inArray(fieldMappings.id, rest),
            isNotNull(fieldMappings.deleted)
          ),
          { includeDeleted: true },
          client
        )
      ).map((m) => m.id)
    );
    if (rest.some((id) => !deleted.has(id))) {
      throw new ApiError(
        400,
        ApiCode.CURATED_VIEW_INVALID_PAYLOAD,
        "Field mapping is not a column of this entity"
      );
    }
    if (live.length === 0) {
      throw new ApiError(
        400,
        ApiCode.CURATED_VIEW_INVALID_PAYLOAD,
        "None of the selected columns exist any more"
      );
    }
  }

  await assertEntityReadable(set, organizationId, connectorEntityId);
  return live;
}

/**
 * #829: a view conveys its definition (projection and filter) to everyone who
 * reads it, so changing either needs read on the view's entity, which covers
 * every column and row of it. Without this, a view writer who can't read the
 * entity could widen what the view shows, or probe unprojected columns with
 * a filter. `403 PERMISSION_DENIED`.
 */
async function assertEntityReadable(
  set: PermissionSet,
  organizationId: string,
  connectorEntityId: string
): Promise<void> {
  const entity = (
    await DbService.repository.connectorEntities.findAuthRows([
      connectorEntityId,
    ])
  )[0];
  const createdBy = entity?.createdBy ?? null;
  if (
    !ObjectAccessService.readableInOrg(set, organizationId, "entity", entity)
  ) {
    throw permissionDenied("resource.read", {
      type: "entity",
      id: connectorEntityId,
      createdBy,
    });
  }
}

/** JSON with object keys sorted, so a filter round-tripped through jsonb
 *  (which reorders keys) compares equal to the one the editor sends back. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0
          )
        )
      : v
  );
}

/**
 * #645: the projection named by key, as field-mapping ids in the given order.
 * Each key is a live mapping's `normalizedKey` on the entity. Called only
 * after the caller is known to read the entity (create) or write the view
 * (update), so an unknown-key answer says nothing about an entity they can't
 * see. A repeated or unknown key is a 400 naming it.
 */
async function resolveColumnKeys(
  connectorEntityId: string,
  keys: string[],
  client?: DbClient
): Promise<string[]> {
  if (new Set(keys).size !== keys.length) {
    throw new ApiError(
      400,
      ApiCode.CURATED_VIEW_INVALID_PAYLOAD,
      "Duplicate column in projection"
    );
  }
  const idByKey = new Map(
    (
      await DbService.repository.fieldMappings.findByConnectorEntityId(
        connectorEntityId,
        client
      )
    ).map((m) => [m.normalizedKey, m.id])
  );
  return keys.map((key) => {
    const id = idByKey.get(key);
    if (!id) {
      throw new ApiError(
        400,
        ApiCode.CURATED_VIEW_INVALID_PAYLOAD,
        `Unknown column "${key}" on this entity`
      );
    }
    return id;
  });
}

/** #645: `columnKeys` and `fieldMappingIds` name the same thing; one only. */
function assertOneProjectionForm(input: {
  columnKeys?: string[];
  fieldMappingIds?: string[];
}): void {
  if (input.columnKeys !== undefined && input.fieldMappingIds !== undefined) {
    throw new ApiError(
      400,
      ApiCode.CURATED_VIEW_INVALID_PAYLOAD,
      "Give the projection as columnKeys or fieldMappingIds, not both"
    );
  }
}

/** Insert a view's projection rows (`fieldMappingIds` non-empty). */
async function insertProjection(
  organizationId: string,
  curatedViewId: string,
  fieldMappingIds: string[],
  userId: string,
  tx: DbClient
): Promise<void> {
  const fmFactory = new CuratedViewFieldMappingModelFactory();
  const rows = fieldMappingIds.map((fieldMappingId) => {
    const m = fmFactory.create(userId);
    m.update({ organizationId, curatedViewId, fieldMappingId });
    return m.parse();
  });
  await DbService.repository.curatedViewFieldMappings.createMany(
    rows as never,
    tx
  );
}

export class CuratedViewService {
  /**
   * The views the caller may read, paginated (#599). A `stationId` narrows to
   * that station's attached views and 404s a station the caller can't read
   * (#692). Rows are scoped per #680 and carry the caller's capabilities.
   */
  static async list(
    ctx: PermissionContext,
    query: CuratedViewListRequestQuery
  ): Promise<CuratedViewListResponsePayload> {
    const {
      limit,
      offset,
      sortBy,
      sortOrder,
      search,
      connectorEntityId,
      stationId,
    } = query;
    const { organizationId } = ctx;
    const set = await PermissionService.loadSet(ctx);

    const filters: SQL[] = [eq(curatedViews.organizationId, organizationId)];
    if (connectorEntityId) {
      filters.push(eq(curatedViews.connectorEntityId, connectorEntityId));
    }
    if (stationId) {
      const station = await DbService.repository.stations.findById(stationId);
      if (
        !ObjectAccessService.readableInOrg(
          set,
          organizationId,
          "station",
          station
        )
      ) {
        throw new ApiError(404, ApiCode.STATION_NOT_FOUND, "Station not found");
      }
      const attachments =
        await DbService.repository.stationViews.findByStationId(stationId);
      const attachedIds = attachments.map((a) => a.curatedViewId);
      if (attachedIds.length === 0) {
        return { curatedViews: [], total: 0, limit, offset };
      }
      filters.push(inArray(curatedViews.id, attachedIds));
    }
    if (search) {
      filters.push(ilike(curatedViews.label, `%${search}%`));
    }
    // Row-level read scoping: only the views the caller may read.
    const visibility = set.visibilityPredicate("curated_view", {
      createdByCol: curatedViews.createdBy,
      idCol: curatedViews.id,
    });
    if (visibility) filters.push(visibility);

    const where = and(...filters);
    const column = SORTABLE_COLUMNS[sortBy];

    const [data, total] = await Promise.all([
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

    // #680: each row as this caller may see it (no filter contents without
    // write on the view), plus whether it's filtered / projected.
    const projectedIds =
      await DbService.repository.curatedViewFieldMappings.findProjectedViewIds(
        data.map((v) => v.id)
      );
    const scoped = data.map((v) =>
      CuratedViewPayloadService.scopeRow(set, v, projectedIds.has(v.id))
    );

    return {
      curatedViews: ObjectCapabilitiesService.attach(
        set,
        "curated_view",
        scoped as unknown as Array<{ id: string; createdBy: string }>
      ) as unknown as CuratedViewListResponsePayload["curatedViews"],
      total,
      limit,
      offset,
    };
  }

  /**
   * One view, as the caller may see it (#680), with its projection's ids and
   * `columns` (#645: each projected mapping's key, null once deleted).
   * Missing, another org's or unreadable is 404 (unreadable == absent).
   */
  static async get(
    ctx: PermissionContext,
    id: string
  ): Promise<CuratedViewGetResponsePayload["curatedView"]> {
    const view = await DbService.repository.curatedViews.findById(id);
    if (!view || view.organizationId !== ctx.organizationId) throw notFound();
    const set = await PermissionService.loadSet(ctx);
    const canRead = set.can("resource.read", {
      type: "curated_view",
      id: view.id,
      createdBy: view.createdBy,
    });
    if (!canRead) throw notFound();

    const projection =
      await DbService.repository.curatedViewFieldMappings.findByCuratedViewId(
        view.id
      );
    const ids = projection.map((p) => p.fieldMappingId);
    const keyById = new Map(
      ids.length > 0
        ? (
            await DbService.repository.fieldMappings.findMany(
              inArray(fieldMappings.id, ids)
            )
          ).map((m) => [m.id, m.normalizedKey])
        : []
    );
    // #680: the definition only for a caller with write on the view; any
    // other reader gets no filter contents. #829: every reader gets the
    // projection ids, which reading the view conveys.
    const scoped = CuratedViewPayloadService.scopeRow(
      set,
      view,
      projection.length > 0
    );
    return {
      ...(scoped as unknown as CuratedViewGetResponsePayload["curatedView"]),
      capabilities: ObjectCapabilitiesService.for(set, "curated_view", view),
      fieldMappingIds: ids,
      columns: ids.map((fieldMappingId) => ({
        fieldMappingId,
        key: keyById.get(fieldMappingId) ?? null,
      })),
    };
  }

  /**
   * Create a view. Needs an unconditional `write curated_view` (#708) and
   * read on the entity (#829, else 404). `opts.sourcePortalId` records the
   * agent session that created it (#641); the view is still the caller's.
   */
  static async create(
    ctx: PermissionContext,
    input: CuratedViewCreateInput,
    opts: { sourcePortalId?: string | null } = {}
  ): Promise<CuratedViewSelect> {
    const { organizationId, userId } = ctx;
    const { columnKeys, ...body } = input;
    assertOneProjectionForm(input);

    // Creation is reserved to holders of an unconditional `write curated_view`
    // (owner/admin) — a class-level check (no ownership) excludes a member's
    // `created_by_caller` write.
    const set = await PermissionService.loadSet(ctx);
    set.check("resource.write", { type: "curated_view" });

    // The connector entity must exist in this org and, #829, be readable by
    // the caller (a view only reads it); unreadable == absent (404).
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
    if (columnKeys) {
      body.fieldMappingIds = await resolveColumnKeys(
        body.connectorEntityId,
        columnKeys
      );
    }

    const duplicate = await DbService.repository.curatedViews.findByKey(
      organizationId,
      body.key
    );
    if (duplicate) {
      throw new ApiError(
        409,
        ApiCode.CURATED_VIEW_DUPLICATE_KEY,
        "A curated view with this key already exists in this organization"
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
      filterSql: body.filterSql ?? null,
      // #644: filled from the validator's result under the lock below.
      filterSqlKeys: [],
      sourcePortalId: opts.sourcePortalId ?? null,
    });
    const row = model.parse();
    // #644: a SQL filter needs the tier's entitlement and the reader role.
    if (body.filterSql) {
      await CuratedViewFilterSqlService.beforeWrite(organizationId);
    }

    return DbService.transaction(async (tx) => {
      // #802: the filter's keys and the projection's mappings are checked
      // under the entity's view-dependency lock, so a mapping can't be
      // deleted or renamed between the check and this view's insert.
      await CuratedViewDependencyService.lockEntities(tx, [
        body.connectorEntityId,
      ]);
      if (body.filter)
        await validateFilter(body.filter, body.connectorEntityId);
      // #644: validated and dry-run against the entity's columns under the
      // same lock, so its keys are pinned before a mapping can change.
      if (body.filterSql) {
        const { keys } = await CuratedViewFilterSqlService.validateAndDryRun(
          body.connectorEntityId,
          organizationId,
          body.filterSql,
          tx
        );
        row.filterSqlKeys = keys;
      }
      // Omitted = unrestricted (all columns), the same as `[]`.
      const projection = await assertProjection(
        set,
        organizationId,
        body.connectorEntityId,
        body.fieldMappingIds ?? [],
        tx
      );
      const view = (await DbService.repository.curatedViews.create(
        row as never,
        tx
      )) as CuratedViewSelect;
      if (projection.length > 0) {
        await insertProjection(organizationId, view.id, projection, userId, tx);
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
  }

  /**
   * Update a view's label, description, filter (either mode) or projection.
   * Needs write on the view (#713: unreadable 404s, read-only 403s); changing
   * the projection or filter also needs read on the entity (#829).
   */
  static async update(
    ctx: PermissionContext,
    id: string,
    input: CuratedViewUpdateInput
  ): Promise<CuratedViewSelect> {
    const { organizationId, userId } = ctx;
    const { columnKeys, ...body } = input;
    assertOneProjectionForm(input);

    // #713: one the caller can't read answers 404, like its GET.
    const set = await PermissionService.loadSet(ctx);
    const existing = ObjectAccessService.loadForVerb(
      set,
      organizationId,
      "curated_view",
      await DbService.repository.curatedViews.findById(id),
      "write",
      notFound
    );
    if (columnKeys) {
      body.fieldMappingIds = await resolveColumnKeys(
        existing.connectorEntityId,
        columnKeys
      );
    }

    if (body.fieldMappingIds) assertNoDuplicates(body.fieldMappingIds);

    // #644: a SQL filter set to new text needs the entitlement; clearing it
    // or resending the stored text (the editor does on every save) doesn't,
    // so a downgraded org can still rename its views.
    const filterSqlChanged =
      body.filterSql !== undefined &&
      (body.filterSql ?? null) !== (existing.filterSql ?? null);
    // Permission before tier (#688): a change needs read on the entity
    // (#829, like a FilterGroup change), then the entitlement.
    if (filterSqlChanged) {
      await assertEntityReadable(
        set,
        organizationId,
        existing.connectorEntityId
      );
      if (body.filterSql) {
        await CuratedViewFilterSqlService.beforeWrite(organizationId);
      }
    }

    return DbService.transaction(async (tx) => {
      // #802: checked under the entity's view-dependency lock, like create.
      await CuratedViewDependencyService.lockEntities(tx, [
        existing.connectorEntityId,
      ]);
      if (body.filter) {
        await validateFilter(body.filter, existing.connectorEntityId);
      }
      // #829: a filter change needs read on the entity, like a column
      // change. The editor sends the stored filter back on every save, so
      // an unchanged one isn't checked (a rename still works).
      if (
        body.filter !== undefined &&
        canonicalJson(body.filter ?? null) !==
          canonicalJson(existing.filter ?? null)
      ) {
        await assertEntityReadable(
          set,
          organizationId,
          existing.connectorEntityId
        );
      }
      let filterSqlKeys: string[] = [];
      if (filterSqlChanged && body.filterSql) {
        ({ keys: filterSqlKeys } =
          await CuratedViewFilterSqlService.validateAndDryRun(
            existing.connectorEntityId,
            organizationId,
            body.filterSql,
            tx
          ));
      }
      const patch: Record<string, unknown> = {
        updated: Date.now(),
        updatedBy: userId,
      };
      if (body.label !== undefined) patch.label = body.label;
      if (body.description !== undefined) patch.description = body.description;
      if (body.filter !== undefined) patch.filter = body.filter;
      // #644: a view filters by one mode; setting either clears the other.
      if (filterSqlChanged) {
        patch.filterSql = body.filterSql;
        patch.filterSqlKeys = filterSqlKeys;
      }
      if (body.filterSql) patch.filter = null;
      if (body.filter) {
        patch.filterSql = null;
        patch.filterSqlKeys = [];
      }
      const view = (await DbService.repository.curatedViews.update(
        existing.id,
        patch as never,
        tx
      )) as CuratedViewSelect;
      // The projection is read after the view row's update, which holds its
      // lock, so a concurrent save can't slip between this read, the check
      // and the replace.
      const old = body.fieldMappingIds
        ? await DbService.repository.curatedViewFieldMappings.findByCuratedViewId(
            existing.id,
            tx
          )
        : [];
      const stored = old.map((r) => r.fieldMappingId);
      // #738: the editor sends the stored ids back on every save, so the
      // same ids in any order are no change: nothing to check or rewrite.
      const projection =
        body.fieldMappingIds && !sameIdSet(body.fieldMappingIds, stored)
          ? await assertProjection(
              set,
              existing.organizationId,
              existing.connectorEntityId,
              body.fieldMappingIds,
              tx
            )
          : undefined;
      // Projection replace: drop the old rows, insert the new set.
      if (projection) {
        if (old.length > 0) {
          await DbService.repository.curatedViewFieldMappings.softDeleteMany(
            old.map((r) => r.id),
            userId,
            tx
          );
        }
        if (projection.length > 0) {
          await insertProjection(
            organizationId,
            existing.id,
            projection,
            userId,
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
  }

  /**
   * Delete a view with the #802 cascade (projection, station attachments,
   * grants). Needs delete on the view (#713: unreadable 404s).
   */
  static async delete(
    ctx: PermissionContext,
    id: string
  ): Promise<CuratedViewDeleteResponsePayload> {
    const { organizationId, userId } = ctx;
    const existing = ObjectAccessService.loadForVerb(
      await PermissionService.loadSet(ctx),
      organizationId,
      "curated_view",
      await DbService.repository.curatedViews.findById(id),
      "delete",
      notFound
    );

    // #802: the shared cascade — the entity and connector deletes run the
    // same one, so the three paths can't drift.
    const cascaded = await DbService.transaction(async (tx) => {
      const counts = await CuratedViewDeleteService.deleteByIds(
        organizationId,
        [existing.id],
        userId,
        tx
      );
      return {
        fieldMappings: counts.fieldMappings,
        stationViews: counts.stationViews,
        grants: counts.grants,
      };
    }).catch((error) => {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        500,
        ApiCode.CURATED_VIEW_DELETE_FAILED,
        "Failed to delete curated view"
      );
    });

    return { id: existing.id, cascaded };
  }
}
