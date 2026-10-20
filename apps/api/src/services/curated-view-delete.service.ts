/**
 * The one implementation of "delete these curated views" (#802).
 *
 * A view hangs off its connector entity, and three things hang off the view:
 * its projection rows (`curated_view_field_mappings`), its station attachments
 * (`station_views`), and its `curated_view` resource grants (#829: a share
 * no longer composes a field grant). The view's own DELETE, the entity delete and the connector
 * delete all run this, so the three paths can't drift apart again — #802 was
 * exactly that drift: the entity-level cascades never learned about views.
 *
 * Station attachments are soft-deleted, as the view's own delete and station
 * delete do; every read excludes a soft-deleted `station_views` row, so the
 * station stops listing the view. Grants are hard-deleted: a grant has no
 * meaning once its object is gone.
 */

import { and, eq, inArray } from "drizzle-orm";

import { DbService } from "./db.service.js";
import { curatedViews } from "../db/schema/index.js";
import type { DbClient } from "../db/repositories/base.repository.js";

export interface CuratedViewCascadeCounts {
  /** Views soft-deleted. */
  curatedViews: number;
  /** `curated_view_field_mappings` rows soft-deleted. */
  fieldMappings: number;
  /** `station_views` rows soft-deleted. */
  stationViews: number;
  /** `curated_view` resource grants, hard-deleted. */
  grants: number;
}

export class CuratedViewDeleteService {
  /**
   * Delete the given views and everything that hangs off them, on the
   * caller's transaction. Batched — one statement per table, however many
   * views. Ids outside `organizationId`, or already deleted, are ignored, so
   * a caller can pass what it resolved without re-checking. A no-op on `[]`.
   *
   * Order: projection rows → attachments → grants → views, children before
   * the parent they reference.
   */
  static async deleteByIds(
    organizationId: string,
    viewIds: string[],
    userId: string,
    tx: DbClient
  ): Promise<CuratedViewCascadeCounts> {
    const empty: CuratedViewCascadeCounts = {
      curatedViews: 0,
      fieldMappings: 0,
      stationViews: 0,
      grants: 0,
    };
    if (viewIds.length === 0) return empty;

    // Narrow to this org's live views first: every write below is keyed by
    // these ids, so a foreign id can't reach another tenant's rows.
    const live = await DbService.repository.curatedViews.findMany(
      and(
        eq(curatedViews.organizationId, organizationId),
        inArray(curatedViews.id, viewIds)
      ),
      {},
      tx
    );
    const ids = live.map((r) => r.id);
    if (ids.length === 0) return empty;

    const repo = DbService.repository;
    const fieldMappings =
      await repo.curatedViewFieldMappings.softDeleteByCuratedViewIds(
        ids,
        userId,
        tx
      );
    const stationViews = await repo.stationViews.softDeleteByCuratedViewIds(
      ids,
      userId,
      tx
    );
    const resourceGrants = await repo.permissionGrants.hardDeleteByResources(
      organizationId,
      "curated_view",
      ids,
      tx
    );
    const deletedViews = await repo.curatedViews.updateWhere(
      inArray(curatedViews.id, ids),
      { deleted: Date.now(), deletedBy: userId },
      tx
    );

    return {
      curatedViews: deletedViews.length,
      fieldMappings,
      stationViews,
      grants: resourceGrants,
    };
  }

  /** Live view ids over these entities (org-scoped) — what an entity or
   *  connector delete cascades into. */
  static async findIdsByConnectorEntityIds(
    organizationId: string,
    connectorEntityIds: string[],
    client?: DbClient
  ): Promise<string[]> {
    return DbService.repository.curatedViews.findIdsByConnectorEntityIds(
      organizationId,
      connectorEntityIds,
      client
    );
  }
}
