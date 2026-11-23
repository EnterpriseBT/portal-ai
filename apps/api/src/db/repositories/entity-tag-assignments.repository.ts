/* eslint-disable @typescript-eslint/no-explicit-any -- escape hatches for drizzle ORM and JSONB typings; values are validated upstream. */
/**
 * Repository for the `entity_tag_assignments` table.
 *
 * Since #1070 an assignment targets one of five object types (entity,
 * station, pin, connector instance, curated view), each in its own FK column.
 * Every method takes the target type and resolves that column through
 * {@link targetColumn}, so a caller never names a column.
 */

import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import {
  TAG_TARGET_COLUMNS,
  type TagTarget,
  type TagTargetType,
} from "@portalai/core/models";

import {
  connectorEntities,
  connectorInstances,
  curatedViews,
  entityTagAssignments,
  entityTags,
  portalResults,
  stations,
} from "../schema/index.js";
import { db } from "../client.js";
import { ilikeContains } from "../../utils/filter-sql.util.js";
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

type TargetField = (typeof TAG_TARGET_COLUMNS)[TagTargetType];

export function targetColumn(type: TagTargetType) {
  return TARGET_COLUMNS[type];
}

/** The table each target type's objects live in. */
export const TARGET_TABLES = {
  entity: connectorEntities,
  station: stations,
  pin: portalResults,
  connector_instance: connectorInstances,
  curated_view: curatedViews,
} as const;

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
      [TAG_TARGET_COLUMNS[target.type]]: target.id,
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

  /**
   * Share-lock the object's row while it's live, for the length of the
   * caller's transaction. A concurrent delete (an UPDATE or DELETE of that
   * row) waits for it, or it waits for the delete and then sees the row
   * gone. Returns false when the object is deleted or missing.
   */
  async lockLiveTarget(target: TagTarget, client: DbClient): Promise<boolean> {
    const table = TARGET_TABLES[target.type];
    const [row] = await (client as typeof db)
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, target.id), isNull(table.deleted)))
      .for("share");
    return !!row;
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
    client: DbClient = db,
    /** The delete's shared stamp, so its rows tombstone together (#1064). */
    deletedAt: number = Date.now()
  ): Promise<number> {
    if (ids.length === 0) return 0;
    // #423: count from the driver — `RETURNING` here streamed every
    // matched row (with its payload) into Node just to call `.length`.
    const result = await (client as typeof db)
      .update(this.table)
      .set({ deleted: deletedAt, deletedBy } as any)
      .where(
        and(
          inArray(targetColumn(type), ids),
          isNull(entityTagAssignments.deleted)
        )
      );
    return result.count;
  }

  /**
   * How many live objects of one type carry each tag, keyed by tag id. A
   * tag on no counted object is absent. `visible` narrows the objects
   * counted (the caller's read predicate on the type's table).
   */
  async countObjectsByTag(
    type: TagTargetType,
    tagIds: string[],
    organizationId: string,
    visible: SQL | undefined,
    client: DbClient = db
  ): Promise<Map<string, number>> {
    if (tagIds.length === 0) return new Map();
    const table = TARGET_TABLES[type];
    const rows = await (client as typeof db)
      .select({ tagId: entityTagAssignments.entityTagId, n: count() })
      .from(entityTagAssignments)
      .innerJoin(table, eq(table.id, targetColumn(type)))
      .where(
        and(
          inArray(entityTagAssignments.entityTagId, tagIds),
          eq(entityTagAssignments.organizationId, organizationId),
          isNull(entityTagAssignments.deleted),
          isNull(table.deleted),
          visible
        )
      )
      .groupBy(entityTagAssignments.entityTagId);
    return new Map(rows.map((r) => [r.tagId, Number(r.n)]));
  }

  /**
   * #1071: one page of an org's live objects of one taggable type, filtered
   * by `visible` (the caller's read predicate for the type) and optionally
   * by `search` on the name (and, for views and entities, the key). Sorted by
   * name, then id. For the agent's `tag_target_list`.
   */
  async findTargets(
    type: TagTargetType,
    organizationId: string,
    visible: SQL | undefined,
    opts: { search?: string; limit: number; offset: number },
    client: DbClient = db
  ): Promise<{ rows: { id: string; name: string }[]; total: number }> {
    const table = TARGET_TABLES[type];
    const name: AnyPgColumn = "label" in table ? table.label : table.name;
    const key: AnyPgColumn | undefined = "key" in table ? table.key : undefined;
    const where = and(
      eq(table.organizationId, organizationId),
      isNull(table.deleted),
      visible,
      opts.search
        ? key
          ? or(
              ilikeContains(name, opts.search),
              ilikeContains(key, opts.search)
            )
          : ilikeContains(name, opts.search)
        : undefined
    );
    const [rows, [{ n }]] = await Promise.all([
      (client as typeof db)
        .select({ id: table.id, name })
        .from(table)
        .where(where)
        .orderBy(asc(name), asc(table.id))
        .limit(opts.limit)
        .offset(opts.offset),
      (client as typeof db).select({ n: count() }).from(table).where(where),
    ]);
    return {
      rows: rows as { id: string; name: string }[],
      total: Number(n),
    };
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
