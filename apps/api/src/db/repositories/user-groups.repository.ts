/**
 * Repository for the `user_group` table (#622) — group membership backing the
 * `group` principal. `findGroupIdsByUser` is the `loadSet` gather; the
 * set-the-set membership writers land in #622 slice 5.
 */

import { and, eq, isNull } from "drizzle-orm";
import { UserGroupModelFactory } from "@portalai/core/models";

import { userGroup, groups } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type { UserGroupSelect, UserGroupInsert } from "../schema/zod.js";

/** A membership set-the-set diff result (for the group.member.* audit). */
export interface MembershipDiff {
  added: string[];
  removed: string[];
}

export class UserGroupsRepository extends Repository<
  typeof userGroup,
  UserGroupSelect,
  UserGroupInsert
> {
  constructor() {
    super(userGroup);
  }

  /** The live group ids a user belongs to in an org — the `loadSet` gather. */
  async findGroupIdsByUser(
    userId: string,
    organizationId: string,
    client: DbClient = db
  ): Promise<string[]> {
    const rows = await (client as typeof db)
      .select({ groupId: userGroup.groupId })
      .from(this.table)
      .where(
        and(
          eq(userGroup.userId, userId),
          eq(userGroup.organizationId, organizationId),
          isNull(userGroup.deleted)
        )
      );
    return rows.map((r) => r.groupId);
  }

  /** The live group **names** a user belongs to in an org (⋈ `groups`) — the
   *  caller's groups shown on their profile (#622). */
  async findGroupNamesByUser(
    userId: string,
    organizationId: string,
    client: DbClient = db
  ): Promise<string[]> {
    const rows = await (client as typeof db)
      .select({ name: groups.name })
      .from(this.table)
      .innerJoin(groups, eq(groups.id, userGroup.groupId))
      .where(
        and(
          eq(userGroup.userId, userId),
          eq(userGroup.organizationId, organizationId),
          isNull(userGroup.deleted),
          isNull(groups.deleted)
        )
      );
    return rows.map((r) => r.name);
  }

  /** The live member user ids of a group. */
  async findUserIdsByGroup(
    groupId: string,
    client: DbClient = db
  ): Promise<string[]> {
    const rows = await (client as typeof db)
      .select({ userId: userGroup.userId })
      .from(this.table)
      .where(and(eq(userGroup.groupId, groupId), isNull(userGroup.deleted)));
    return rows.map((r) => r.userId);
  }

  /** Live member count of a group. */
  async countMembers(groupId: string, client: DbClient = db): Promise<number> {
    return (await this.findUserIdsByGroup(groupId, client)).length;
  }

  /** Set a group's membership (group-centric). Soft-deletes removed rows,
   *  inserts added ones (the partial-unique index makes a re-add a no-op). */
  async setGroupMembers(
    organizationId: string,
    groupId: string,
    userIds: string[],
    actor: string,
    client: DbClient = db
  ): Promise<MembershipDiff> {
    const current = await this.findMany(
      and(eq(userGroup.groupId, groupId), isNull(userGroup.deleted)),
      {},
      client
    );
    const currentUserIds = new Set(current.map((r) => r.userId));
    const desired = new Set(userIds);

    const toRemove = current.filter((r) => !desired.has(r.userId));
    const toAdd = userIds.filter((uid) => !currentUserIds.has(uid));

    for (const row of toRemove) await this.softDelete(row.id, actor, client);
    if (toAdd.length > 0) {
      const rows = toAdd.map((userId) =>
        new UserGroupModelFactory()
          .create(actor)
          .update({ organizationId, userId, groupId })
          .parse()
      );
      await this.createMany(rows as never, client);
    }
    return { added: toAdd, removed: toRemove.map((r) => r.userId) };
  }

  /** Set a user's groups (member-centric). Mirror of {@link setGroupMembers}. */
  async setUserGroups(
    organizationId: string,
    userId: string,
    groupIds: string[],
    actor: string,
    client: DbClient = db
  ): Promise<MembershipDiff> {
    const current = await this.findMany(
      and(
        eq(userGroup.userId, userId),
        eq(userGroup.organizationId, organizationId),
        isNull(userGroup.deleted)
      ),
      {},
      client
    );
    const currentGroupIds = new Set(current.map((r) => r.groupId));
    const desired = new Set(groupIds);

    const toRemove = current.filter((r) => !desired.has(r.groupId));
    const toAdd = groupIds.filter((gid) => !currentGroupIds.has(gid));

    for (const row of toRemove) await this.softDelete(row.id, actor, client);
    if (toAdd.length > 0) {
      const rows = toAdd.map((groupId) =>
        new UserGroupModelFactory()
          .create(actor)
          .update({ organizationId, userId, groupId })
          .parse()
      );
      await this.createMany(rows as never, client);
    }
    return { added: toAdd, removed: toRemove.map((r) => r.groupId) };
  }

  /** Soft-delete every live membership of a group — the #622 delete cascade. */
  async softDeleteByGroup(
    groupId: string,
    actor: string,
    client: DbClient = db
  ): Promise<number> {
    const rows = await (client as typeof db)
      .update(userGroup)
      .set({ deleted: Date.now(), deletedBy: actor })
      .where(and(eq(userGroup.groupId, groupId), isNull(userGroup.deleted)))
      .returning();
    return rows.length;
  }
}

export const userGroupsRepo = new UserGroupsRepository();
