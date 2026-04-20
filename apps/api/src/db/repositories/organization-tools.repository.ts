/**
 * Repository for the `organization_tools` table.
 *
 * Extends the generic {@link Repository} with org-scoped lookups
 * and unique name validation.
 */

import { and, eq, isNull } from "drizzle-orm";

import { organizationTools } from "../schema/index.js";
import { db } from "../client.js";
import {
  Repository,
  type DbClient,
  type ListOptions,
} from "./base.repository.js";
import type {
  OrganizationToolSelect,
  OrganizationToolInsert,
} from "../schema/zod.js";

export class OrganizationToolsRepository extends Repository<
  typeof organizationTools,
  OrganizationToolSelect,
  OrganizationToolInsert
> {
  constructor() {
    super(organizationTools);
  }

  /** Return non-deleted tools for an organization. */
  async findByOrganizationId(
    organizationId: string,
    opts: ListOptions = {},
    client: DbClient = db
  ): Promise<OrganizationToolSelect[]> {
    return this.findMany(
      eq(organizationTools.organizationId, organizationId),
      opts,
      client
    );
  }

  /** Find a single tool by exact name within an organization (used for duplicate detection). */
  async findByName(
    organizationId: string,
    name: string,
    client: DbClient = db
  ): Promise<OrganizationToolSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(organizationTools.organizationId, organizationId),
          eq(organizationTools.name, name),
          isNull(organizationTools.deleted)
        )
      )
      .limit(1);
    return row as OrganizationToolSelect | undefined;
  }
}

/** Singleton instance. */
export const organizationToolsRepo = new OrganizationToolsRepository();
