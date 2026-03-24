/**
 * Repository for the `entity_groups` table.
 *
 * Extends the generic {@link Repository} with org-scoped group lookups
 * and a join through `entityGroupMembers` to find groups by entity.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { entityGroups, entityGroupMembers } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient, type ListOptions } from "./base.repository.js";
import type { EntityGroupSelect, EntityGroupInsert } from "../schema/zod.js";

export interface EntityGroupListOptions extends ListOptions {
  include?: string[];
}

export class EntityGroupsRepository extends Repository<
  typeof entityGroups,
  EntityGroupSelect,
  EntityGroupInsert
> {
  constructor() {
    super(entityGroups);
  }

  /**
   * Find entity groups matching `where`, with optional eager-loaded relations.
   * Pass `include` with `"memberCount"` to attach a member count to each group.
   */
  override async findMany(
    where?: SQL,
    opts: EntityGroupListOptions = {},
    client: DbClient = db
  ): Promise<EntityGroupSelect[]> {
    const groups = await super.findMany(where, opts, client);
    const { include } = opts;
    if (groups.length === 0 || !include || include.length === 0) return groups;

    const includes = new Set(include);

    if (includes.has("memberCount")) {
      const groupIds = groups.map((g) => g.id);
      const counts = await (client as typeof db)
        .select({
          entityGroupId: entityGroupMembers.entityGroupId,
          count: sql<number>`count(*)::int`.as("count"),
        })
        .from(entityGroupMembers)
        .where(
          and(
            inArray(entityGroupMembers.entityGroupId, groupIds),
            isNull(entityGroupMembers.deleted)
          )
        )
        .groupBy(entityGroupMembers.entityGroupId);

      const countMap = new Map(counts.map((c) => [c.entityGroupId, c.count]));

      return groups.map((g) => ({
        ...g,
        memberCount: countMap.get(g.id) ?? 0,
      })) as EntityGroupSelect[];
    }

    return groups;
  }

  /** Return non-deleted groups for an organization. Supports full ListOptions for sorting/pagination. */
  async findByOrganizationId(
    organizationId: string,
    opts: ListOptions = {},
    client: DbClient = db
  ): Promise<EntityGroupSelect[]> {
    return this.findMany(eq(entityGroups.organizationId, organizationId), opts, client);
  }

  /** Find a single group by exact name within an organization (used for duplicate name validation). */
  async findByName(
    organizationId: string,
    name: string,
    client: DbClient = db
  ): Promise<EntityGroupSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(entityGroups.organizationId, organizationId),
          eq(entityGroups.name, name),
          isNull(entityGroups.deleted)
        )
      )
      .limit(1);
    return row as EntityGroupSelect | undefined;
  }

  /**
   * Return all groups that a given connector entity belongs to
   * (join through `entityGroupMembers`).
   */
  async findByConnectorEntityId(
    connectorEntityId: string,
    client: DbClient = db
  ): Promise<EntityGroupSelect[]> {
    // First, find all non-deleted member rows for this entity
    const members = await (client as typeof db)
      .select()
      .from(entityGroupMembers)
      .where(
        and(
          eq(entityGroupMembers.connectorEntityId, connectorEntityId),
          isNull(entityGroupMembers.deleted)
        )
      );

    if (members.length === 0) return [];

    const groupIds = [...new Set(members.map((m) => m.entityGroupId))];
    const groups = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          inArray(entityGroups.id, groupIds),
          isNull(entityGroups.deleted)
        )
      );

    return groups as EntityGroupSelect[];
  }
}

/** Singleton instance. */
export const entityGroupsRepo = new EntityGroupsRepository();
