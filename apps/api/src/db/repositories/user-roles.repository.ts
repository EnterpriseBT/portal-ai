/**
 * Repository for the `user_role` table (#620) — a user's role assignments per
 * org (the many-to-many replacing the single-enum). Powers `loadSet`'s
 * gather-across-all-roles and the members/current-org role derivation.
 */

import { and, eq, isNull, count } from "drizzle-orm";
import type { OrgRole } from "@portalai/core/models";
import { UserRoleModelFactory } from "@portalai/core/models";

import { userRole, roles, organizationUsers } from "../schema/index.js";
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

  /**
   * A user's **effective** role names in an org: `user_role` when present,
   * else a single-element fallback to the `organization_users` enum role.
   *
   * #620 slice-2 transition shim. Reads cut over to `user_role` (slice 2)
   * before writes do (slice 3), so a membership created between the 0104
   * backfill and the write-cutover — a new invite-accept, or a test fixture
   * that inserts `organization_users` directly — has no `user_role` row yet.
   * The enum fallback keeps such a member's authorization identical to
   * pre-#620 (exactly one role = their enum), which is the single-role parity
   * guarantee. Remove this method (callers revert to `findRoleNames`) once the
   * enum is retired — see the #620 follow-up. Not used by list/batch surfaces,
   * which fall back per-row against the membership they already hold.
   */
  async findEffectiveRoleNames(
    userId: string,
    organizationId: string,
    client: DbClient = db
  ): Promise<string[]> {
    const names = await this.findRoleNames(userId, organizationId, client);
    if (names.length > 0) return names;
    const [membership] = await (client as typeof db)
      .select({ role: organizationUsers.role })
      .from(organizationUsers)
      .where(
        and(
          eq(organizationUsers.userId, userId),
          eq(organizationUsers.organizationId, organizationId),
          isNull(organizationUsers.deleted)
        )
      );
    return membership?.role ? [membership.role] : [];
  }

  /** The system role id for a role name in an org (`sysrole:<org>:<name>`) —
   *  the deterministic id the seed/backfill assign. */
  private static roleId(organizationId: string, roleName: OrgRole): string {
    return `sysrole:${organizationId}:${roleName}`;
  }

  /** Assign a role to a user in an org (#620), idempotent: a no-op when the
   *  user already holds a **live** row for it. A fresh id (not the deterministic
   *  `sysur:` id) so a role removed then re-added does not collide on the PK. */
  async assign(
    userId: string,
    organizationId: string,
    roleName: OrgRole,
    actor: string,
    client: DbClient = db
  ): Promise<void> {
    const roleId = UserRolesRepository.roleId(organizationId, roleName);
    const existing = await this.findMany(
      and(
        eq(userRole.userId, userId),
        eq(userRole.organizationId, organizationId),
        eq(userRole.roleId, roleId)
      ),
      {},
      client
    );
    if (existing.length > 0) return;
    const model = new UserRoleModelFactory()
      .create(actor)
      .update({ userId, organizationId, roleId });
    await this.create(model.parse() as never, client);
  }

  /** Soft-delete a user's live assignment of a role by name (#620). No-op when
   *  they don't hold it. */
  async removeAssignment(
    userId: string,
    organizationId: string,
    roleName: OrgRole,
    actor: string,
    client: DbClient = db
  ): Promise<void> {
    const roleId = UserRolesRepository.roleId(organizationId, roleName);
    const [row] = await this.findMany(
      and(
        eq(userRole.userId, userId),
        eq(userRole.organizationId, organizationId),
        eq(userRole.roleId, roleId)
      ),
      {},
      client
    );
    if (row) await this.softDelete(row.id, actor, client);
  }

  /** Soft-delete every live role a user holds in an org (#620) — used when the
   *  membership itself is removed, so no orphaned assignments remain. */
  async removeAllForUser(
    userId: string,
    organizationId: string,
    actor: string,
    client: DbClient = db
  ): Promise<void> {
    const live = await this.findByUserOrg(userId, organizationId, client);
    for (const row of live) await this.softDelete(row.id, actor, client);
  }

  /** Ensure a user's `user_role` rows reflect their effective roles: if they
   *  hold no live rows (a membership predating the write cutover), materialize
   *  their `organization_users` enum role as a `user_role` row. Makes the
   *  set-roles diff + owner counts authoritative over `user_role` alone. */
  async materializeFromEnum(
    userId: string,
    organizationId: string,
    enumRole: OrgRole,
    actor: string,
    client: DbClient = db
  ): Promise<void> {
    const live = await this.findByUserOrg(userId, organizationId, client);
    if (live.length > 0) return;
    await this.assign(userId, organizationId, enumRole, actor, client);
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
