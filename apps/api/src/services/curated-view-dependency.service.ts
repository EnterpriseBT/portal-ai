/**
 * Which curated views depend on a field mapping (#802).
 *
 * A view depends on a mapping in two ways: it **projects** it (a
 * `curated_view_field_mappings` row) or its row **filter** names the
 * mapping's `normalizedKey` somewhere in its `FilterGroup` tree. Removing a
 * mapping either view depends on breaks the view, and a cascade can't fix it
 * safely: dropping a view's last projected column turns "these columns" into
 * "every column" (`resolveOneViewColumns`), widening what the view — and every
 * `in_curated_view` field grant built on it — exposes. So a mapping in use is
 * not deletable; the user edits or deletes the view first.
 */

import { and, eq, inArray } from "drizzle-orm";

import { collectFilterFields } from "@portalai/core/contracts";

import { DbService } from "./db.service.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { curatedViewFieldMappings, curatedViews } from "../db/schema/index.js";
import type { DbClient } from "../db/repositories/base.repository.js";

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
   * The live views (org-scoped) over these mappings' entities that project
   * one of the mappings or filter on one of their keys. A filter only counts
   * against a mapping on the view's own entity: keys are per-entity.
   */
  static async findViewsUsingMappings(
    organizationId: string,
    mappings: MappingRef[],
    client?: DbClient
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
      (
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
   * one of these mappings. The error names no view: the caller may not be
   * able to read them. The impact endpoint lists the readable ones.
   * `subject` names what's being removed, e.g. `field mapping "Email"`.
   */
  static async assertMappingsNotInViews(
    organizationId: string,
    mappings: MappingRef[],
    subject: string,
    client?: DbClient
  ): Promise<void> {
    const views = await CuratedViewDependencyService.findViewsUsingMappings(
      organizationId,
      mappings,
      client
    );
    if (views.length === 0) return;
    throw new ApiError(
      409,
      ApiCode.FIELD_MAPPING_DELETE_IN_VIEW,
      `Cannot delete ${subject}: ${views.length} curated view${views.length === 1 ? " uses" : "s use"} it. Edit or delete ${views.length === 1 ? "that view" : "those views"} first.`,
      { curatedViewCount: views.length }
    );
  }
}
