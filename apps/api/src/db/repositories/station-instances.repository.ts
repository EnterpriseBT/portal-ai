/**
 * Repository for the `station_instances` join table.
 *
 * Links stations to connector instances.
 */

import { and, eq, inArray, sql } from "drizzle-orm";

import { stationInstances, connectorInstances } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type {
  StationInstanceSelect,
  StationInstanceInsert,
  ConnectorInstanceSelect,
} from "../schema/zod.js";

export class StationInstancesRepository extends Repository<
  typeof stationInstances,
  StationInstanceSelect,
  StationInstanceInsert
> {
  constructor() {
    super(stationInstances);
  }

  /** Return all instances linked to a station. */
  async findByStationId(
    stationId: string,
    opts: { include?: string[] } = {},
    client: DbClient = db
  ): Promise<
    (StationInstanceSelect & { connectorInstance?: ConnectorInstanceSelect })[]
  > {
    const rows = await this.findMany(
      eq(stationInstances.stationId, stationId),
      {},
      client
    );
    if (rows.length === 0 || !opts.include?.includes("connectorInstance")) {
      return rows;
    }

    const instanceIds = [...new Set(rows.map((r) => r.connectorInstanceId))];
    const instances = await (client as typeof db)
      .select()
      .from(connectorInstances)
      .where(inArray(connectorInstances.id, instanceIds));
    const instanceMap = new Map(
      instances.map((i) => [i.id, i as ConnectorInstanceSelect])
    );

    return rows.map((row) => ({
      ...row,
      connectorInstance: instanceMap.get(row.connectorInstanceId),
    }));
  }

  /**
   * #674: insert connector links, skipping any already live. The conflict
   * target restates the partial unique index's `WHERE deleted IS NULL`, so a
   * concurrent attach of the same connector is a no-op rather than a 23505.
   * Returns only the rows actually inserted.
   */
  async insertManyIgnoreConflicts(
    rows: StationInstanceInsert[],
    client: DbClient = db
  ): Promise<StationInstanceSelect[]> {
    if (rows.length === 0) return [];
    return (await (client as typeof db)
      .insert(stationInstances)
      .values(rows)
      .onConflictDoNothing({
        target: [
          stationInstances.stationId,
          stationInstances.connectorInstanceId,
        ],
        where: sql`deleted IS NULL`,
      })
      .returning()) as StationInstanceSelect[];
  }

  /** #674: soft-delete a station's live links to the given connectors. */
  async softDeleteByStationAndInstances(
    stationId: string,
    connectorInstanceIds: string[],
    deletedBy: string,
    client: DbClient = db
  ): Promise<number> {
    if (connectorInstanceIds.length === 0) return 0;
    const rows = await this.updateWhere(
      and(
        eq(stationInstances.stationId, stationId),
        inArray(stationInstances.connectorInstanceId, connectorInstanceIds)
      )!,
      { deleted: Date.now(), deletedBy },
      client
    );
    return rows.length;
  }

  /** #674: soft-delete every live connector link of a station. */
  async softDeleteByStation(
    stationId: string,
    deletedBy: string,
    client: DbClient = db
  ): Promise<number> {
    const rows = await this.updateWhere(
      eq(stationInstances.stationId, stationId),
      { deleted: Date.now(), deletedBy },
      client
    );
    return rows.length;
  }

  /** Count station links for a given connector instance. */
  async countByConnectorInstanceId(
    connectorInstanceId: string,
    client: DbClient = db
  ): Promise<number> {
    return this.count(
      eq(stationInstances.connectorInstanceId, connectorInstanceId),
      client
    );
  }

  /**
   * Hard-delete all station_instances rows for a given connector instance.
   * Returns the number of deleted rows.
   */
  async hardDeleteByConnectorInstanceId(
    connectorInstanceId: string,
    client: DbClient = db
  ): Promise<number> {
    const result = await (client as typeof db)
      .delete(this.table)
      .where(eq(stationInstances.connectorInstanceId, connectorInstanceId))
      .returning();
    return result.length;
  }
}

/** Singleton instance. */
export const stationInstancesRepo = new StationInstancesRepository();
