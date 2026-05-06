/**
 * Repository for the `organization_toolpacks` table.
 *
 * Each row is a custom toolpack registered by an organization. The
 * cached `tools` and `metadata` columns are populated by the
 * `ToolpackRegistrationService` at registration and on explicit
 * refresh.
 *
 * `findManyByIds` is used by `tools.service` at session-build time
 * to expand custom rows in `station_toolpacks` into actual
 * `WebhookTool` instances.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";

import { organizationToolpacks } from "../schema/index.js";
import type {
  OrganizationToolpackSelect,
  OrganizationToolpackInsert,
} from "../schema/zod.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";

export class OrganizationToolpacksRepository extends Repository<
  typeof organizationToolpacks,
  OrganizationToolpackSelect,
  OrganizationToolpackInsert
> {
  constructor() {
    super(organizationToolpacks);
  }

  /**
   * All live (non-soft-deleted) toolpack rows for an organization.
   */
  async findByOrganizationId(
    organizationId: string,
    client: DbClient = db
  ): Promise<OrganizationToolpackSelect[]> {
    return (await (client as typeof db)
      .select()
      .from(organizationToolpacks)
      .where(
        and(
          eq(organizationToolpacks.organizationId, organizationId),
          isNull(organizationToolpacks.deleted)
        )
      )) as OrganizationToolpackSelect[];
  }

  /**
   * Look up multiple toolpacks by id, optionally constrained to an org.
   * Soft-deleted rows are filtered out.
   */
  async findManyByIds(
    ids: string[],
    options: { organizationId?: string } = {},
    client: DbClient = db
  ): Promise<OrganizationToolpackSelect[]> {
    if (ids.length === 0) return [];
    const conditions = [
      inArray(organizationToolpacks.id, ids),
      isNull(organizationToolpacks.deleted),
    ];
    if (options.organizationId) {
      conditions.push(
        eq(organizationToolpacks.organizationId, options.organizationId)
      );
    }
    return (await (client as typeof db)
      .select()
      .from(organizationToolpacks)
      .where(and(...conditions))) as OrganizationToolpackSelect[];
  }

  /**
   * Look up a toolpack by id, optionally constrained to an org.
   * Soft-deleted rows are excluded.
   */
  async findByIdScoped(
    id: string,
    organizationId: string,
    client: DbClient = db
  ): Promise<OrganizationToolpackSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(organizationToolpacks)
      .where(
        and(
          eq(organizationToolpacks.id, id),
          eq(organizationToolpacks.organizationId, organizationId),
          isNull(organizationToolpacks.deleted)
        )
      )
      .limit(1);
    return row as OrganizationToolpackSelect | undefined;
  }
}

export const organizationToolpacksRepo = new OrganizationToolpacksRepository();
