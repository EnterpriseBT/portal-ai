/**
 * Repository for the `groups` table (#622) — RBAC groups, a policy-attachment
 * principal. Base `Repository` provides find/create/update/softDelete (all
 * soft-delete-aware); this adds the org-scoped finders.
 */

import { and, eq, isNull } from "drizzle-orm";

import { groups } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type { GroupSelect, GroupInsert } from "../schema/zod.js";

export class GroupsRepository extends Repository<
  typeof groups,
  GroupSelect,
  GroupInsert
> {
  constructor() {
    super(groups);
  }

  /** Every live group in an org (the Access-tab list). */
  async findByOrganizationId(
    organizationId: string,
    client: DbClient = db
  ): Promise<GroupSelect[]> {
    return this.findMany(eq(groups.organizationId, organizationId), {}, client);
  }

  /** A group by exact name in one org (the per-org name-uniqueness check). */
  async findByName(
    organizationId: string,
    name: string,
    client: DbClient = db
  ): Promise<GroupSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(groups.organizationId, organizationId),
          eq(groups.name, name),
          isNull(groups.deleted)
        )
      )
      .limit(1);
    return row as GroupSelect | undefined;
  }
}

export const groupsRepo = new GroupsRepository();
