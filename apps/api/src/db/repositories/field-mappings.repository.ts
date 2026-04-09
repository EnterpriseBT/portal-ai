/**
 * Repository for the `field_mappings` table.
 *
 * Extends the generic {@link Repository} with entity-scoped and
 * column-definition-scoped queries and composite-key upserts.
 */

import { eq, and, not, asc, desc, getTableColumns, type SQL, inArray, isNull } from "drizzle-orm";
import type { IndexColumn } from "drizzle-orm/pg-core";

import { fieldMappings, connectorEntities, columnDefinitions } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient, type ListOptions } from "./base.repository.js";

export interface FieldMappingListOptions extends ListOptions {
  include?: string[];
}
import type {
  FieldMappingSelect,
  FieldMappingInsert,
  ColumnDefinitionSelect,
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

  override async findMany(
    where?: SQL,
    opts: FieldMappingListOptions = {},
    client: DbClient = db
  ): Promise<FieldMappingSelect[]> {
    if (opts.include?.includes("connectorEntity")) {
      return this.findManyWithConnectorEntity(where, opts, client) as unknown as FieldMappingSelect[];
    }
    if (opts.include?.includes("columnDefinition")) {
      return this.findManyWithColumnDefinition(where, opts, client) as unknown as FieldMappingSelect[];
    }
    return super.findMany(where, opts, client);
  }

  /** Count field mappings across multiple connector entities (soft-delete aware). */
  async countByConnectorEntityIds(
    connectorEntityIds: string[],
    client: DbClient = db
  ): Promise<number> {
    if (connectorEntityIds.length === 0) return 0;
    return this.count(inArray(fieldMappings.connectorEntityId, connectorEntityIds), client);
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

  /** Count field mappings for a given column definition (soft-delete aware). */
  async countByColumnDefinitionId(
    columnDefinitionId: string,
    client: DbClient = db
  ): Promise<number> {
    return this.count(eq(fieldMappings.columnDefinitionId, columnDefinitionId), client);
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
   * Return field mappings with their associated column definition attached.
   * Uses a LEFT JOIN so mappings are returned even if the column definition is missing.
   */
  async findManyWithColumnDefinition(
    where: SQL | undefined,
    opts: ListOptions = {},
    client: DbClient = db
  ): Promise<
    (FieldMappingSelect & { columnDefinition: ColumnDefinitionSelect | null })[]
  > {
    const conditions = this.withSoftDelete(where, opts.includeDeleted);

    let query = (client as typeof db)
      .select({
        fieldMapping: getTableColumns(fieldMappings),
        columnDefinition: getTableColumns(columnDefinitions),
      })
      .from(fieldMappings)
      .leftJoin(
        columnDefinitions,
        eq(fieldMappings.columnDefinitionId, columnDefinitions.id)
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
      columnDefinition: row.columnDefinition as ColumnDefinitionSelect | null,
    }));
  }

  /**
   * Insert a field mapping or update it if a row with the same
   * `(connector_entity_id, normalized_key)` already exists.
   * Returns the resulting row.
   */
  async upsertByEntityAndNormalizedKey(
    data: FieldMappingInsert,
    client: DbClient = db
  ): Promise<FieldMappingSelect> {
    const [row] = await (client as typeof db)
      .insert(this.table)
      .values(data as never)
      .onConflictDoUpdate({
        target: [
          fieldMappings.connectorEntityId,
          fieldMappings.normalizedKey,
        ] as IndexColumn[],
        targetWhere: isNull(fieldMappings.deleted),
        set: {
          sourceField: data.sourceField,
          isPrimaryKey: data.isPrimaryKey,
          columnDefinitionId: data.columnDefinitionId,
          required: data.required,
          defaultValue: data.defaultValue,
          format: data.format,
          enumValues: data.enumValues,
          refNormalizedKey: data.refNormalizedKey,
          refEntityKey: data.refEntityKey,
          updated: data.updated ?? Date.now(),
          updatedBy: data.updatedBy,
        } as never,
      })
      .returning();
    return row as FieldMappingSelect;
  }

  /**
   * Find the counterpart of a bidirectional reference pair.
   * Looks for a field mapping in the target entity that points back
   * to the source entity with a matching normalizedKey.
   */
  async findCounterpart(
    organizationId: string,
    entityKey: string,
    refEntityKey: string,
    refNormalizedKey: string,
    client: DbClient = db
  ): Promise<FieldMappingSelect | null> {
    const rows = await (client as typeof db)
      .select({ fieldMapping: getTableColumns(fieldMappings) })
      .from(fieldMappings)
      .innerJoin(
        connectorEntities,
        eq(fieldMappings.connectorEntityId, connectorEntities.id)
      )
      .where(
        and(
          eq(fieldMappings.organizationId, organizationId),
          eq(connectorEntities.key, refEntityKey),
          eq(fieldMappings.normalizedKey, refNormalizedKey),
          eq(fieldMappings.refEntityKey, entityKey),
          this.notDeleted(),
        )
      );

    return (rows[0]?.fieldMapping as FieldMappingSelect) ?? null;
  }

  /**
   * Return a field mapping and its bidirectional counterpart.
   * If the mapping has no ref fields, `counterpart` will be null.
   */
  async findBidirectionalPair(
    fieldMappingId: string,
    client: DbClient = db
  ): Promise<{ mapping: FieldMappingSelect; counterpart: FieldMappingSelect | null }> {
    const mapping = await this.findById(fieldMappingId, client);
    if (!mapping) {
      return { mapping: null as unknown as FieldMappingSelect, counterpart: null };
    }
    if (!mapping.refEntityKey || !mapping.refNormalizedKey) {
      return { mapping, counterpart: null };
    }

    // Look up the entity key for this mapping's connector entity
    const entityRows = await (client as typeof db)
      .select({ key: connectorEntities.key })
      .from(connectorEntities)
      .where(eq(connectorEntities.id, mapping.connectorEntityId));
    const entityKey = entityRows[0]?.key;
    if (!entityKey) {
      return { mapping, counterpart: null };
    }

    const counterpart = await this.findCounterpart(
      mapping.organizationId,
      entityKey,
      mapping.refEntityKey,
      mapping.refNormalizedKey,
      client
    );
    return { mapping, counterpart };
  }
  /** Find field mappings from *other* entities where `refEntityKey` matches a given entity key. */
  async findByRefEntityKey(
    refEntityKey: string,
    excludeConnectorEntityId: string,
    client: DbClient = db
  ): Promise<FieldMappingSelect[]> {
    return (await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(fieldMappings.refEntityKey, refEntityKey),
          not(eq(fieldMappings.connectorEntityId, excludeConnectorEntityId)),
          this.notDeleted()
        )
      )) as FieldMappingSelect[];
  }

  /** Count field mappings from *other* entities where `refEntityKey` matches a given entity key. */
  async countByRefEntityKey(
    refEntityKey: string,
    excludeConnectorEntityId: string,
    client: DbClient = db
  ): Promise<number> {
    return this.count(
      and(
        eq(fieldMappings.refEntityKey, refEntityKey),
        not(eq(fieldMappings.connectorEntityId, excludeConnectorEntityId))
      ),
      client
    );
  }

  /**
   * Soft-delete all field mappings across multiple connector entities.
   * Returns the number of affected rows.
   */
  async softDeleteByConnectorEntityIds(
    connectorEntityIds: string[],
    deletedBy: string,
    client: DbClient = db
  ): Promise<number> {
    if (connectorEntityIds.length === 0) return 0;
    const now = Date.now();
    const result = await (client as typeof db)
      .update(this.table)
      .set({ deleted: now, deletedBy } as any)
      .where(
        and(
          inArray(fieldMappings.connectorEntityId, connectorEntityIds),
          this.notDeleted()
        )
      )
      .returning();
    return result.length;
  }
}

/** Singleton instance. */
export const fieldMappingsRepo = new FieldMappingsRepository();
