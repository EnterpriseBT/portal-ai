/**
 * Repository for the `permission_grants` table (#621) — ad-hoc, principal-bearing
 * object grants. Two hot reads: gather-by-principal (the resolver, `loadSet`)
 * and list-by-resource (the share list + lifecycle cascade). Grants
 * **hard-delete** — authz rows carry no soft-delete tombstones.
 */

import { and, eq } from "drizzle-orm";
import type {
  PolicyPrincipalType,
  PermissionResourceType,
} from "@portalai/core/models";

import { permissionGrants } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type {
  PermissionGrantSelect,
  PermissionGrantInsert,
} from "../schema/zod.js";

export class PermissionGrantsRepository extends Repository<
  typeof permissionGrants,
  PermissionGrantSelect,
  PermissionGrantInsert
> {
  constructor() {
    super(permissionGrants);
  }

  /** Live grants for any of the given principals (a user + their roles) in an
   *  org — the engine's grant gather, unioned with policy statements. */
  async findByPrincipals(
    principals: { principalType: PolicyPrincipalType; principalId: string }[],
    organizationId: string,
    client: DbClient = db
  ): Promise<PermissionGrantSelect[]> {
    if (principals.length === 0) return [];
    const results = await Promise.all(
      principals.map((p) =>
        this.findMany(
          and(
            eq(permissionGrants.organizationId, organizationId),
            eq(permissionGrants.principalType, p.principalType),
            eq(permissionGrants.principalId, p.principalId)
          ),
          {},
          client
        )
      )
    );
    return results.flat();
  }

  /** Every grant on a specific object — the share list + the hard-delete
   *  cascade. */
  async findByResource(
    organizationId: string,
    resourceType: PermissionResourceType,
    resourceId: string,
    client: DbClient = db
  ): Promise<PermissionGrantSelect[]> {
    return this.findMany(
      and(
        eq(permissionGrants.organizationId, organizationId),
        eq(permissionGrants.resourceType, resourceType),
        eq(permissionGrants.resourceId, resourceId)
      ),
      {},
      client
    );
  }

  /** Hard-delete every grant on an object (object hardDelete cascade). */
  async hardDeleteByResource(
    organizationId: string,
    resourceType: PermissionResourceType,
    resourceId: string,
    client: DbClient = db
  ): Promise<number> {
    const rows = await this.findByResource(
      organizationId,
      resourceType,
      resourceId,
      client
    );
    return this.hardDeleteMany(
      rows.map((r) => r.id),
      client
    );
  }

  /** Hard-delete every grant naming a principal (member-removal revoke). */
  async hardDeleteByPrincipal(
    organizationId: string,
    principalType: PolicyPrincipalType,
    principalId: string,
    client: DbClient = db
  ): Promise<number> {
    const rows = await this.findMany(
      and(
        eq(permissionGrants.organizationId, organizationId),
        eq(permissionGrants.principalType, principalType),
        eq(permissionGrants.principalId, principalId)
      ),
      {},
      client
    );
    return this.hardDeleteMany(
      rows.map((r) => r.id),
      client
    );
  }
}

export const permissionGrantsRepo = new PermissionGrantsRepository();
