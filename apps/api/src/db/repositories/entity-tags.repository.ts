/**
 * Repository for the `entity_tags` table.
 *
 * Extends the generic {@link Repository} with org-scoped tag lookups.
 */

import { and, eq, isNull } from "drizzle-orm";

import { entityTags } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient, type ListOptions } from "./base.repository.js";
import type { EntityTagSelect, EntityTagInsert } from "../schema/zod.js";

export class EntityTagsRepository extends Repository<
  typeof entityTags,
  EntityTagSelect,
  EntityTagInsert
> {
  constructor() {
    super(entityTags);
  }

  /** Return non-deleted tags for an organization. Supports full ListOptions for sorting/pagination. */
  async findByOrganizationId(
    organizationId: string,
    opts: ListOptions = {},
    client: DbClient = db
  ): Promise<EntityTagSelect[]> {
    return this.findMany(eq(entityTags.organizationId, organizationId), opts, client);
  }

  /** Find a single tag by exact name within an organization (used for duplicate detection). */
  async findByName(
    organizationId: string,
    name: string,
    client: DbClient = db
  ): Promise<EntityTagSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(entityTags.organizationId, organizationId),
          eq(entityTags.name, name),
          isNull(entityTags.deleted)
        )
      )
      .limit(1);
    return row as EntityTagSelect | undefined;
  }
}

/** Singleton instance. */
export const entityTagsRepo = new EntityTagsRepository();
