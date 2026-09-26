/**
 * Repository for the `station_views` join table (#599) — a station's data
 * attachment (curated views), replacing `station_instances`.
 */

import { eq } from "drizzle-orm";

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
}

/** Singleton instance. */
export const stationViewsRepo = new StationViewsRepository();
