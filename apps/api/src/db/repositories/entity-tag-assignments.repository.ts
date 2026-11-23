/* eslint-disable @typescript-eslint/no-explicit-any -- escape hatches for drizzle ORM and JSONB typings; values are validated upstream. */
/**
 * Repository for the `entity_tag_assignments` table.
 *
 * Since #1070 an assignment targets one of five object types (entity,
 * station, pin, connector instance, curated view), each in its own FK column.
 * Every method takes the target type and resolves that column through
 * {@link targetColumn}, so a caller never names a column.
 */

import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import type { TagTarget, TagTargetType } from "@portalai/core/models";

import { entityTagAssignments, entityTags } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type {
  EntityTagAssignmentSelect,
  EntityTagAssignmentInsert,
  EntityTagSelect,
} from "../schema/zod.js";

/** The assignment column holding each target type's id. */
const TARGET_COLUMNS = {
  entity: entityTagAssignments.connectorEntityId,
  station: entityTagAssignments.stationId,
  pin: entityTagAssignments.portalResultId,
  connector_instance: entityTagAssignments.connectorInstanceId,
  curated_view: entityTagAssignments.curatedViewId,
} as const satisfies Record<TagTargetType, AnyPgColumn>;

/** The assignment insert field holding each target type's id. */
const TARGET_FIELDS = {
  entity: "connectorEntityId",
  station: "stationId",
  pin: "portalResultId",
  connector_instance: "connectorInstanceId",
  curated_view: "curatedViewId",
} as const satisfies Record<TagTargetType, keyof EntityTagAssignmentInsert>;

type TargetField = (typeof TARGET_FIELDS)[TagTargetType];

export function targetColumn(type: TagTargetType) {
  return TARGET_COLUMNS[type];
}

/** A tag as it sits on one object: the tag plus the assignment's id. */
export type AssignedTagRow = EntityTagSelect & { assignmentId: string };

export class EntityTagAssignmentsRepository extends Repository<
  typeof entityTagAssignments,
  EntityTagAssignmentSelect,
  EntityTagAssignmentInsert
