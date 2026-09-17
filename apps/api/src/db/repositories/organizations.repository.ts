/**
 * Repository for the `organizations` table.
 *
 * Extends the generic {@link Repository} with organization-specific queries.
 */

import { eq, and } from "drizzle-orm";
import { organizations } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type { OrganizationSelect, OrganizationInsert } from "../schema/zod.js";

export class OrganizationsRepository extends Repository<
  typeof organizations,
  OrganizationSelect,
  OrganizationInsert
> {
  constructor() {
    super(organizations);
  }

  /** Find an organization by name (exact match). */
  async findByName(
    name: string,
    client: DbClient = db
  ): Promise<OrganizationSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table)
      .where(and(eq(organizations.name, name), this.notDeleted()))
      .limit(1);
    return row;
  }

  /** Find the org owning a Stripe customer (#176 webhook match; the column
   *  is UNIQUE where not null). */
  async findByStripeCustomerId(
    stripeCustomerId: string,
    client: DbClient = db
  ): Promise<OrganizationSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(organizations.stripeCustomerId, stripeCustomerId),
          this.notDeleted()
        )
      )
      .limit(1);
    return row;
  }

  /** Find the org tracking an AWS Marketplace entitlement (#568; the column
   *  is UNIQUE where not null). */
  async findByMarketplaceEntitlementId(
    marketplaceEntitlementId: string,
    client: DbClient = db
  ): Promise<OrganizationSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(organizations.marketplaceEntitlementId, marketplaceEntitlementId),
          this.notDeleted()
        )
      )
      .limit(1);
    return row;
  }

  /**
   * The sole non-deleted organization — the single-tenant residency install's
   * one org (#568), which a marketplace entitlement grants to. Undefined when
   * there is not exactly one (zero, or ambiguous with more than one).
   */
  async findSole(
    client: DbClient = db
  ): Promise<OrganizationSelect | undefined> {
    const rows = await (client as typeof db)
      .select()
      .from(this.table)
      .where(this.notDeleted())
      .limit(2);
    return rows.length === 1 ? rows[0] : undefined;
  }
}

/** Singleton instance. */
export const organizationsRepo = new OrganizationsRepository();
