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
}

/** Singleton instance. */
export const organizationsRepo = new OrganizationsRepository();
