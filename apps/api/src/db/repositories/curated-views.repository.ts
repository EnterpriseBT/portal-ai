/**
 * Repository for the `curated_views` table (#599).
 *
 * Curated views are the member data-read path — a per-entity slice
 * (row filter + column projection). Slice 1 keeps this minimal (base
 * CRUD + org/entity/key finders); the session-resolution + include
 * logic lands in later slices.
 */

import { and, eq, isNull } from "drizzle-orm";

import { curatedViews } from "../schema/index.js";
import { db } from "../client.js";
import {
  Repository,
  type DbClient,
  type ListOptions,
} from "./base.repository.js";
import type { CuratedViewSelect, CuratedViewInsert } from "../schema/zod.js";

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
