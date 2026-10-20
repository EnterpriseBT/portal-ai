/**
 * Which curated views depend on a field mapping (#802).
 *
 * A view depends on a mapping in two ways: it **projects** it (a
 * `curated_view_field_mappings` row) or its row **filter** names the
 * mapping's `normalizedKey` somewhere in its `FilterGroup` tree. Removing a
 * mapping either view depends on breaks the view, and a cascade can't fix it
 * safely: dropping a view's last projected column turns "these columns" into
 * "every column" (`resolveOneViewColumns`), widening what the view — and so
 * everyone who reads it — exposes. So a mapping in use is
 * not deletable; the user edits or deletes the view first. Renaming its key
 * breaks a filter the same way (a projection links by id, so it survives).
 *
 * The checks are only sound under `lockEntities`: a view write and a mapping
 * delete, rename or reconcile each take the entity's lock before checking,
 * so one can't slip between the other's check and its write.
 */

import { and, eq, inArray, sql } from "drizzle-orm";

import { collectFilterFields } from "@portalai/core/contracts";

import { DbService } from "./db.service.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { curatedViewFieldMappings, curatedViews } from "../db/schema/index.js";
import type { DbClient } from "../db/repositories/base.repository.js";
import type { db } from "../db/client.js";
import { VIEW_DEPS_LOCK_NAMESPACE } from "./sync-lock.service.js";

export interface MappingRef {
  id: string;
  connectorEntityId: string;
  normalizedKey: string;
}

export interface DependentView {
  id: string;
  label: string;
  createdBy: string;
}

export class CuratedViewDependencyService {
  /**
   * Take the view-dependency lock on each entity, for the rest of `tx`
   * (`pg_advisory_xact_lock`, exclusive, in sorted order so two callers
   * locking overlapping sets can't deadlock). Every view write and every
   * mapping delete, rename or reconcile takes it before checking.
   */
  static async lockEntities(
    tx: DbClient,
    connectorEntityIds: string[]
  ): Promise<void> {
    for (const id of [...new Set(connectorEntityIds)].sort()) {
      await (tx as typeof db).execute(
        sql`SELECT pg_advisory_xact_lock(${VIEW_DEPS_LOCK_NAMESPACE}::int, hashtext(${id}))`
      );
    }
  }

  /**
   * The live views (org-scoped) over these mappings' entities that project
   * one of the mappings or filter on one of their keys. A filter only counts
   * against a mapping on the view's own entity: keys are per-entity.
   */
  static async findViewsUsingMappings(
    organizationId: string,
    mappings: MappingRef[],
    client?: DbClient,
    /** `"filter"`: only views whose filter names a key — what a key rename
     *  breaks. A projection links by id, so a rename leaves it intact. */
    uses: "any" | "filter" = "any"
  ): Promise<DependentView[]> {
    if (mappings.length === 0) return [];

    const entityIds = [...new Set(mappings.map((m) => m.connectorEntityId))];
    const views = await DbService.repository.curatedViews.findMany(
      and(
        eq(curatedViews.organizationId, organizationId),
        inArray(curatedViews.connectorEntityId, entityIds)
      ),
      {},
      client
    );
    if (views.length === 0) return [];

    const projected = new Set(
      uses === "filter"
        ? []
        : (
            await DbService.repository.curatedViewFieldMappings.findMany(
              and(
                inArray(
                  curatedViewFieldMappings.curatedViewId,
                  views.map((v) => v.id)
                ),
                inArray(
                  curatedViewFieldMappings.fieldMappingId,
                  mappings.map((m) => m.id)
                )
              ),
              {},
              client
            )
          ).map((row) => row.curatedViewId)
    );

    const keysByEntity = new Map<string, Set<string>>();
    for (const m of mappings) {
      const keys = keysByEntity.get(m.connectorEntityId) ?? new Set<string>();
      keys.add(m.normalizedKey);
      keysByEntity.set(m.connectorEntityId, keys);
    }

    return views
      .filter((view) => {
        if (projected.has(view.id)) return true;
        if (!view.filter) return false;
        const keys = keysByEntity.get(view.connectorEntityId);
        if (!keys) return false;
        for (const field of collectFilterFields(view.filter)) {
          if (keys.has(field)) return true;
        }
        return false;
      })
      .map((view) => ({
        id: view.id,
        label: view.label,
        createdBy: view.createdBy,
      }));
  }

  /**
   * Refuse with `409 FIELD_MAPPING_DELETE_IN_VIEW` when any live view uses
   * one of these mappings. Takes the view-dependency lock on their entities
   * first, so it holds for the rest of `tx`: call it in the transaction that
   * deletes them. The error names no view: the caller may not be able to read
   * them. The impact endpoint lists the readable ones.
   * `subject` names what's being removed, e.g. `field mapping "Email"`.
   */
  static async assertMappingsNotInViews(
    organizationId: string,
    mappings: MappingRef[],
    subject: string,
    tx: DbClient
  ): Promise<void> {
    if (mappings.length === 0) return;
    await CuratedViewDependencyService.lockEntities(
      tx,
      mappings.map((m) => m.connectorEntityId)
    );
    const views = await CuratedViewDependencyService.findViewsUsingMappings(
      organizationId,
      mappings,
      tx
    );
    if (views.length === 0) return;
    throw new ApiError(
      409,
      ApiCode.FIELD_MAPPING_DELETE_IN_VIEW,
      `Cannot delete ${subject}: ${views.length} curated view${views.length === 1 ? " uses" : "s use"} it. Edit or delete ${views.length === 1 ? "that view" : "those views"} first.`,
      { curatedViewCount: views.length }
    );
  }

  /**
   * Refuse with `409 FIELD_MAPPING_KEY_IN_VIEW` when renaming `mapping`'s
   * `normalizedKey` would break a live view's filter. A no-op when the key
   * isn't changing. Locks like `assertMappingsNotInViews`; call it in the
   * transaction that renames.
   */
  static async assertKeyRenameKeepsViews(
    organizationId: string,
    mapping: MappingRef & { sourceField: string },
    newKey: string | undefined,
    tx: DbClient
  ): Promise<void> {
    if (newKey === undefined || newKey === mapping.normalizedKey) return;
    await CuratedViewDependencyService.lockEntities(tx, [
      mapping.connectorEntityId,
    ]);
    const views = await CuratedViewDependencyService.findViewsUsingMappings(
      organizationId,
      [mapping],
      tx,
      "filter"
    );
    if (views.length === 0) return;
    throw new ApiError(
      409,
      ApiCode.FIELD_MAPPING_KEY_IN_VIEW,
      `Cannot rename the key of field mapping "${mapping.sourceField}": ${views.length} curated view${views.length === 1 ? " filters" : "s filter"} on it. Edit ${views.length === 1 ? "that view's filter" : "those views' filters"} first.`,
      { curatedViewCount: views.length }
    );
  }
}
