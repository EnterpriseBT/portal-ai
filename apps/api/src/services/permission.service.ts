import type { AnyColumn, SQL } from "drizzle-orm";
import { eq, or } from "drizzle-orm";
import type { OrgRole, PolicyPrincipalType } from "@portalai/core/models";

import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { SystemUtilities } from "../utils/system.util.js";
import { DbService } from "./db.service.js";
import { db } from "../db/client.js";
import type { DbClient } from "../db/repositories/base.repository.js";
import { PermissionSet } from "./permission-set.js";

/**
 * The resolved caller context an authorization decision keys off — the same
 * `(userId, organizationId, role)` the metadata middleware attaches to
 * `req.application.metadata` (#576).
 */
export interface PermissionContext {
  userId: string;
  organizationId: string;
  role: OrgRole;
}

/**
 * The actions the guard understands.
 * - `billing.manage` / `org.delete` — owner-only.
 * - `org.audit.read` / `member.role.assign` — owner + admin.
 * - `member.invite` / `member.remove` — owner + admin (seats, #584).
 * - `resource.read` / `resource.write` — role default; a `member` is
 *   `createdBy`-scoped (read also allowed on system-created rows).
 *
 * `resource.*` here is the coarse role default. #598 layers object grants on
 * top by extending {@link PermissionService.resolveEffect}.
 */
export type PermissionAction =
  | "billing.manage"
  | "org.delete"
  | "org.audit.read"
  | "member.role.assign"
  | "member.invite"
  | "member.remove"
  | "resource.read"
  | "resource.write";

/** The object a `resource.*` action targets. `createdBy` drives member scoping. */
export interface PermissionObject {
  type: string;
  id?: string;
  createdBy?: string;
}

/** Actions only the `owner` may perform (billing and org deletion). */
const OWNER_ONLY: ReadonlySet<PermissionAction> = new Set([
  "billing.manage",
  "org.delete",
]);

/**
 * The single authorization resolver (#576) — a mutation **guard**
 * ({@link check}) and a list **visibility predicate**
 * ({@link visibilityPredicate}), both driven by the caller's role. Fail-closed:
 * an unresolved role or an unhandled action denies.
 *
 * Role-only today; the grant layer (#598) plugs into {@link resolveEffect} and
 * {@link visibilityPredicate} without touching call sites.
 */
export class PermissionService {
  /**
   * Load the caller's effective {@link PermissionSet} — the data-driven engine
   * (#598). Gathers the statements of every policy attached to the caller's
   * role (mapped from `ctx.role` → the seeded role of that name) plus any
   * direct user attachments, org-scoped, in a couple of indexed reads. Resolve
   * **once per request** (the metadata middleware attaches the result); never
   * per check/row. On no role/attachments the set is empty ⇒ fail-closed.
   *
   * The static {@link check}/{@link visibilityPredicate} below are the retired
   * #576 switch, kept until the slice-4 cutover migrates the call sites.
   */
  static async loadSet(
    ctx: PermissionContext,
    client: DbClient = db
  ): Promise<PermissionSet> {
    const repo = DbService.repository;
    const principals: {
      principalType: PolicyPrincipalType;
      principalId: string;
    }[] = [{ principalType: "user", principalId: ctx.userId }];
    const role = await repo.roles.findByName(
      ctx.organizationId,
      ctx.role,
      client
    );
    if (role) principals.push({ principalType: "role", principalId: role.id });

    const attachments = (
      await repo.policyAttachments.findByPrincipals(principals, client)
    ).filter((a) => a.organizationId === ctx.organizationId);
    const policyIds = [...new Set(attachments.map((a) => a.policyId))];
    const statements = await repo.permissionStatements.findByPolicyIds(
      policyIds,
      client
    );
    return new PermissionSet(ctx, statements);
  }

  /** Guard a mutation. Throws `ApiError(403, …)` on deny; returns on allow. */
  static check(
    ctx: PermissionContext,
    action: PermissionAction,
    object?: PermissionObject
  ): void {
    if (PermissionService.resolveEffect(ctx, action, object) === "allow")
      return;
    throw new ApiError(
      403,
      PermissionService.denyCode(action),
      PermissionService.denyMessage(action)
    );
  }

  /**
   * A SQL predicate to AND into a list query's `where`, or `undefined` when the
   * caller may see every org row (owner/admin). A `member` sees rows they
   * created plus system-provisioned defaults (the default station + sandbox,
   * OQ1). Resolved once per request — never a per-row probe (#440).
   */
  static visibilityPredicate(
    ctx: PermissionContext,
    opts: { createdByCol: AnyColumn }
  ): SQL | undefined {
    if (ctx.role === "owner" || ctx.role === "admin") return undefined;
    return or(
      eq(opts.createdByCol, ctx.userId),
      eq(opts.createdByCol, SystemUtilities.id.system)
    );
  }

  /**
   * The allow/deny decision. Grant-ready seam: #598 consults
   * `permission_grants` here before falling back to the role default.
   */
  private static resolveEffect(
    ctx: PermissionContext,
    action: PermissionAction,
    object?: PermissionObject
  ): "allow" | "deny" {
    switch (ctx.role) {
      case "owner":
        return "allow";
      case "admin":
        return OWNER_ONLY.has(action) ? "deny" : "allow";
      case "member": {
        if (action === "resource.read" || action === "resource.write") {
          if (object?.createdBy === ctx.userId) return "allow";
          // Members may READ system-provisioned defaults, not write them (OQ1).
          if (
            action === "resource.read" &&
            object?.createdBy === SystemUtilities.id.system
          ) {
            return "allow";
          }
          return "deny";
        }
        return "deny";
      }
      default:
        return "deny"; // fail-closed on an unresolved/unknown role
    }
  }

  /** Keep the pre-existing specific codes for the three privileged actions
   *  (#576); INSUFFICIENT_ROLE is the generic gate (e.g. role assignment). */
  private static denyCode(action: PermissionAction): ApiCode {
    switch (action) {
      case "billing.manage":
        return ApiCode.BILLING_NOT_OWNER;
      case "org.delete":
        return ApiCode.ORGANIZATION_NOT_OWNER;
      case "org.audit.read":
        return ApiCode.AUDIT_LOG_NOT_AUTHORIZED;
      default:
        return ApiCode.INSUFFICIENT_ROLE;
    }
  }

  private static denyMessage(action: PermissionAction): string {
    switch (action) {
      case "billing.manage":
        return "Only the organization owner can manage billing";
      case "org.delete":
        return "Only the organization owner can delete the organization";
      default:
        return "Your role does not permit this action";
    }
  }
}
