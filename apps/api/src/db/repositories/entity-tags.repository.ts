/**
 * Repository for the `entity_tags` table.
 *
 * Extends the generic {@link Repository} with org-scoped tag lookups.
 */

import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { entityTags } from "../schema/index.js";
import { db } from "../client.js";
import {
  Repository,
  type DbClient,
  type ListOptions,
} from "./base.repository.js";
import type { EntityTagSelect, EntityTagInsert } from "../schema/zod.js";

export class EntityTagsRepository extends Repository<
  typeof entityTags,
  EntityTagSelect,
  EntityTagInsert
> {
  constructor() {
    super(entityTags);
  }

  /**
   * #1071: lock the live tags among `ids` for the rest of `client`'s
   * transaction, in id order so two lockers never deadlock. `share` lets
   * assigns run side by side; a delete takes `update`, so it waits for them,
   * and an assign after it finds the tag gone. Deleted tags aren't returned.
   */
  async lockLive(
    ids: string[],
    mode: "share" | "update",
    client: DbClient
  ): Promise<EntityTagSelect[]> {
    if (ids.length === 0) return [];
    return (await (client as typeof db)
      .select()
      .from(entityTags)
      .where(and(inArray(entityTags.id, ids), isNull(entityTags.deleted)))
      .orderBy(asc(entityTags.id))
      .for(mode)) as EntityTagSelect[];
  }

  /** Return non-deleted tags for an organization. Supports full ListOptions for sorting/pagination. */
  async findByOrganizationId(
    organizationId: string,
    opts: ListOptions = {},
    client: DbClient = db
  ): Promise<EntityTagSelect[]> {
    return this.findMany(
      eq(entityTags.organizationId, organizationId),
      opts,
      client
    );
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
