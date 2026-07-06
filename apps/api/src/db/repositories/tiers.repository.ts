/**
 * Repository for the `tiers` table.
 *
 * Extends the generic {@link Repository} with a slug lookup — the single
 * finder `TierService.resolveTier` needs.
 */

import { eq, and } from "drizzle-orm";
import { tiers } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type { TierSelect, TierInsert } from "../schema/zod.js";

export class TiersRepository extends Repository<
  typeof tiers,
  TierSelect,
  TierInsert
> {
  constructor() {
    super(tiers);
  }

  /** Find a tier by its unique slug (soft-delete aware). */
  async findBySlug(
    slug: string,
    client: DbClient = db
  ): Promise<TierSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table)
      .where(and(eq(tiers.slug, slug), this.notDeleted()))
      .limit(1);
    return row;
  }
}

/** Singleton instance — import this in services. */
export const tiersRepo = new TiersRepository();
