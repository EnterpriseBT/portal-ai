/**
 * Repository for the `portal_results` table.
 *
 * Extends the generic {@link Repository} with station-scoped lookups
 * for saved/pinned analytics results.
 */

import { eq } from "drizzle-orm";

import { portalResults } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient, type ListOptions } from "./base.repository.js";
import type { PortalResultSelect, PortalResultInsert } from "../schema/zod.js";

export class PortalResultsRepository extends Repository<
  typeof portalResults,
  PortalResultSelect,
  PortalResultInsert
> {
  constructor() {
    super(portalResults);
  }

  /** Return non-deleted results for a station. */
  async findByStation(
    stationId: string,
    opts: ListOptions = {},
    client: DbClient = db
  ): Promise<PortalResultSelect[]> {
    return this.findMany(eq(portalResults.stationId, stationId), opts, client);
  }
}

/** Singleton instance. */
export const portalResultsRepo = new PortalResultsRepository();
