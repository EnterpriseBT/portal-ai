/**
 * Repository for the `connector_definitions` table.
 *
 * Extends the generic {@link Repository} with connector-specific queries.
 */

import { eq, and, sql, isNull } from "drizzle-orm";
import type { IndexColumn } from "drizzle-orm/pg-core";
import { connectorDefinitions } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type {
  ConnectorDefinitionSelect,
  ConnectorDefinitionInsert,
} from "../schema/zod.js";

export class ConnectorDefinitionsRepository extends Repository<
  typeof connectorDefinitions,
  ConnectorDefinitionSelect,
  ConnectorDefinitionInsert
> {
  constructor() {
    super(connectorDefinitions);
  }

  /** Find a connector definition by slug (exact match). */
  async findBySlug(
    slug: string,
    client: DbClient = db
  ): Promise<ConnectorDefinitionSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table)
      .where(and(eq(connectorDefinitions.slug, slug), this.notDeleted()))
      .limit(1);
    return row;
  }

  /** Find all connector definitions in a given category. */
  async findByCategory(
    category: string,
    client: DbClient = db
  ): Promise<ConnectorDefinitionSelect[]> {
    return (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(eq(connectorDefinitions.category, category), this.notDeleted())
      );
  }

  /**
   * Upsert multiple connector definitions by slug.
   * On conflict, updates all columns except id and slug.
   */
  async upsertManyBySlug(
    data: ConnectorDefinitionInsert[],
    client: DbClient = db
  ): Promise<ConnectorDefinitionSelect[]> {
    if (data.length === 0) return [];

    const set: Record<string, ReturnType<typeof sql.raw>> = {};
    for (const [name, col] of Object.entries(this.cols)) {
      if (name === "id" || name === "slug") continue;
      set[name] = sql.raw(`excluded."${col.name}"`);
    }

    return (client as typeof db)
      .insert(this.table)
      .values(data)
      .onConflictDoUpdate({
        target: connectorDefinitions.slug as IndexColumn,
        targetWhere: isNull(connectorDefinitions.deleted),
        set: set,
      })
      .returning();
  }

  /** Find all active connector definitions. */
  async findActive(
    client: DbClient = db
  ): Promise<ConnectorDefinitionSelect[]> {
    return (client as typeof db)
      .select()
      .from(this.table)
      .where(and(eq(connectorDefinitions.isActive, true), this.notDeleted()));
  }
}

/** Singleton instance. */
export const connectorDefinitionsRepo = new ConnectorDefinitionsRepository();