> {
  constructor() {
    super(entityTagAssignments);
  }

  /** Count live assignments across objects of one type. */
  async countByTargetIds(
    type: TagTargetType,
    ids: string[],
    client: DbClient = db
  ): Promise<number> {
    if (ids.length === 0) return 0;
    return this.count(inArray(targetColumn(type), ids), client);
  }

  /**
   * The live tags on one object, each with its assignment id. A tag that has
   * been deleted is left out.
   */
  async findByTarget(
    target: TagTarget,
    client: DbClient = db
  ): Promise<AssignedTagRow[]> {
    const rows = await (client as typeof db)
      .select({ assignmentId: entityTagAssignments.id, tag: entityTags })
      .from(entityTagAssignments)
      .innerJoin(
        entityTags,
        eq(entityTags.id, entityTagAssignments.entityTagId)
      )
      .where(
        and(
          eq(targetColumn(target.type), target.id),
          isNull(entityTagAssignments.deleted),
          isNull(entityTags.deleted)
        )
      )
      .orderBy(entityTags.name, entityTags.id);
    return rows.map((r) => ({
      ...(r.tag as EntityTagSelect),
      assignmentId: r.assignmentId,
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
   * The live tags on a page of objects of one type, in one query, keyed by
   * object id. Objects with no tags are absent from the map.
   */
  async findByTargetIds(
    type: TagTargetType,
    ids: string[],
    client: DbClient = db
  ): Promise<Map<string, EntityTagSelect[]>> {
    if (ids.length === 0) return new Map();
    const column = targetColumn(type);
    const rows = await (client as typeof db)
      .select({ targetId: column, tag: entityTags })
      .from(entityTagAssignments)
      .innerJoin(
        entityTags,
        eq(entityTags.id, entityTagAssignments.entityTagId)
      )
      .where(
        and(
          inArray(column, ids),
          isNull(entityTagAssignments.deleted),
          isNull(entityTags.deleted)
        )
      )
      .orderBy(entityTags.name, entityTags.id);

    const result = new Map<string, EntityTagSelect[]>();
    for (const { targetId, tag } of rows) {
      if (!targetId) continue;
      const list = result.get(targetId) ?? [];
      list.push(tag as EntityTagSelect);
      result.set(targetId, list);
    }
    return result;
  }

  /**
   * Assign a tag to an object unless it already carries it. Race-safe: the
   * insert yields to the target's partial unique index, so two concurrent
   * calls make one row and the other reads it back with `created: false`.
   */
  async insertIfAbsent(
    target: TagTarget,
    entityTagId: string,
    row: Omit<EntityTagAssignmentInsert, TargetField | "entityTagId">,
    client: DbClient = db
  ): Promise<{ row: EntityTagAssignmentSelect; created: boolean }> {
    const column = targetColumn(target.type);
    const values = {
      ...row,
      connectorEntityId: null,
      stationId: null,
      portalResultId: null,
      connectorInstanceId: null,
      curatedViewId: null,
      [TARGET_FIELDS[target.type]]: target.id,
      entityTagId,
    } as EntityTagAssignmentInsert;

    const [inserted] = await (client as typeof db)
      .insert(entityTagAssignments)
      .values(values as any)
      .onConflictDoNothing({
        // A partial unique index is only matched when the conflict clause
        // restates its predicate.
        target: [column, entityTagAssignments.entityTagId],
        where: sql`deleted IS NULL`,
      })
      .returning();
    if (inserted) {
      return { row: inserted as EntityTagAssignmentSelect, created: true };
    }

    const [existing] = await (client as typeof db)
      .select()
      .from(entityTagAssignments)
      .where(
        and(
          eq(column, target.id),
          eq(entityTagAssignments.entityTagId, entityTagId),
          isNull(entityTagAssignments.deleted)
        )
      )
      .limit(1);
    if (!existing) {
      // The conflicting row was removed between the two statements.
      throw new Error("Tag assignment conflicted with a row that is gone");
    }
    return { row: existing as EntityTagAssignmentSelect, created: false };
  }

  /** A live assignment, only when it sits on this object. */
  async findAssignment(
    target: TagTarget,
    assignmentId: string,
    client: DbClient = db
  ): Promise<EntityTagAssignmentSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(entityTagAssignments)
      .where(
        and(
          eq(entityTagAssignments.id, assignmentId),
          eq(targetColumn(target.type), target.id),
          isNull(entityTagAssignments.deleted)
        )
      )
      .limit(1);
    return row as EntityTagAssignmentSelect | undefined;
  }

  /**
   * Soft-delete every live assignment on these objects. Returns the number
   * of affected rows.
   */
  async softDeleteByTargets(
    type: TagTargetType,
    ids: string[],
    deletedBy: string,
    client: DbClient = db
  ): Promise<number> {
    if (ids.length === 0) return 0;
    // #423: count from the driver — `RETURNING` here streamed every
    // matched row (with its payload) into Node just to call `.length`.
    const result = await (client as typeof db)
      .update(this.table)
      .set({ deleted: Date.now(), deletedBy } as any)
      .where(
        and(
          inArray(targetColumn(type), ids),
          isNull(entityTagAssignments.deleted)
        )
      );
    return result.count;
  }

  /**
   * A list-query predicate: the object (`idCol`) carries at least one of the
   * tags. An empty tag list matches nothing.
   */
  taggedWithAny(
    type: TagTargetType,
    idCol: AnyPgColumn,
    tagIds: string[]
  ): SQL {
    if (tagIds.length === 0) return sql`false`;
    const column = targetColumn(type);
    return inArray(
      idCol,
      db
        .select({ id: column })
        .from(entityTagAssignments)
        .where(
          and(
            inArray(entityTagAssignments.entityTagId, tagIds),
            isNull(entityTagAssignments.deleted)
          )
        )
    );
  }
}

/** Singleton instance. */
export const entityTagAssignmentsRepo = new EntityTagAssignmentsRepository();
