/**
 * Repository for the `policy_attachments` table (#598).
 */

import { and, eq, inArray } from "drizzle-orm";
import type { PolicyPrincipalType } from "@portalai/core/models";
import { PolicyAttachmentModelFactory } from "@portalai/core/models";

import { policyAttachments } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type {
  PolicyAttachmentSelect,
  PolicyAttachmentInsert,
} from "../schema/zod.js";

/** A policy set-the-set diff result (for the policy.attach/detach audit). */
export interface AttachmentDiff {
  attached: string[];
  detached: string[];
}

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

  /** Soft-delete every live attachment of a policy (#622 delete cascade). */
  async softDeleteByPolicyId(
    policyId: string,
    deletedBy: string,
    client: DbClient = db
  ): Promise<number> {
    const rows = await (client as typeof db)
      .update(this.table)
      .set({ deleted: Date.now(), deletedBy })
      .where(and(eq(policyAttachments.policyId, policyId), this.notDeleted()))
      .returning();
    return rows.length;
  }

  /** Set the policies attached to a principal (role/group), set-the-set.
   *  Soft-deletes removed attachments, inserts added ones. Returns the diff. */
  async setPoliciesForPrincipal(
    organizationId: string,
    principalType: PolicyPrincipalType,
    principalId: string,
    policyIds: string[],
    actor: string,
    client: DbClient = db
  ): Promise<AttachmentDiff> {
    const current = await this.findByPrincipals(
      [{ principalType, principalId }],
      client
    );
    const currentSet = new Set(current.map((a) => a.policyId));
    const desired = new Set(policyIds);

    const toDetach = current.filter((a) => !desired.has(a.policyId));
    const toAttach = policyIds.filter((pid) => !currentSet.has(pid));

    if (toDetach.length > 0) {
      await this.softDeleteMany(
        toDetach.map((a) => a.id),
        actor,
        client
      );
    }
    if (toAttach.length > 0) {
      const rows = toAttach.map((policyId) =>
        new PolicyAttachmentModelFactory()
          .create(actor)
          .update({ organizationId, policyId, principalType, principalId })
          .parse()
      );
      await this.createMany(rows as never, client);
    }
    return { attached: toAttach, detached: toDetach.map((a) => a.policyId) };
  }

  /** Soft-delete every live attachment on a principal — the #622 delete cascade
   *  for a role or group (drops all its attached policies). */
  async softDeleteByPrincipal(
    principalType: PolicyPrincipalType,
    principalId: string,
    deletedBy: string,
    client: DbClient = db
  ): Promise<number> {
    const rows = await (client as typeof db)
      .update(this.table)
      .set({ deleted: Date.now(), deletedBy })
      .where(
        and(
          eq(policyAttachments.principalType, principalType),
          eq(policyAttachments.principalId, principalId),
          this.notDeleted()
        )
      )
      .returning();
    return rows.length;
  }
}

export const policyAttachmentsRepo = new PolicyAttachmentsRepository();
