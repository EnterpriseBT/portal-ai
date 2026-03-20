/**
 * Repository for the `column_definitions` table.
 *
 * Extends the generic {@link Repository} with organization-scoped queries
 * and key-based upserts.
 */

import { eq, and } from "drizzle-orm";
import type { IndexColumn } from "drizzle-orm/pg-core";

import { columnDefinitions } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type {
  ColumnDefinitionSelect,
  ColumnDefinitionInsert,
} from "../schema/zod.js";

export class ColumnDefinitionsRepository extends Repository<
  typeof columnDefinitions,
  ColumnDefinitionSelect,
  ColumnDefinitionInsert
> {
  constructor() {
    super(columnDefinitions);
  }

  /** Find all column definitions for an organization. */
  async findByOrganizationId(
    organizationId: string,
    client: DbClient = db
  ): Promise<ColumnDefinitionSelect[]> {
    return (await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(columnDefinitions.organizationId, organizationId),
          this.notDeleted()
        )
      )) as ColumnDefinitionSelect[];
  }

  /** Find a single column definition by organization + key. */
  async findByKey(
    organizationId: string,
    key: string,
    client: DbClient = db
  ): Promise<ColumnDefinitionSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(columnDefinitions.organizationId, organizationId),
          eq(columnDefinitions.key, key),
          this.notDeleted()
        )
      )
      .limit(1);
    return row as ColumnDefinitionSelect | undefined;
  }

  /**
   * Insert a column definition or update it if a row with the same
   * `(organization_id, key)` already exists. Returns the resulting row.
   */
  async upsertByKey(
    data: ColumnDefinitionInsert,
    client: DbClient = db
  ): Promise<ColumnDefinitionSelect> {
    const [row] = await (client as typeof db)
      .insert(this.table)
      .values(data as never)
      .onConflictDoUpdate({
        target: [
          columnDefinitions.organizationId,
          columnDefinitions.key,
        ] as IndexColumn[],
        set: {
          label: data.label,
          type: data.type,
          required: data.required,
          defaultValue: data.defaultValue,
          format: data.format,
          enumValues: data.enumValues,
          description: data.description,
          updated: data.updated ?? Date.now(),
          updatedBy: data.updatedBy,
        } as never,
      })
      .returning();
    return row as ColumnDefinitionSelect;
  }
}

/** Singleton instance. */
export const columnDefinitionsRepo = new ColumnDefinitionsRepository();
