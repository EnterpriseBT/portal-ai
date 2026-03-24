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
  fieldMappings,
} from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type {
  EntityGroupMemberSelect,
  EntityGroupMemberInsert,
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
   * Return all non-deleted members for a group, each enriched with
   * connector entity label and field mapping details (two-query batch-load pattern).
   */
  async findByEntityGroupId(
    entityGroupId: string,
    client: DbClient = db
  ): Promise<
    (EntityGroupMemberSelect & {
      connectorEntity: ConnectorEntitySelect;
      fieldMapping: FieldMappingSelect;
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

    // Batch-load connector entities
    const entityIds = [...new Set(members.map((m) => m.connectorEntityId))];
    const entities = await (client as typeof db)
      .select()
      .from(connectorEntities)
      .where(inArray(connectorEntities.id, entityIds));
    const entityMap = new Map(
      entities.map((e) => [e.id, e as ConnectorEntitySelect])
    );

    // Batch-load field mappings
    const mappingIds = [...new Set(members.map((m) => m.linkFieldMappingId))];
    const mappings = await (client as typeof db)
      .select()
      .from(fieldMappings)
      .where(inArray(fieldMappings.id, mappingIds));
    const mappingMap = new Map(
      mappings.map((m) => [m.id, m as FieldMappingSelect])
    );

    return members
      .filter(
        (m) =>
          entityMap.has(m.connectorEntityId) &&
          mappingMap.has(m.linkFieldMappingId)
      )
      .map((m) => ({
        ...(m as EntityGroupMemberSelect),
        connectorEntity: entityMap.get(m.connectorEntityId)!,
        fieldMapping: mappingMap.get(m.linkFieldMappingId)!,
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
}

/** Singleton instance. */
export const entityGroupMembersRepo = new EntityGroupMembersRepository();
