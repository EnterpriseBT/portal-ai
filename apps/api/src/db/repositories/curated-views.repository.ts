/**
 * Repository for the `curated_views` table (#599).
 *
 * Curated views are the member data-read path — a per-entity slice
 * (row filter + column projection). Slice 1 keeps this minimal (base
 * CRUD + org/entity/key finders); the session-resolution + include
 * logic lands in later slices.
 */

import { and, eq, inArray, isNull, type SQL } from "drizzle-orm";

import type { CuratedViewListItem } from "@portalai/core/contracts";

import { curatedViews, connectorEntities } from "../schema/index.js";
import { db } from "../client.js";
import {
  Repository,
  type DbClient,
  type ListOptions,
} from "./base.repository.js";
import type { CuratedViewSelect, CuratedViewInsert } from "../schema/zod.js";

/** A curated view row plus its connector entity's display identifiers (#646).
 *  The `entity` sub-shape is single-sourced from the wire contract; `entity` is
 *  null when the entity is soft-deleted / unresolvable. */
export type CuratedViewWithEntity = CuratedViewSelect & {
  entity: CuratedViewListItem["entity"];
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
   * (#646). Delegates the page to the base `findMany` — so it inherits every
   * list semantic (soft-delete guard, `orderBy` + the #433 id tiebreaker,
   * keyset/limit/offset, org scope) with no duplicated clause-building — then
   * batch-loads the entities in one lean query. A view whose entity was
   * soft-deleted still lists, with `entity: null`; `count(where)` is unaffected.
   */
  async findManyWithEntity(
    where: SQL | undefined,
    opts: ListOptions = {},
    client: DbClient = db
  ): Promise<CuratedViewWithEntity[]> {
    const rows = await this.findMany(where, opts, client);
    const entityIds = [...new Set(rows.map((r) => r.connectorEntityId))];
    const entities = entityIds.length
      ? await (client as typeof db)
          .select({
            id: connectorEntities.id,
            key: connectorEntities.key,
            label: connectorEntities.label,
          })
          .from(connectorEntities)
          .where(
            and(
              inArray(connectorEntities.id, entityIds),
              isNull(connectorEntities.deleted)
            )
          )
      : [];
    const byId = new Map(
      entities.map((e) => [e.id, { key: e.key, label: e.label }])
    );
    return rows.map((r) => ({
      ...r,
      entity: byId.get(r.connectorEntityId) ?? null,
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

  /**
   * #674: the `id` + `createdBy` of the live curated views among `ids` in the org.
   * The ownership a permission check needs, without reading the full row.
   */
  async findOwnersByIds(
    ids: string[],
    organizationId: string,
    client: DbClient = db
  ): Promise<{ id: string; createdBy: string }[]> {
    if (ids.length === 0) return [];
    return (client as typeof db)
      .select({ id: curatedViews.id, createdBy: curatedViews.createdBy })
      .from(curatedViews)
      .where(
        and(
          inArray(curatedViews.id, ids),
          eq(curatedViews.organizationId, organizationId),
          isNull(curatedViews.deleted)
        )
      );
  }
}

/** Singleton instance. */
export const curatedViewsRepo = new CuratedViewsRepository();
