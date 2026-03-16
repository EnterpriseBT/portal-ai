/**
 * Repository for the `connector_entities` table.
 *
 * Extends the generic {@link Repository} with connector-instance-scoped
 * queries and key-based lookups.
 */

import { eq, and } from "drizzle-orm";

import { connectorEntities } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type {
  ConnectorEntitySelect,
  ConnectorEntityInsert,
} from "../schema/zod.js";

export class ConnectorEntitiesRepository extends Repository<
  typeof connectorEntities,
  ConnectorEntitySelect,
  ConnectorEntityInsert
> {
  constructor() {
    super(connectorEntities);
  }

  /** Find all entities for a given connector instance. */
  async findByConnectorInstanceId(
    connectorInstanceId: string,
    client: DbClient = db
  ): Promise<ConnectorEntitySelect[]> {
    return (await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(connectorEntities.connectorInstanceId, connectorInstanceId),
          this.notDeleted()
        )
      )) as ConnectorEntitySelect[];
  }

  /** Find a single entity by connector instance + key. */
  async findByKey(
    connectorInstanceId: string,
    key: string,
    client: DbClient = db
  ): Promise<ConnectorEntitySelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(connectorEntities.connectorInstanceId, connectorInstanceId),
          eq(connectorEntities.key, key),
          this.notDeleted()
        )
      )
      .limit(1);
    return row as ConnectorEntitySelect | undefined;
  }
}

/** Singleton instance. */
export const connectorEntitiesRepo = new ConnectorEntitiesRepository();
