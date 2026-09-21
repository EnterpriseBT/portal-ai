/**
 * RBAC object grants + sharing (#621). Authors ad-hoc `permission_grants` for
 * station/pin sharing, guarded by the engine: the caller must hold
 * `resource.share` on the object, cannot grant beyond their own allow-set (the
 * permissions boundary), and the grantee must be an active org member. A share
 * is one or two grant rows (`read` → `{read}`, `read-write` → `{read, write}`),
 * grouped back into one {@link GrantView} per principal. Every share/revoke is
 * audited (`grant.create` / `grant.revoke`, post-commit, fail-open).
 */

import { PermissionGrantModelFactory } from "@portalai/core/models";
import type {
  ShareGrantRequest,
  ShareGrantee,
  GrantAccess,
  GrantView,
  ShareResourceType,
} from "@portalai/core/contracts";

import { DbService } from "./db.service.js";
import {
  PermissionService,
  type PermissionContext,
} from "./permission.service.js";
import { AuditService } from "./audit.service.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import type { PermissionGrantSelect } from "../db/schema/zod.js";

export interface GrantAuditContext {
  sourceIp: string | null;
  userAgent: string | null;
}

interface ResolvedPrincipal {
  principalType: "user" | "role";
  principalId: string;
  label: string;
}

const accessVerbs = (access: GrantAccess): ("read" | "write")[] =>
  access === "read" ? ["read"] : ["read", "write"];

const deriveAccess = (rows: PermissionGrantSelect[]): GrantAccess =>
  rows.some((r) => r.verb === "write") ? "read-write" : "read";

export class GrantService {
  /** Resolve the shareable object + its `createdBy` (for the ownership
   *  condition), 404 if absent or cross-org. */
  private static async resolveObject(
    organizationId: string,
    resourceType: ShareResourceType,
    resourceId: string
  ): Promise<{ createdBy: string }> {
    const row =
      resourceType === "station"
        ? await DbService.repository.stations.findById(resourceId)
        : await DbService.repository.portalResults.findById(resourceId);
    if (!row || row.organizationId !== organizationId) {
      throw new ApiError(
        404,
        resourceType === "station"
          ? ApiCode.STATION_NOT_FOUND
          : ApiCode.PORTAL_RESULT_NOT_FOUND,
        `${resourceType} not found`
      );
    }
    return { createdBy: row.createdBy };
  }

  /** Grantee → engine principal. `team` = the org's base member role; a user
   *  grantee must be an active member (else `RBAC_GRANTEE_NOT_MEMBER`). */
  private static async resolvePrincipal(
    organizationId: string,
    grantee: ShareGrantee
  ): Promise<ResolvedPrincipal> {
    if (grantee.type === "team") {
      return {
        principalType: "role",
        principalId: `sysrole:${organizationId}:member`,
        label: "The team",
      };
    }
    const membership =
      await DbService.repository.organizationUsers.findByOrganizationAndUser(
        organizationId,
        grantee.userId
      );
    if (!membership) {
      throw new ApiError(
        400,
        ApiCode.RBAC_GRANTEE_NOT_MEMBER,
        "The grantee must be an active member of this organization"
      );
    }
    const user = await DbService.repository.users.findById(grantee.userId);
    return {
      principalType: "user",
      principalId: grantee.userId,
      label: user?.email ?? user?.name ?? grantee.userId,
    };
  }

