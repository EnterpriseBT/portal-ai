/**
 * Repository for the `roles` table (#598).
 */

import { and, eq, isNull } from "drizzle-orm";

import { roles } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type { RoleSelect, RoleInsert } from "../schema/zod.js";

export class RolesRepository extends Repository<
  typeof roles,
  RoleSelect,
  RoleInsert
> {
  constructor() {
    super(roles);
  }

  /** Find an org's role by exact name — maps the `organization_users.role`
   *  enum to its seeded role row (#598), and the seed's idempotent upsert. */
  async findByName(
    organizationId: string,
    name: string,
    client: DbClient = db
  ): Promise<RoleSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(roles.organizationId, organizationId),
          eq(roles.name, name),
          isNull(roles.deleted)
        )
      )
      .limit(1);
    return row as RoleSelect | undefined;
  }
}

export const rolesRepo = new RolesRepository();
