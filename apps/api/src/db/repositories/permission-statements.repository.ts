/**
 * Repository for the `permission_statements` table (#598).
 */

import { eq, inArray } from "drizzle-orm";

import { permissionStatements } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type {
  PermissionStatementSelect,
  PermissionStatementInsert,
} from "../schema/zod.js";

export class PermissionStatementsRepository extends Repository<
  typeof permissionStatements,
  PermissionStatementSelect,
  PermissionStatementInsert
> {
  constructor() {
    super(permissionStatements);
  }

  /** All live statements belonging to any of the given policies (the engine's
   *  effective-set gather). */
  async findByPolicyIds(
    policyIds: string[],
    client: DbClient = db
  ): Promise<PermissionStatementSelect[]> {
    if (policyIds.length === 0) return [];
    return this.findMany(
      inArray(permissionStatements.policyId, policyIds),
      {},
      client
    );
  }

  /** All live statements for a single policy. */
  async findByPolicyId(
    policyId: string,
    client: DbClient = db
  ): Promise<PermissionStatementSelect[]> {
    return this.findMany(
      eq(permissionStatements.policyId, policyId),
      {},
      client
    );
  }

  /** Replace a policy's statement set (#622) — hard-delete the existing rows
   *  (config, not soft-deleted) and insert the new set. Empty `rows` clears
   *  them (used by policy delete). Call inside a transaction. */
  async replaceForPolicy(
    policyId: string,
    rows: PermissionStatementInsert[],
    client: DbClient = db
  ): Promise<void> {
    await (client as typeof db)
      .delete(this.table)
      .where(eq(permissionStatements.policyId, policyId));
    if (rows.length > 0) await this.createMany(rows, client);
  }
}

export const permissionStatementsRepo = new PermissionStatementsRepository();
