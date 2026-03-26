/**
 * Repository for the `portal_messages` table.
 *
 * Messages are immutable — only create and read operations are supported.
 */

import { eq } from "drizzle-orm";

import { portalMessages } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type { PortalMessageSelect, PortalMessageInsert } from "../schema/zod.js";

export class PortalMessagesRepository extends Repository<
  typeof portalMessages,
  PortalMessageSelect,
  PortalMessageInsert
> {
  constructor() {
    super(portalMessages);
  }

  /** Return all messages for a portal, ordered by created ascending. */
  async findByPortal(
    portalId: string,
    client: DbClient = db
  ): Promise<PortalMessageSelect[]> {
    return this.findMany(
      eq(portalMessages.portalId, portalId),
      { orderBy: { column: this.cols.created, direction: "asc" } },
      client
    );
  }

  /** Hard-delete all messages for a portal. Returns the count deleted. */
  async deleteByPortal(
    portalId: string,
    client: DbClient = db
  ): Promise<number> {
    const result = await (client as typeof db)
      .delete(portalMessages)
      .where(eq(portalMessages.portalId, portalId))
      .returning();
    return result.length;
  }
}

/** Singleton instance. */
export const portalMessagesRepo = new PortalMessagesRepository();
