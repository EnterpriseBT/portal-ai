/**
 * Repository for the `curated_view_field_mappings` join table (#599) — a
 * curated view's column projection.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";

import { curatedViewFieldMappings } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type {
  CuratedViewFieldMappingSelect,
  CuratedViewFieldMappingInsert,
} from "../schema/zod.js";

export class CuratedViewFieldMappingsRepository extends Repository<
  typeof curatedViewFieldMappings,
  CuratedViewFieldMappingSelect,
  CuratedViewFieldMappingInsert
> {
  constructor() {
    super(curatedViewFieldMappings);
  }

  /** The projection (non-deleted field-mapping rows) for a curated view. */
  async findByCuratedViewId(
    curatedViewId: string,
    client: DbClient = db
  ): Promise<CuratedViewFieldMappingSelect[]> {
    return this.findMany(
      eq(curatedViewFieldMappings.curatedViewId, curatedViewId),
      {},
      client
    );
  }

  /** Which of `curatedViewIds` have an explicit projection (#680): one batched
   *  read for a list page, rather than a projection fetch per view. */
  async findProjectedViewIds(
    curatedViewIds: string[],
    client: DbClient = db
  ): Promise<Set<string>> {
    if (curatedViewIds.length === 0) return new Set();
    const rows = await (client as typeof db)
      .selectDistinct({ id: curatedViewFieldMappings.curatedViewId })
      .from(curatedViewFieldMappings)
      .where(
        and(
          inArray(curatedViewFieldMappings.curatedViewId, curatedViewIds),
          isNull(curatedViewFieldMappings.deleted)
        )
      );
    return new Set(rows.map((r) => r.id));
  }
}

/** Singleton instance. */
export const curatedViewFieldMappingsRepo =
  new CuratedViewFieldMappingsRepository();
