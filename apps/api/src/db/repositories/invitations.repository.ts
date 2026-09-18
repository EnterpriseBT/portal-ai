/**
 * Repository for the `invitations` table (#584).
 *
 * Adds the invitation-specific finders and the **atomic single-winner consume**
 * the accept path relies on. All reads are soft-delete aware via the base
 * repository. "Pending-active" everywhere means `status = 'pending' AND
 * expires_at > now` — an expired pending row is neither acceptable nor counted
 * toward the seat cap (lazy expiry).
 */

import { eq, and, gt, isNull, desc } from "drizzle-orm";
import { invitations } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type { InvitationSelect, InvitationInsert } from "../schema/zod.js";
import type { InvitationStatus } from "@portalai/core/models";

export class InvitationsRepository extends Repository<
  typeof invitations,
  InvitationSelect,
  InvitationInsert
> {
  constructor() {
    super(invitations);
  }

  /** Find a live invitation by its token hash (the accept lookup key). */
  async findByTokenHash(
    tokenHash: string,
    client: DbClient = db
  ): Promise<InvitationSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table)
      .where(and(eq(invitations.tokenHash, tokenHash), this.notDeleted()))
      .limit(1);
    return row;
  }

  /** The single live pending invitation for `(org, email)`, if any. */
  async findPendingByOrgEmail(
    organizationId: string,
    email: string,
    client: DbClient = db
  ): Promise<InvitationSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(invitations.organizationId, organizationId),
          eq(invitations.email, email),
          eq(invitations.status, "pending"),
          this.notDeleted()
        )
      )
      .limit(1);
    return row;
  }

  /** List an org's live invitations, newest first; optionally filtered by status. */
  async listByOrg(
    organizationId: string,
    opts: { status?: InvitationStatus } = {},
    client: DbClient = db
  ): Promise<InvitationSelect[]> {
    const conditions = [
      eq(invitations.organizationId, organizationId),
      this.notDeleted(),
    ];
    if (opts.status) conditions.push(eq(invitations.status, opts.status));
    return (client as typeof db)
      .select()
      .from(this.table)
      .where(and(...conditions))
      .orderBy(desc(invitations.created));
  }

  /** Count an org's pending-active invitations (the seat-cap reservation). */
  async countPendingActive(
    organizationId: string,
    now: number,
    client: DbClient = db
  ): Promise<number> {
    return this.count(
      and(
        eq(invitations.organizationId, organizationId),
        eq(invitations.status, "pending"),
        gt(invitations.expiresAt, now)
      ),
      client
    );
  }

  /** All live pending-active invitations for an email, across orgs — the
   *  first-login self-heal branch's input (#583/#584). */
  async findPendingActiveByEmail(
    email: string,
    now: number,
    client: DbClient = db
  ): Promise<InvitationSelect[]> {
    return (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(invitations.email, email),
          eq(invitations.status, "pending"),
          gt(invitations.expiresAt, now),
          this.notDeleted()
        )
      )
      .orderBy(desc(invitations.expiresAt));
  }

  /**
   * Atomically consume a pending-active invitation by token hash: flip it to
   * `accepted` **only if** still pending and unexpired. The guarded `UPDATE …
   * RETURNING` is the single-winner arbiter — two concurrent accepts of one
   * token yield exactly one non-undefined result. Returns undefined when the
   * invite is missing, already consumed/revoked, or expired.
   */
  async consumeByTokenHash(
    tokenHash: string,
    acceptedByUserId: string,
    now: number,
    client: DbClient = db
  ): Promise<InvitationSelect | undefined> {
    const [row] = await (client as typeof db)
      .update(this.table)
      .set({
        status: "accepted",
        acceptedByUserId,
        acceptedAt: now,
        updated: now,
        updatedBy: acceptedByUserId,
      })
      .where(
        and(
          eq(invitations.tokenHash, tokenHash),
          eq(invitations.status, "pending"),
          gt(invitations.expiresAt, now),
          isNull(invitations.deleted)
        )
      )
      .returning();
    return row as InvitationSelect | undefined;
  }
}

/** Singleton instance — import this in services. */
export const invitationsRepo = new InvitationsRepository();
