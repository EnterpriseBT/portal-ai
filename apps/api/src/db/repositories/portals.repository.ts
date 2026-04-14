/**
 * Repository for the `portals` table.
 *
 * Extends the generic {@link Repository} with station-scoped and
 * org-scoped portal lookups.
 */

import { eq, asc, desc, getTableColumns, type SQL } from "drizzle-orm";

import { portals, stations } from "../schema/index.js";
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

  // ── Override: include support ──────────────────────────────────

  override async findMany(
    where?: SQL,
    opts: ListOptions = {},
    client: DbClient = db
  ): Promise<PortalSelect[]> {
    if (opts.include?.includes("station")) {
      return this.findManyWithStation(where, opts, client) as unknown as PortalSelect[];
    }
    return super.findMany(where, opts, client);
  }

  // ── Join queries ─────────────────────────────────────────────

  /**
   * Return portals with their associated station name attached.
   * Uses a LEFT JOIN so portals are returned even if the station is missing.
   */
  private async findManyWithStation(
    where: SQL | undefined,
    opts: ListOptions = {},
    client: DbClient = db
  ): Promise<(PortalSelect & { stationName: string | null })[]> {
    const conditions = this.withSoftDelete(where, opts.includeDeleted);

    let query = (client as typeof db)
      .select({
        portal: getTableColumns(portals),
        stationName: stations.name,
      })
      .from(portals)
      .leftJoin(stations, eq(portals.stationId, stations.id))
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
      ...row.portal,
      stationName: row.stationName,
    }));
  }

  // ── Custom queries ───────────────────────────────────────────

  /** Return non-deleted portals for a station. */
  async findByStation(
    stationId: string,
    opts: ListOptions = {},
    client: DbClient = db
  ): Promise<PortalSelect[]> {
    return this.findMany(eq(portals.stationId, stationId), opts, client);
  }

  /** Return the most recent portals for an organization, ordered by lastOpened desc. */
  async findRecentByOrg(
    organizationId: string,
    limit: number = 10,
    client: DbClient = db
  ): Promise<PortalSelect[]> {
    return this.findMany(
      eq(portals.organizationId, organizationId),
      { limit, orderBy: { column: this.cols.lastOpened, direction: "desc" } },
      client
    );
  }
}

/** Singleton instance. */
export const portalsRepo = new PortalsRepository();
