/**
 * Repository for the `curated_view_field_mappings` join table (#599) — a
 * curated view's column projection.
 */

import { eq } from "drizzle-orm";

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
}

/** Singleton instance. */
export const curatedViewFieldMappingsRepo =
  new CuratedViewFieldMappingsRepository();
