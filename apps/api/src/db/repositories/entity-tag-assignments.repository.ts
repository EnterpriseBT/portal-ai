/**
 * Repository for the `entity_tag_assignments` table.
 *
 * Extends the generic {@link Repository} with batch-loading helpers that
 * combine assignment rows with their parent tag details.
 */

import { eq, and, not, inArray, isNull } from "drizzle-orm";

import { entityTagAssignments, entityTags } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type {
  EntityTagAssignmentSelect,
  EntityTagAssignmentInsert,
  EntityTagSelect,
} from "../schema/zod.js";

export class EntityTagAssignmentsRepository extends Repository<
  typeof entityTagAssignments,
  EntityTagAssignmentSelect,
  EntityTagAssignmentInsert
> {
  constructor() {
    super(entityTagAssignments);
  }

  /**
   * Return all non-deleted assignments for a connector entity.
   * Pass `include: ["entityTag"]` to batch-load parent tag details.
   */
  async findByConnectorEntityId(
    connectorEntityId: string,
    opts: { include?: string[] } = {},
    client: DbClient = db
  ): Promise<(EntityTagAssignmentSelect & { tag?: EntityTagSelect })[]> {
    const assignments = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(entityTagAssignments.connectorEntityId, connectorEntityId),
          isNull(entityTagAssignments.deleted)
        )
      );

    if (assignments.length === 0 || !opts.include?.includes("entityTag")) {
      return assignments as EntityTagAssignmentSelect[];
    }

    const tagIds = assignments.map((a) => a.entityTagId);
    const tags = await (client as typeof db)
      .select()
      .from(entityTags)
      .where(and(inArray(entityTags.id, tagIds), isNull(entityTags.deleted)));

    const tagMap = new Map(tags.map((t) => [t.id, t as EntityTagSelect]));

    return assignments
      .filter((a) => tagMap.has(a.entityTagId))
      .map((a) => ({
        ...(a as EntityTagAssignmentSelect),
        tag: tagMap.get(a.entityTagId)!,
      }));
  }

  /** Return all non-deleted assignments for a given tag. */
  async findByEntityTagId(
    entityTagId: string,
    client: DbClient = db
  ): Promise<EntityTagAssignmentSelect[]> {
    return (await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(entityTagAssignments.entityTagId, entityTagId),
          isNull(entityTagAssignments.deleted)
        )
      )) as EntityTagAssignmentSelect[];
  }

  /**
   * Batch-load tag details for a set of connector entity IDs.
   * Returns a Map keyed by connectorEntityId for O(1) assembly in list responses.
   */
  async findByConnectorEntityIds(
    ids: string[],
    client: DbClient = db
  ): Promise<Map<string, EntityTagSelect[]>> {
    if (ids.length === 0) return new Map();

    const assignments = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          inArray(entityTagAssignments.connectorEntityId, ids),
          isNull(entityTagAssignments.deleted)
        )
      );

    if (assignments.length === 0) return new Map();

    const tagIds = [...new Set(assignments.map((a) => a.entityTagId))];
    const tags = await (client as typeof db)
      .select()
      .from(entityTags)
      .where(and(inArray(entityTags.id, tagIds), isNull(entityTags.deleted)));

    const tagMap = new Map(tags.map((t) => [t.id, t as EntityTagSelect]));

    const result = new Map<string, EntityTagSelect[]>();
    for (const a of assignments) {
      const tag = tagMap.get(a.entityTagId);
      if (!tag) continue;
      const list = result.get(a.connectorEntityId) ?? [];
      list.push(tag);
      result.set(a.connectorEntityId, list);
    }
    return result;
  }

  /**
   * Return an existing non-deleted assignment for a (connectorEntityId, entityTagId) pair,
   * or undefined if none exists. Used for duplicate detection before create.
   */
  async findExisting(
    connectorEntityId: string,
    entityTagId: string,
    client: DbClient = db
  ): Promise<EntityTagAssignmentSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(entityTagAssignments.connectorEntityId, connectorEntityId),
          eq(entityTagAssignments.entityTagId, entityTagId),
          isNull(entityTagAssignments.deleted)
        )
      )
      .limit(1);
    return row as EntityTagAssignmentSelect | undefined;
  }

  /**
   * Return an existing soft-deleted assignment for a (connectorEntityId, entityTagId) pair,
   * or undefined if none exists. Used to restore a previously removed assignment.
   */
  async findSoftDeleted(
    connectorEntityId: string,
    entityTagId: string,
    client: DbClient = db
  ): Promise<EntityTagAssignmentSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(entityTagAssignments.connectorEntityId, connectorEntityId),
          eq(entityTagAssignments.entityTagId, entityTagId),
          not(isNull(entityTagAssignments.deleted))
        )
      )
      .limit(1);
    return row as EntityTagAssignmentSelect | undefined;
  }

  /**
   * Restore a soft-deleted assignment by clearing the deleted/deletedBy fields.
   */
  async restore(
    id: string,
    userId: string,
    client: DbClient = db
  ): Promise<EntityTagAssignmentSelect | undefined> {
    const [row] = await (client as typeof db)
      .update(this.table)
      .set({ deleted: null, deletedBy: null, updated: Date.now(), updatedBy: userId } as any)
      .where(eq(entityTagAssignments.id, id))
      .returning();
    return row as EntityTagAssignmentSelect | undefined;
  }
}

/** Singleton instance. */
export const entityTagAssignmentsRepo = new EntityTagAssignmentsRepository();
