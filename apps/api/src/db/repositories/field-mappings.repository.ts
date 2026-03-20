/**
 * Repository for the `field_mappings` table.
 *
 * Extends the generic {@link Repository} with entity-scoped and
 * column-definition-scoped queries and composite-key upserts.
 */

import { eq, and, asc, desc, getTableColumns, type SQL } from "drizzle-orm";
import type { IndexColumn } from "drizzle-orm/pg-core";

import { fieldMappings, connectorEntities } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient, type ListOptions } from "./base.repository.js";
import type {
  FieldMappingSelect,
  FieldMappingInsert,
  ConnectorEntitySelect,
} from "../schema/zod.js";

export class FieldMappingsRepository extends Repository<
  typeof fieldMappings,
  FieldMappingSelect,
  FieldMappingInsert
> {
  constructor() {
    super(fieldMappings);
  }

  /** Find all field mappings for a given connector entity. */
  async findByConnectorEntityId(
    connectorEntityId: string,
    client: DbClient = db
  ): Promise<FieldMappingSelect[]> {
    return (await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(fieldMappings.connectorEntityId, connectorEntityId),
          this.notDeleted()
        )
      )) as FieldMappingSelect[];
  }

  /** Find all field mappings across entities for a given column definition. */
  async findByColumnDefinitionId(
    columnDefinitionId: string,
    client: DbClient = db
  ): Promise<FieldMappingSelect[]> {
    return (await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(fieldMappings.columnDefinitionId, columnDefinitionId),
          this.notDeleted()
        )
      )) as FieldMappingSelect[];
  }

  /**
   * Return field mappings with their associated connector entity attached.
   * Uses a LEFT JOIN so mappings are returned even if the entity is missing.
   */
  async findManyWithConnectorEntity(
    where: SQL | undefined,
    opts: ListOptions = {},
    client: DbClient = db
  ): Promise<
    (FieldMappingSelect & { connectorEntity: ConnectorEntitySelect | null })[]
  > {
    const conditions = this.withSoftDelete(where, opts.includeDeleted);

    let query = (client as typeof db)
      .select({
        fieldMapping: getTableColumns(fieldMappings),
        connectorEntity: getTableColumns(connectorEntities),
      })
      .from(fieldMappings)
      .leftJoin(
        connectorEntities,
        eq(fieldMappings.connectorEntityId, connectorEntities.id)
      )
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
      ...(row.fieldMapping as FieldMappingSelect),
      connectorEntity: row.connectorEntity as ConnectorEntitySelect | null,
    }));
  }

  /**
   * Insert a field mapping or update it if a row with the same
   * `(connector_entity_id, column_definition_id)` already exists.
   * Returns the resulting row.
   */
  async upsertByEntityAndColumn(
    data: FieldMappingInsert,
    client: DbClient = db
  ): Promise<FieldMappingSelect> {
    const [row] = await (client as typeof db)
      .insert(this.table)
      .values(data as never)
      .onConflictDoUpdate({
        target: [
          fieldMappings.connectorEntityId,
          fieldMappings.columnDefinitionId,
        ] as IndexColumn[],
        set: {
          sourceField: data.sourceField,
          isPrimaryKey: data.isPrimaryKey,
          refColumnDefinitionId: data.refColumnDefinitionId,
          refEntityKey: data.refEntityKey,
          updated: data.updated ?? Date.now(),
          updatedBy: data.updatedBy,
        } as never,
      })
      .returning();
    return row as FieldMappingSelect;
  }
}

/** Singleton instance. */
export const fieldMappingsRepo = new FieldMappingsRepository();
