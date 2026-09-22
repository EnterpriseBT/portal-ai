/**
 * Repository for the `user_group` table (#622) — group membership backing the
 * `group` principal. `findGroupIdsByUser` is the `loadSet` gather; the
 * set-the-set membership writers land in #622 slice 5.
 */

import { and, eq, isNull } from "drizzle-orm";

import { userGroup } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type { UserGroupSelect, UserGroupInsert } from "../schema/zod.js";

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
}

export const userGroupsRepo = new UserGroupsRepository();
