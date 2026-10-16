/**
 * #640: a pin's data executes as its **definer**, not as the viewer and not
 * as the org. A shared pin therefore shows what the definer can see now, and
 * empties when the definer loses access.
 *
 * Revocation is checked live, never swept: before any execution the definer
 * must still be an active member of the pin's org. Their grants and views are
 * then resolved fresh by the per-user session (`resolveViewsForSession`), so
 * a narrowed view or a revoked grant shows on the next render. The scope is
 * always the pin's own `organizationId`, never the viewer's.
 */

import { inArray } from "drizzle-orm";

import { users } from "../db/schema/users.table.js";
import type { PortalResultSelect } from "../db/schema/zod.js";
import { DbService } from "./db.service.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";

type DefinerRow = Pick<
  PortalResultSelect,
  "id" | "organizationId" | "definerPrincipalType" | "definerPrincipalId"
>;

export interface PinDefinerDescription {
  definer: { id: string; displayName: string };
  viewerIsDefiner: boolean;
}

/**
 * The definer can no longer stand behind the pin's data (no active membership
 * in the pin's org). Callers map it to a response that depends on who asks:
 * the reason for a caller who manages the pin, a neutral message otherwise.
 */
export class DefinerAccessLostError extends Error {
  constructor(readonly portalResultId: string) {
    super(`Pin ${portalResultId}: definer has no access`);
    this.name = "DefinerAccessLostError";
  }
}

function displayNameOf(
  user: { name: string | null; email: string | null } | undefined,
  id: string
): string {
  return user?.name || user?.email || id;
}

export class PinDefinerService {
  /**
   * The user a pin's data executes as, provided they are still an active
   * member of the pin's org. Throws `DefinerAccessLostError` otherwise.
   */
  static async assertDefinerActive(
    row: DefinerRow
  ): Promise<{ userId: string }> {
    if (row.definerPrincipalType !== "user") {
      // Admitted by the schema for a later rebind; nothing writes it yet.
      throw new ApiError(
        500,
        ApiCode.PORTAL_RESULT_DEFINER_UNSUPPORTED,
        "Pin definer type is not supported"
      );
    }
    const membership =
      await DbService.repository.organizationUsers.findByOrganizationAndUser(
        row.organizationId,
        row.definerPrincipalId
      );
    if (!membership) throw new DefinerAccessLostError(row.id);
    return { userId: row.definerPrincipalId };
  }

  /** The definer as a pin reader sees it, plus whether that reader is them. */
  static async describe(
    row: DefinerRow,
    viewerId: string
  ): Promise<PinDefinerDescription> {
    const described = await PinDefinerService.describeMany([row], viewerId);
    return described.get(row.id)!;
  }

  /** `describe` for a page of pins, with one users query. */
  static async describeMany(
    rows: DefinerRow[],
    viewerId: string
  ): Promise<Map<string, PinDefinerDescription>> {
    const ids = [...new Set(rows.map((r) => r.definerPrincipalId))];
    const found = ids.length
      ? await DbService.repository.users.findMany(inArray(users.id, ids))
      : [];
    const byId = new Map(found.map((u) => [u.id, u]));
    return new Map(
      rows.map((r) => [
        r.id,
        {
          definer: {
            id: r.definerPrincipalId,
            displayName: displayNameOf(
              byId.get(r.definerPrincipalId),
              r.definerPrincipalId
            ),
          },
          viewerIsDefiner:
            r.definerPrincipalType === "user" &&
            r.definerPrincipalId === viewerId,
        },
      ])
    );
  }
}
