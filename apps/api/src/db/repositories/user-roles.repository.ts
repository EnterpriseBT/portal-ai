/**
 * Repository for the `user_role` table (#620) — a user's role assignments per
 * org (the many-to-many replacing the single-enum). Powers `loadSet`'s
 * gather-across-all-roles and the members/current-org role derivation.
 */

import { and, eq, isNull, count } from "drizzle-orm";
import type { OrgRole } from "@portalai/core/models";

import { userRole, roles } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type { UserRoleSelect, UserRoleInsert } from "../schema/zod.js";

export class UserRolesRepository extends Repository<
  typeof userRole,
  UserRoleSelect,
  UserRoleInsert
> {
  constructor() {
    super(userRole);
  }

  /** Live `user_role` rows for a user in an org. */
  async findByUserOrg(
    userId: string,
    organizationId: string,
    client: DbClient = db
  ): Promise<UserRoleSelect[]> {
    return this.findMany(
      and(
        eq(userRole.userId, userId),
        eq(userRole.organizationId, organizationId)
      ),
      {},
      client
    );
  }

  /** A user's role **names** in an org (⋈ `roles`) — what the middleware puts on
   *  `ctx.roles` and the members/profile surfaces display. */
  async findRoleNames(
    userId: string,
    organizationId: string,
    client: DbClient = db
  ): Promise<string[]> {
    const rows = await (client as typeof db)
      .select({ name: roles.name })
      .from(userRole)
      .innerJoin(roles, eq(userRole.roleId, roles.id))
      .where(
        and(
          eq(userRole.userId, userId),
          eq(userRole.organizationId, organizationId),
          isNull(userRole.deleted),
          isNull(roles.deleted)
        )
      );
    return rows.map((r) => r.name);
  }

  /** Count of distinct users holding a role by name in an org (the last-owner
   *  guard: `countUsersWithRole(org, "owner")`). */
  async countUsersWithRole(
    organizationId: string,
    roleName: OrgRole,
    client: DbClient = db
  ): Promise<number> {
    const [row] = await (client as typeof db)
      .select({ n: count() })
      .from(userRole)
      .innerJoin(roles, eq(userRole.roleId, roles.id))
      .where(
        and(
          eq(userRole.organizationId, organizationId),
          eq(roles.name, roleName),
          isNull(userRole.deleted),
          isNull(roles.deleted)
        )
      );
    return row?.n ?? 0;
  }
}

export const userRolesRepo = new UserRolesRepository();
