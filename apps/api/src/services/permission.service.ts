import {
  CALLER_CAPABILITY_ACTIONS,
  type OrgRole,
  type PolicyPrincipalType,
  type CapabilityMap,
} from "@portalai/core/models";

import { DbService } from "./db.service.js";
import { db } from "../db/client.js";
import type { DbClient } from "../db/repositories/base.repository.js";
import { PermissionSet } from "./permission-set.js";

/**
 * The resolved caller context an authorization decision keys off — the
 * `(userId, organizationId, roles)` the metadata middleware attaches to
 * `req.application.metadata`. `roles` is the caller's full role set (#620); the
 * engine unions their policies.
 */
export interface PermissionContext {
  userId: string;
  organizationId: string;
  roles: OrgRole[];
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
  | "resource.write"
  | "resource.delete"
  | "resource.share";

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
    // Gather a role principal per role the caller holds (#620) — the engine
    // unions their statements. One query resolves all names → role rows.
    const roleRows = await repo.roles.findByNames(
      ctx.organizationId,
      ctx.roles,
      client
    );
    for (const role of roleRows)
      principals.push({ principalType: "role", principalId: role.id });

    // #622: gather the caller's groups (one indexed read) and add a `group`
    // principal per membership — the engine unions their attached policies just
    // like a role's. `findByPrincipals` already iterates an arbitrary list.
    const groupIds = await repo.userGroups.findGroupIdsByUser(
      ctx.userId,
      ctx.organizationId,
      client
    );
    for (const groupId of groupIds)
      principals.push({ principalType: "group", principalId: groupId });

    const attachments = (
      await repo.policyAttachments.findByPrincipals(principals, client)
    ).filter((a) => a.organizationId === ctx.organizationId);
    const policyIds = [...new Set(attachments.map((a) => a.policyId))];
    const statements = await repo.permissionStatements.findByPolicyIds(
      policyIds,
      client
    );
    // #621: union ad-hoc object grants for the same principals. Grants share the
    // resolver fields, so they slot in as more statements — deny→allow→implicit
    // order (and visibilityPredicate) need no change.
    const grants = await repo.permissionGrants.findByPrincipals(
      principals,
      ctx.organizationId,
      client
    );
    return new PermissionSet(ctx, [...statements, ...grants]);
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

  /**
   * The caller's capability map (#620) — `can(a)` for each app-level gating
   * action, computed from one `loadSet`. The FE gates on this instead of role
   * names; object-level (`resource.*`) gates stay per-object (#621).
   */
  static async capabilities(
    ctx: PermissionContext,
    client: DbClient = db
  ): Promise<CapabilityMap> {
    const set = await PermissionService.loadSet(ctx, client);
    return Object.fromEntries(
      CALLER_CAPABILITY_ACTIONS.map((action) => [action, set.can(action)])
    ) as CapabilityMap;
  }
}
