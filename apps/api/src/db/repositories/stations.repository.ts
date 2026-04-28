/**
 * Repository for the `stations` table.
 *
 * Extends the generic {@link Repository} with org-scoped station lookups.
 */

import { eq } from "drizzle-orm";

import { stations } from "../schema/index.js";
import { db } from "../client.js";
import {
  Repository,
  type DbClient,
  type ListOptions,
} from "./base.repository.js";
import type { StationSelect, StationInsert } from "../schema/zod.js";

export class StationsRepository extends Repository<
  typeof stations,
  StationSelect,
  StationInsert
> {
  constructor() {
    super(stations);
  }

  /** Return non-deleted stations for an organization. */
  async findByOrganizationId(
    organizationId: string,
    opts: ListOptions = {},
    client: DbClient = db
  ): Promise<StationSelect[]> {
    return this.findMany(
      eq(stations.organizationId, organizationId),
      opts,
      client
    );
  }
}

/** Singleton instance. */
export const stationsRepo = new StationsRepository();
