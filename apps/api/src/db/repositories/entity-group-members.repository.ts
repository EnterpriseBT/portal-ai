/**
 * Repository for the `entity_group_members` table.
 *
 * Extends the generic {@link Repository} with group-scoped lookups,
 * duplicate detection, and primary-member management.
 */

import { and, eq, isNull, isNotNull, inArray } from "drizzle-orm";

import {
  entityGroupMembers,
  connectorEntities,
  columnDefinitions,
  fieldMappings,
} from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type {
  EntityGroupMemberSelect,
  EntityGroupMemberInsert,
  ColumnDefinitionSelect,
  ConnectorEntitySelect,
  FieldMappingSelect,
} from "../schema/zod.js";

export class EntityGroupMembersRepository extends Repository<
  typeof entityGroupMembers,
  EntityGroupMemberSelect,
  EntityGroupMemberInsert
> {
  constructor() {
    super(entityGroupMembers);
  }

  /**
   * Return all non-deleted members for a group.
   * Pass `include` to batch-load related data:
   * - `"connectorEntity"` — connector entity details
   * - `"fieldMapping"` — field mapping details
   * - `"columnDefinition"` — column definition details (via field mapping)
   */
  async findByEntityGroupId(
    entityGroupId: string,
    opts: { include?: string[] } = {},
    client: DbClient = db
  ): Promise<
    (EntityGroupMemberSelect & {
      connectorEntity?: ConnectorEntitySelect;
      fieldMapping?: FieldMappingSelect;
      columnDefinition?: ColumnDefinitionSelect;
    })[]
  > {
    const members = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(entityGroupMembers.entityGroupId, entityGroupId),
          isNull(entityGroupMembers.deleted)
        )
      );

    if (members.length === 0) return [];

    const includes = new Set(opts.include ?? []);
    if (includes.size === 0) return members as EntityGroupMemberSelect[];

    // Batch-load connector entities
    const entityMap = includes.has("connectorEntity")
      ? await (client as typeof db)
          .select()
          .from(connectorEntities)
          .where(inArray(connectorEntities.id, [...new Set(members.map((m) => m.connectorEntityId))]))
          .then((rows) => new Map(rows.map((e) => [e.id, e as ConnectorEntitySelect])))
      : null;

    // Batch-load field mappings
    const mappingIds = [...new Set(members.map((m) => m.linkFieldMappingId))];
    const mappingMap = includes.has("fieldMapping") || includes.has("columnDefinition")
      ? await (client as typeof db)
          .select()
          .from(fieldMappings)
          .where(inArray(fieldMappings.id, mappingIds))
          .then((rows) => new Map(rows.map((m) => [m.id, m as FieldMappingSelect])))
      : null;

    // Batch-load column definitions for each field mapping
    const colDefMap = includes.has("columnDefinition") && mappingMap
      ? await (async () => {
          const colDefIds = [...new Set([...mappingMap.values()].map((m) => m.columnDefinitionId))];
          if (colDefIds.length === 0) return new Map<string, ColumnDefinitionSelect>();
          const colDefs = await (client as typeof db)
            .select()
            .from(columnDefinitions)
            .where(inArray(columnDefinitions.id, colDefIds));
          return new Map(colDefs.map((c) => [c.id, c as ColumnDefinitionSelect]));
        })()
      : null;

    return members
      .filter((m) => {
        if (entityMap && !entityMap.has(m.connectorEntityId)) return false;
        if (mappingMap && !mappingMap.has(m.linkFieldMappingId)) return false;
        if (colDefMap && mappingMap) {
          const mapping = mappingMap.get(m.linkFieldMappingId);
          if (!mapping || !colDefMap.has(mapping.columnDefinitionId)) return false;
        }
        return true;
      })
      .map((m) => ({
        ...(m as EntityGroupMemberSelect),
        ...(entityMap && { connectorEntity: entityMap.get(m.connectorEntityId)! }),
        ...(mappingMap && { fieldMapping: mappingMap.get(m.linkFieldMappingId)! }),
        ...(colDefMap && mappingMap && { columnDefinition: colDefMap.get(mappingMap.get(m.linkFieldMappingId)!.columnDefinitionId)! }),
      }));
  }

  /** Return all non-deleted group memberships for a connector entity. */
  async findByConnectorEntityId(
    connectorEntityId: string,
    client: DbClient = db
  ): Promise<EntityGroupMemberSelect[]> {
    return (await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(entityGroupMembers.connectorEntityId, connectorEntityId),
          isNull(entityGroupMembers.deleted)
        )
      )) as EntityGroupMemberSelect[];
  }

  /**
   * Return an existing non-deleted member for a (entityGroupId, connectorEntityId) pair,
   * or undefined if none exists. Used for duplicate detection.
   */
  async findExisting(
    entityGroupId: string,
    connectorEntityId: string,
    client: DbClient = db
  ): Promise<EntityGroupMemberSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(entityGroupMembers.entityGroupId, entityGroupId),
          eq(entityGroupMembers.connectorEntityId, connectorEntityId),
          isNull(entityGroupMembers.deleted)
        )
      )
      .limit(1);
    return row as EntityGroupMemberSelect | undefined;
  }

  /**
   * Return a soft-deleted member for a (entityGroupId, connectorEntityId) pair,
   * or undefined if none exists. Used to restore previously deleted members.
   */
  async findSoftDeleted(
    entityGroupId: string,
    connectorEntityId: string,
    client: DbClient = db
  ): Promise<EntityGroupMemberSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(entityGroupMembers.entityGroupId, entityGroupId),
          eq(entityGroupMembers.connectorEntityId, connectorEntityId),
          isNotNull(entityGroupMembers.deleted)
        )
      )
      .limit(1);
    return row as EntityGroupMemberSelect | undefined;
  }

  /**
   * Restore a soft-deleted member by clearing its deleted/deletedBy fields
   * and updating its data. Bypasses the base `update` soft-delete filter.
   */
  async restore(
    id: string,
    data: Partial<EntityGroupMemberInsert>,
    client: DbClient = db
  ): Promise<EntityGroupMemberSelect | undefined> {
    const [row] = await (client as typeof db)
      .update(this.table)
      .set({ ...data, deleted: null, deletedBy: null } as never)
      .where(eq(entityGroupMembers.id, id))
      .returning();
    return row as EntityGroupMemberSelect | undefined;
  }

  /** Return the primary member of a group, or undefined if none is set. */
  async findPrimary(
    entityGroupId: string,
    client: DbClient = db
  ): Promise<EntityGroupMemberSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(entityGroupMembers.entityGroupId, entityGroupId),
          eq(entityGroupMembers.isPrimary, true),
          isNull(entityGroupMembers.deleted)
        )
      )
      .limit(1);
    return row as EntityGroupMemberSelect | undefined;
  }

  /** Set `isPrimary = false` on all members of a group (used before setting a new primary). */
  async clearPrimary(
    entityGroupId: string,
    client: DbClient = db
  ): Promise<void> {
    await (client as typeof db)
      .update(this.table)
      .set({ isPrimary: false } as never)
      .where(
        and(
          eq(entityGroupMembers.entityGroupId, entityGroupId),
          isNull(entityGroupMembers.deleted)
        )
      );
  }

  /**
   * Set a member as the primary for its group, clearing any existing primary.
   * Runs inside a transaction for atomicity when no transaction client is provided.
   */
  async setPrimary(
    memberId: string,
    client?: DbClient
  ): Promise<EntityGroupMemberSelect | undefined> {
    const exec = async (tx: DbClient): Promise<EntityGroupMemberSelect | undefined> => {
      const member = await this.findById(memberId, tx);
      if (!member) return undefined;

      await this.clearPrimary(member.entityGroupId, tx);

      const [updated] = await (tx as typeof db)
        .update(this.table)
        .set({ isPrimary: true } as never)
        .where(
          and(
            eq(entityGroupMembers.id, memberId),
            isNull(entityGroupMembers.deleted)
          )
        )
        .returning();

      return updated as EntityGroupMemberSelect | undefined;
    };

    if (client) return exec(client);
    return Repository.transaction((tx) => exec(tx));
  }
  /**
   * Soft-delete all group members across multiple connector entities.
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
          inArray(entityGroupMembers.connectorEntityId, connectorEntityIds),
          isNull(entityGroupMembers.deleted)
        )
      )
      .returning();
    return result.length;
  }
}

/** Singleton instance. */
export const entityGroupMembersRepo = new EntityGroupMembersRepository();
