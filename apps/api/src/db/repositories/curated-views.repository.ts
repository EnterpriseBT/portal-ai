/**
 * Repository for the `curated_views` table (#599).
 *
 * Curated views are the member data-read path — a per-entity slice
 * (row filter + column projection). Slice 1 keeps this minimal (base
 * CRUD + org/entity/key finders); the session-resolution + include
 * logic lands in later slices.
 */

import { and, asc, desc, eq, isNull, sql, Column, type SQL } from "drizzle-orm";

import { curatedViews, connectorEntities } from "../schema/index.js";
import { db } from "../client.js";
import {
  Repository,
  type DbClient,
  type ListOptions,
} from "./base.repository.js";
import type { CuratedViewSelect, CuratedViewInsert } from "../schema/zod.js";

/** A curated view row plus its connector entity's display identifiers (#646);
 *  `entity` is null when the entity is soft-deleted / unresolvable. */
export type CuratedViewWithEntity = CuratedViewSelect & {
  entity: { key: string; label: string } | null;
};

export class CuratedViewsRepository extends Repository<
  typeof curatedViews,
  CuratedViewSelect,
  CuratedViewInsert
> {
  constructor() {
    super(curatedViews);
  }

  /** Non-deleted curated views for an organization. */
  async findByOrganizationId(
    organizationId: string,
    opts: ListOptions = {},
    client: DbClient = db
  ): Promise<CuratedViewSelect[]> {
    return this.findMany(
      eq(curatedViews.organizationId, organizationId),
      opts,
      client
    );
  }

  /** Non-deleted curated views over a given connector entity. */
  async findByConnectorEntityId(
    connectorEntityId: string,
    opts: ListOptions = {},
    client: DbClient = db
  ): Promise<CuratedViewSelect[]> {
    return this.findMany(
      eq(curatedViews.connectorEntityId, connectorEntityId),
      opts,
      client
    );
  }

  /**
   * List curated views enriched with their connector entity's `key` + `label`
   * (#646) — a LEFT JOIN so a view whose entity was soft-deleted still lists,
   * with `entity: null`. Mirrors the base `findMany` order/limit semantics
   * (soft-delete guard, `orderBy` + the #433 id tiebreaker, limit/offset); the
   * caller's `count(where)` is unaffected (no join needed).
   */
  async findManyWithEntity(
    where: SQL | undefined,
    opts: ListOptions = {},
    client: DbClient = db
  ): Promise<CuratedViewWithEntity[]> {
    let query = (client as typeof db)
      .select({
        view: curatedViews,
        entityKey: connectorEntities.key,
        entityLabel: connectorEntities.label,
      })
      .from(curatedViews)
      .leftJoin(
        connectorEntities,
        and(
          eq(connectorEntities.id, curatedViews.connectorEntityId),
          isNull(connectorEntities.deleted)
        )
      )
      .where(and(isNull(curatedViews.deleted), where))
      .$dynamic();

    if (opts.orderBy) {
      const { column: orderCol, direction = "asc" } = opts.orderBy;
      const orderFn = direction === "desc" ? desc : asc;
      const clauses: (SQL | ReturnType<typeof asc>)[] = [];
      if (orderCol instanceof Column) {
        clauses.push(orderFn(orderCol));
      } else {
        clauses.push(
          direction === "desc"
            ? sql`${orderCol} DESC NULLS LAST`
            : sql`${orderCol} ASC NULLS LAST`
        );
      }
      // #433: unique trailing tiebreaker.
      if (orderCol !== curatedViews.id) clauses.push(orderFn(curatedViews.id));
      query = query.orderBy(...clauses);
    }
    if (opts.limit !== undefined) query = query.limit(opts.limit);
    if (opts.offset !== undefined) query = query.offset(opts.offset);

    const rows = await query;
    return rows.map((r) => ({
      ...(r.view as CuratedViewSelect),
      entity:
        r.entityKey != null && r.entityLabel != null
          ? { key: r.entityKey, label: r.entityLabel }
          : null,
    }));
  }

  /** Find a single view by its per-org-unique key (duplicate-key validation). */
  async findByKey(
    organizationId: string,
    key: string,
    client: DbClient = db
  ): Promise<CuratedViewSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(curatedViews.organizationId, organizationId),
          eq(curatedViews.key, key),
          isNull(curatedViews.deleted)
        )
      )
      .limit(1);
    return row as CuratedViewSelect | undefined;
  }
}

/** Singleton instance. */
export const curatedViewsRepo = new CuratedViewsRepository();
