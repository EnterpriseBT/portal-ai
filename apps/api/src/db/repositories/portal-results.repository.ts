/**
 * Repository for the `portal_results` table.
 *
 * Extends the generic {@link Repository} with station-scoped lookups
 * for saved/pinned analytics results.
 */

import { eq, asc, desc, getTableColumns, type SQL } from "drizzle-orm";

import { portalResults, portals } from "../schema/index.js";
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

  // ── Override: include support ──────────────────────────────────

  override async findMany(
    where?: SQL,
    opts: ListOptions = {},
    client: DbClient = db
  ): Promise<PortalResultSelect[]> {
    if (opts.include?.includes("portal")) {
      return this.findManyWithPortal(where, opts, client) as unknown as PortalResultSelect[];
    }
    return super.findMany(where, opts, client);
  }

  // ── Join queries ─────────────────────────────────────────────

  /**
   * Return portal results with their source portal name attached.
   * Uses a LEFT JOIN so results are returned even if the portal is missing or portalId is null.
   */
  private async findManyWithPortal(
    where: SQL | undefined,
    opts: ListOptions = {},
    client: DbClient = db
  ): Promise<(PortalResultSelect & { portalName: string | null })[]> {
    const conditions = this.withSoftDelete(where, opts.includeDeleted);

    let query = (client as typeof db)
      .select({
        result: getTableColumns(portalResults),
        portalName: portals.name,
      })
      .from(portalResults)
      .leftJoin(portals, eq(portalResults.portalId, portals.id))
      .where(conditions)
      .$dynamic();

    if (opts.orderBy) {
      const orderFn = opts.orderBy.direction === "desc" ? desc : asc;
      query = query.orderBy(orderFn(opts.orderBy.column));
    }
    if (opts.limit !== undefined) query = query.limit(opts.limit);
    if (opts.offset !== undefined) query = query.offset(opts.offset);

    const rows = await query;

    return rows.map((row) => ({
      ...row.result,
      portalName: row.portalName,
    }));
  }

  // ── Custom queries ───────────────────────────────────────────

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
