/**
 * Loads a connector instance the caller may act on (#685), for every route
 * that works through an instance it doesn't own outright: REST endpoints,
 * layout plans, the Sheets/Excel OAuth and picker routes.
 *
 * Members may read and write the connector instances they created
 * (MemberAccess `created_by_caller`); owners/admins reach all of them. Before
 * #685 these routes checked only that the instance was in the caller's org, so
 * a member could add endpoints to, recommit, re-authorize (swapping in their
 * own OAuth account) or drive the stored credentials of another member's
 * instance.
 *
 * - Missing, deleted, another org's, or unreadable: 404
 *   `CONNECTOR_INSTANCE_NOT_FOUND` (unreadable == absent).
 * - Readable but the requested verb isn't allowed: 403.
 */

import { DbService } from "./db.service.js";
import {
  PermissionService,
  type PermissionContext,
} from "./permission.service.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import type { PermissionSet } from "./permission-set.js";
import type { ConnectorInstanceSelect } from "../db/schema/zod.js";
import type { OrgRole } from "@portalai/core/models";

export type ConnectorInstanceVerb = "read" | "write" | "delete";

export class ConnectorInstanceAccessService {
  static async load(
    ctx: PermissionContext,
    connectorInstanceId: string,
    verb: ConnectorInstanceVerb = "read",
    /** The 404 code the calling route has always returned for this case. */
    notFoundCode: ApiCode = ApiCode.CONNECTOR_INSTANCE_NOT_FOUND
  ): Promise<{ instance: ConnectorInstanceSelect; set: PermissionSet }> {
    const instance =
      await DbService.repository.connectorInstances.findById(
        connectorInstanceId
      );
    const set = await PermissionService.loadSet(ctx);
    const object = instance
      ? {
          type: "connector_instance" as const,
          id: instance.id,
          createdBy: instance.createdBy,
        }
      : null;
    if (
      !instance ||
      !object ||
      instance.deleted !== null ||
      instance.organizationId !== ctx.organizationId ||
      !set.can("resource.read", object)
    ) {
      throw new ApiError(404, notFoundCode, "Connector instance not found");
    }
    if (verb !== "read") set.check(`resource.${verb}`, object);
    return { instance, set };
  }

  /**
   * #710: creating a connector instance is an owned create
   * (`CREATE_RULES.connector_instance`), whichever flow creates it: the
   * generic route, a Sheets/Excel connect, or a file-upload commit. Throws
   * 403 `PERMISSION_DENIED` when the caller may not.
   */
  static async assertCanCreate(ctx: PermissionContext): Promise<void> {
    await PermissionService.check(ctx, "resource.write", {
      type: "connector_instance",
      createdBy: ctx.userId,
    });
  }

  /**
   * The same check for an OAuth callback, which has no JWT: the caller comes
   * from the signed state, so their roles are re-read here, at the write,
   * rather than trusted from when authorize ran. The membership is re-checked
   * too: the JWT middleware resolves it for every other request, and a member
   * removed since authorize could otherwise pass on a policy attached to their
   * user, which removal doesn't tombstone.
   */
  static async assertCanCreateFromState(
    userId: string,
    organizationId: string
  ): Promise<void> {
    const membership =
      await DbService.repository.organizationUsers.findByOrganizationAndUser(
        organizationId,
        userId
      );
    if (!membership) {
      throw new ApiError(
        403,
        ApiCode.MEMBERSHIP_NOT_FOUND,
        `User is not a member of organization ${organizationId}`
      );
    }
    const roles = (await DbService.repository.userRole.findEffectiveRoleNames(
      userId,
      organizationId
    )) as OrgRole[];
    await ConnectorInstanceAccessService.assertCanCreate({
      userId,
      organizationId,
      roles,
    });
  }
}
