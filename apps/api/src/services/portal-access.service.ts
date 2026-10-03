/**
 * Loads a portal the caller may act on (#685), for the portal REST routes and
 * the portal SSE routes alike, so both apply one rule.
 *
 * Portals are per-user: the seeded MemberAccess grants read/write/delete on
 * `created_by_caller` portals, and owners/admins (`* *`) reach all of them.
 * Pinned results are how portal output is shared.
 *
 * - Missing, another org's, or unreadable: 404 `PORTAL_NOT_FOUND` (unreadable
 *   == absent, so an id reveals nothing).
 * - Readable but the requested verb isn't allowed: 403 (`PermissionSet.check`).
 *
 * One `loadSet` per call; the set is returned for any further checks.
 */

import { DbService } from "./db.service.js";
import {
  PermissionService,
  type PermissionContext,
} from "./permission.service.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import type { PermissionSet } from "./permission-set.js";
import type { PortalSelect } from "../db/schema/zod.js";

export type PortalVerb = "read" | "write" | "delete";

export class PortalAccessService {
  static async load(
    ctx: PermissionContext,
    portalId: string,
    verb: PortalVerb = "read"
  ): Promise<{ portal: PortalSelect; set: PermissionSet }> {
    const portal = await DbService.repository.portals.findById(portalId);
    if (!portal || portal.organizationId !== ctx.organizationId) {
      throw new ApiError(404, ApiCode.PORTAL_NOT_FOUND, "Portal not found");
    }
    const set = await PermissionService.loadSet(ctx);
    const object = PortalAccessService.object(portal);
    if (!set.can("resource.read", object)) {
      throw new ApiError(404, ApiCode.PORTAL_NOT_FOUND, "Portal not found");
    }
    if (verb !== "read") set.check(`resource.${verb}`, object);
    return { portal, set };
  }

  /** The permission object for a portal. */
  static object(portal: PortalSelect) {
    return {
      type: "portal" as const,
      id: portal.id,
      createdBy: portal.createdBy,
    };
  }
}
