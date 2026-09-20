import type { OrgRole, PolicyPrincipalType } from "@portalai/core/models";

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
 * The actions the guard understands (dotted form; the engine normalizes each to
 * a canonical `(verb, resourceType)` — see `permission-set.ts`).
 * - `billing.manage` / `org.delete` — owner-only.
 * - `org.audit.read` / `member.role.assign` — owner + admin.
 * - `member.invite` / `member.remove` — owner + admin (seats, #584).
 * - `resource.read` / `resource.write` — object read/write; a `member` is
 *   `createdBy`-scoped (read also allowed on system-created rows).
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

/** The object a `resource.*` action targets. `createdBy` drives the ownership
 *  condition; `id` selects instance-level statements/grants. */
export interface PermissionObject {
  type: string;
  id?: string;
  createdBy?: string;
}

/**
 * The data-driven authorization engine (#598) — replaces #576's hardcoded role
 * switch. {@link loadSet} resolves the caller's effective {@link PermissionSet}
 * from the seeded policies (and #621 grants); {@link check} guards a mutation
 * through it. Pure AWS semantics + fail-closed live in `PermissionSet`.
 *
 * The list **visibility predicate** is `PermissionSet.visibilityPredicate`,
 * wired into list routes in #621.
 */
export class PermissionService {
  /**
   * Load the caller's effective {@link PermissionSet}. Gathers the statements of
   * every policy attached to the caller's role (mapped from `ctx.role` → the
   * seeded role of that name) plus any direct user attachments, org-scoped, in a
   * couple of indexed reads. No role/attachments ⇒ an empty set ⇒ fail-closed.
   * #621 attaches the result on the request to resolve once per request for the
   * list path; the guard below loads per call (one guard per mutation).
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

  /**
   * Guard a mutation — resolves the caller's set and delegates to
   * `PermissionSet.check`. Throws `ApiError(403, …)` on deny; returns on allow.
   * Async (it reads the caller's policies): **every call site must `await`**.
   */
  static async check(
    ctx: PermissionContext,
    action: PermissionAction,
    object?: PermissionObject
  ): Promise<void> {
    (await PermissionService.loadSet(ctx)).check(action, object);
  }
}
