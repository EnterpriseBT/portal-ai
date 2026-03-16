/**
 * Repository for the `field_mappings` table.
 *
 * Extends the generic {@link Repository} with entity-scoped and
 * column-definition-scoped queries and composite-key upserts.
 */

import { eq, and } from "drizzle-orm";
import type { IndexColumn } from "drizzle-orm/pg-core";

import { fieldMappings } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type {
  FieldMappingSelect,
  FieldMappingInsert,
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
