/**
 * Repository for the `permission_policies` table (#598).
 */

import { and, eq, inArray, isNull } from "drizzle-orm";

import { permissionPolicies } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type { PolicySelect, PolicyInsert } from "../schema/zod.js";

export class PermissionPoliciesRepository extends Repository<
  typeof permissionPolicies,
  PolicySelect,
  PolicyInsert
> {
  constructor() {
    super(permissionPolicies);
  }

  /** Find an org's policy by exact name (used by the seed's idempotent upsert). */
  async findByName(
    organizationId: string,
    name: string,
    client: DbClient = db
  ): Promise<PolicySelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(permissionPolicies.organizationId, organizationId),
          eq(permissionPolicies.name, name),
          isNull(permissionPolicies.deleted)
        )
      )
      .limit(1);
    return row as PolicySelect | undefined;
  }

  /** The live policies among `ids` that belong to `organizationId` (#681):
   *  resolves a group/role payload's policy ids before anything is attached. */
  async findByIdsInOrg(
    organizationId: string,
    ids: string[],
    client: DbClient = db
  ): Promise<PolicySelect[]> {
    if (ids.length === 0) return [];
    return this.findMany(
      and(
        eq(permissionPolicies.organizationId, organizationId),
        inArray(permissionPolicies.id, ids)
      ),
      {},
      client
    );
  }

  /** Every live policy in an org (the Access-tab list, #622). */
  async findByOrganizationId(
    organizationId: string,
    client: DbClient = db
  ): Promise<PolicySelect[]> {
    return this.findMany(
      eq(permissionPolicies.organizationId, organizationId),
      {},
      client
    );
  }
}

export const permissionPoliciesRepo = new PermissionPoliciesRepository();