  /** Share an object with a principal at an access level (set-the-share:
   *  replaces any existing share for that principal on the object). */
  static async share(
    caller: PermissionContext,
    req: ShareGrantRequest,
    auditCtx: GrantAuditContext
  ): Promise<GrantView> {
    const { resourceType, resourceId, grantee, access } = req;
    const object = await GrantService.resolveObject(
      caller.organizationId,
      resourceType,
      resourceId
    );
    const targetObject = {
      type: resourceType,
      id: resourceId,
      createdBy: object.createdBy,
    };
    // Share-authority: only owner/admin/creator (holders of `resource.share`).
    await PermissionService.check(caller, "resource.share", targetObject);
    const principal = await GrantService.resolvePrincipal(
      caller.organizationId,
      grantee
    );
    const verbs = accessVerbs(access);
    // Permissions boundary: can't give away access you don't hold.
    const granterSet = await PermissionService.loadSet(caller);
    granterSet.assertWithinBoundary(targetObject, verbs);

    const rows = verbs.map((verb) =>
      new PermissionGrantModelFactory()
        .create(caller.userId)
        .update({
          organizationId: caller.organizationId,
          principalType: principal.principalType,
          principalId: principal.principalId,
          effect: "allow",
          verb,
          resourceType,
          resourceId,
          condition: null,
        })
        .parse()
    );

    const created = await DbService.transaction(async (tx) => {
      await DbService.repository.permissionGrants.hardDeleteShare(
        caller.organizationId,
        principal.principalType,
        principal.principalId,
        resourceType,
        resourceId,
        tx
      );
      return DbService.repository.permissionGrants.createMany(
        rows as never,
        tx
      );
    });

    void AuditService.record({
      organizationId: caller.organizationId,
      userId: caller.userId,
      action: "grant.create",
      targetType: resourceType,
      targetId: resourceId,
      sourceIp: auditCtx.sourceIp,
      userAgent: auditCtx.userAgent,
      metadata: {
        principalType: principal.principalType,
        principalId: principal.principalId,
        access,
      },
    });

    return {
      id: created[0].id,
      principalType: principal.principalType,
      principalId: principal.principalId,
      principalLabel: principal.label,
      access,
    };
  }

  /** Who an object is shared with (owner/admin/creator only). */
  static async list(
    caller: PermissionContext,
    resourceType: ShareResourceType,
    resourceId: string
  ): Promise<GrantView[]> {
    const object = await GrantService.resolveObject(
      caller.organizationId,
      resourceType,
      resourceId
    );
    await PermissionService.check(caller, "resource.share", {
      type: resourceType,
      id: resourceId,
      createdBy: object.createdBy,
    });
    const rows = await DbService.repository.permissionGrants.findByResource(
      caller.organizationId,
      resourceType,
      resourceId
    );
    // Group verb-rows per principal.
    const byPrincipal = new Map<string, PermissionGrantSelect[]>();
    for (const r of rows) {
      const key = `${r.principalType}:${r.principalId}`;
      (byPrincipal.get(key) ?? byPrincipal.set(key, []).get(key)!).push(r);
    }
    const views: GrantView[] = [];
    for (const group of byPrincipal.values()) {
      const first = group[0];
      const label =
        first.principalType === "role"
          ? "The team"
          : ((await DbService.repository.users.findById(first.principalId))
              ?.email ?? first.principalId);
      views.push({
        id: first.id,
        principalType: first.principalType,
        principalId: first.principalId,
        principalLabel: label,
        access: deriveAccess(group),
      });
    }
    return views;
  }

  /** Revoke a share (all verb rows of the row's principal on its object). */
  static async revoke(
    caller: PermissionContext,
    grantId: string,
    auditCtx: GrantAuditContext
  ): Promise<{ id: string }> {
    const row = await DbService.repository.permissionGrants.findById(grantId);
    if (!row || row.organizationId !== caller.organizationId) {
      throw new ApiError(404, ApiCode.GRANT_NOT_FOUND, "Grant not found");
    }
    const resourceType = row.resourceType as ShareResourceType;
    const object = await GrantService.resolveObject(
      caller.organizationId,
      resourceType,
      row.resourceId as string
    );
    await PermissionService.check(caller, "resource.share", {
      type: resourceType,
      id: row.resourceId as string,
      createdBy: object.createdBy,
    });
    await DbService.transaction((tx) =>
      DbService.repository.permissionGrants.hardDeleteShare(
        caller.organizationId,
        row.principalType,
        row.principalId,
        resourceType,
        row.resourceId as string,
        tx
      )
    );
    void AuditService.record({
      organizationId: caller.organizationId,
      userId: caller.userId,
      action: "grant.revoke",
      targetType: resourceType,
      targetId: row.resourceId,
      sourceIp: auditCtx.sourceIp,
      userAgent: auditCtx.userAgent,
      metadata: {
        principalType: row.principalType,
        principalId: row.principalId,
      },
    });
    return { id: grantId };
  }
}
