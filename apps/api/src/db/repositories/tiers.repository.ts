/**
 * Repository for the `tiers` table.
 *
 * Extends the generic {@link Repository} with a slug lookup — the single
 * finder `TierService.resolveTier` needs.
 */

import { eq, and, isNotNull } from "drizzle-orm";
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

  /** Live tiers listed in the self-serve plan list (#176 D6). */
  async findSelectable(client: DbClient = db): Promise<TierSelect[]> {
    return (client as typeof db)
      .select()
      .from(this.table)
      .where(and(eq(tiers.selectable, true), this.notDeleted()))
      .orderBy(tiers.created);
  }

  /** `stripe_price_id → slug` for every live priced tier — the webhook's
   *  price→tier map (#176 D1). */
  async priceIndex(client: DbClient = db): Promise<Map<string, string>> {
    const rows = await (client as typeof db)
      .select({ slug: tiers.slug, stripePriceId: tiers.stripePriceId })
      .from(this.table)
      .where(and(isNotNull(tiers.stripePriceId), this.notDeleted()));
    return new Map(rows.map((r) => [r.stripePriceId as string, r.slug]));
  }
}

/** Singleton instance — import this in services. */
export const tiersRepo = new TiersRepository();
