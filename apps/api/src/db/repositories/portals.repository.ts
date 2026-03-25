/**
 * Repository for the `portals` table.
 *
 * Extends the generic {@link Repository} with station-scoped and
 * org-scoped portal lookups.
 */

import { eq, desc } from "drizzle-orm";

import { portals } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient, type ListOptions } from "./base.repository.js";
import type { PortalSelect, PortalInsert } from "../schema/zod.js";

export class PortalsRepository extends Repository<
  typeof portals,
  PortalSelect,
  PortalInsert
> {
  constructor() {
    super(portals);
  }

  /** Return non-deleted portals for a station. */
  async findByStation(
    stationId: string,
    opts: ListOptions = {},
    client: DbClient = db
  ): Promise<PortalSelect[]> {
    return this.findMany(eq(portals.stationId, stationId), opts, client);
  }

  /** Return the most recent portals for an organization, ordered by created desc. */
  async findRecentByOrg(
    organizationId: string,
    limit: number = 10,
    client: DbClient = db
  ): Promise<PortalSelect[]> {
    return this.findMany(
      eq(portals.organizationId, organizationId),
      { limit, orderBy: { column: this.cols.created, direction: "desc" } },
      client
    );
  }
}

/** Singleton instance. */
export const portalsRepo = new PortalsRepository();
