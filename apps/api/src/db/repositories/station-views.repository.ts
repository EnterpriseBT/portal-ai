/**
 * Repository for the `station_views` join table (#599) — a station's data
 * attachment (curated views), replacing `station_instances`.
 */

import { and, eq, inArray, sql } from "drizzle-orm";

import { stationViews } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type { StationViewSelect, StationViewInsert } from "../schema/zod.js";

export class StationViewsRepository extends Repository<
  typeof stationViews,
  StationViewSelect,
  StationViewInsert
> {
  constructor() {
    super(stationViews);
  }

  /** Non-deleted view attachments for a station. */
  async findByStationId(
    stationId: string,
    client: DbClient = db
  ): Promise<StationViewSelect[]> {
    return this.findMany(eq(stationViews.stationId, stationId), {}, client);
  }

  /**
   * #674: insert attachments, skipping any already live. The conflict target
   * restates the partial unique index's `WHERE deleted IS NULL`, so a
   * concurrent attach of the same view is a no-op rather than a 23505.
   * Returns only the rows actually inserted.
   */
  async insertManyIgnoreConflicts(
    rows: StationViewInsert[],
    client: DbClient = db
  ): Promise<StationViewSelect[]> {
    if (rows.length === 0) return [];
    return (await (client as typeof db)
      .insert(stationViews)
      .values(rows)
      .onConflictDoNothing({
        target: [stationViews.stationId, stationViews.curatedViewId],
        where: sql`deleted IS NULL`,
      })
      .returning()) as StationViewSelect[];
  }

  /** #674: soft-delete a station's live attachments to the given views. */
  async softDeleteByStationAndViews(
    stationId: string,
    curatedViewIds: string[],
    deletedBy: string,
    client: DbClient = db
  ): Promise<number> {
    if (curatedViewIds.length === 0) return 0;
    const rows = await this.updateWhere(
      and(
        eq(stationViews.stationId, stationId),
        inArray(stationViews.curatedViewId, curatedViewIds)
      )!,
      { deleted: Date.now(), deletedBy },
      client
    );
    return rows.length;
  }

  /** #674: soft-delete every live view attachment of a station. */
  async softDeleteByStation(
    stationId: string,
    deletedBy: string,
    client: DbClient = db
  ): Promise<number> {
    const rows = await this.updateWhere(
      eq(stationViews.stationId, stationId),
      { deleted: Date.now(), deletedBy },
      client
    );
    return rows.length;
  }
}

/** Singleton instance. */
export const stationViewsRepo = new StationViewsRepository();
