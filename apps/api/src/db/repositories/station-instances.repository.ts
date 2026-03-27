/**
 * Repository for the `station_instances` join table.
 *
 * Links stations to connector instances.
 */

import { eq } from "drizzle-orm";

import { stationInstances } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type { StationInstanceSelect, StationInstanceInsert } from "../schema/zod.js";

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
    client: DbClient = db
  ): Promise<StationInstanceSelect[]> {
    return this.findMany(eq(stationInstances.stationId, stationId), {}, client);
  }

  /** Count station links for a given connector instance. */
  async countByConnectorInstanceId(
    connectorInstanceId: string,
    client: DbClient = db
  ): Promise<number> {
    return this.count(eq(stationInstances.connectorInstanceId, connectorInstanceId), client);
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
