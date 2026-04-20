/**
 * Repository for the `station_instances` join table.
 *
 * Links stations to connector instances.
 */

import { eq, inArray } from "drizzle-orm";

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
