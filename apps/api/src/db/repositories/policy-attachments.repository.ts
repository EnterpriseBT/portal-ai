/**
 * Repository for the `policy_attachments` table (#598).
 */

import { and, eq, inArray } from "drizzle-orm";
import type { PolicyPrincipalType } from "@portalai/core/models";

import { policyAttachments } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type {
  PolicyAttachmentSelect,
  PolicyAttachmentInsert,
} from "../schema/zod.js";

export class PolicyAttachmentsRepository extends Repository<
  typeof policyAttachments,
  PolicyAttachmentSelect,
  PolicyAttachmentInsert
> {
  constructor() {
    super(policyAttachments);
  }

  /** Live attachments for any of the given principals (e.g. a user + their
   *  roles) — the engine's effective-set gather. */
  async findByPrincipals(
    principals: { principalType: PolicyPrincipalType; principalId: string }[],
    client: DbClient = db
  ): Promise<PolicyAttachmentSelect[]> {
    if (principals.length === 0) return [];
    const results = await Promise.all(
      principals.map((p) =>
        this.findMany(
          and(
            eq(policyAttachments.principalType, p.principalType),
            eq(policyAttachments.principalId, p.principalId)
          ),
          {},
          client
        )
      )
    );
    return results.flat();
  }

  /** Live attachments naming a specific principal id (any type). */
  async findByPrincipalId(
    principalIds: string[],
    client: DbClient = db
  ): Promise<PolicyAttachmentSelect[]> {
    if (principalIds.length === 0) return [];
    return this.findMany(
      inArray(policyAttachments.principalId, principalIds),
      {},
      client
    );
  }
}

export const policyAttachmentsRepo = new PolicyAttachmentsRepository();
