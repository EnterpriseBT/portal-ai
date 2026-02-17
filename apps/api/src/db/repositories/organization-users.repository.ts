/**
 * Repository for the `organization_users` join table.
 *
 * Extends the generic {@link Repository} with queries for the
 * many-to-many relationship between organizations and users.
 */

import { eq, and } from "drizzle-orm";
import { organizationUsers } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type {
  OrganizationUserSelect,
  OrganizationUserInsert,
} from "../schema/zod.js";

export class OrganizationUsersRepository extends Repository<
  typeof organizationUsers,
  OrganizationUserSelect,
  OrganizationUserInsert
> {
  constructor() {
    super(organizationUsers);
  }

  /** List all membership rows for a given organization. */
  async findByOrganizationId(
    organizationId: string,
    client: DbClient = db
  ): Promise<OrganizationUserSelect[]> {
    return this.findMany(
      eq(organizationUsers.organizationId, organizationId),
      {},
      client
    );
  }

  /** List all membership rows for a given user. */
  async findByUserId(
    userId: string,
    client: DbClient = db
  ): Promise<OrganizationUserSelect[]> {
    return this.findMany(eq(organizationUsers.userId, userId), {}, client);
  }

  /** Check whether a specific user belongs to a specific organization. */
  async exists(
    organizationId: string,
    userId: string,
    client: DbClient = db
  ): Promise<boolean> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(organizationUsers.organizationId, organizationId),
          eq(organizationUsers.userId, userId),
          this.notDeleted()
        )
      )
      .limit(1);
    return !!row;
  }
}

/** Singleton instance. */
export const organizationUsersRepo = new OrganizationUsersRepository();
