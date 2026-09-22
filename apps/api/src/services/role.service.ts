/**
 * Custom RBAC role authoring (#622 slice 4). A role is a named bundle of
 * policies (identical shape to the system roles — `roles` row + role-principal
 * `policy_attachments`). Same three write-path gates as {@link PolicyService};
 * the **boundary** here checks the *union of the attached policies' statements*
 * against the author's set, so bundling FullAccess into a custom role and
 * self-assigning it can't escalate. System roles are immutable; delete
 * cascade-soft-deletes the role's `user_role` assignments + its attachments.
 */

import {
  RoleModelFactory,
  PolicyAttachmentModelFactory,
} from "@portalai/core/models";
import type { RoleUpsertRequest, RoleView } from "@portalai/core/contracts";

import { DbService } from "./db.service.js";
import {
  PermissionService,
  type PermissionContext,
} from "./permission.service.js";
import { EntitlementService } from "./entitlement.service.js";
import { RbacObjectResolver } from "./rbac-object-resolver.js";
import { AuditService } from "./audit.service.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import type { RoleSelect } from "../db/schema/zod.js";
import type { DbClient } from "../db/repositories/base.repository.js";
import type { RbacAuditContext } from "./policy.service.js";

export class RoleService {
  private static async gate(caller: PermissionContext): Promise<void> {
    if (!(await EntitlementService.customRbacEntitled(caller.organizationId))) {
      throw new ApiError(
        403,
        ApiCode.RBAC_CUSTOM_NOT_ENTITLED,
        "Your plan does not include custom RBAC authoring"
      );
    }
    await PermissionService.check(caller, "member.role.assign");
  }

  /** The attacher must hold everything the bundled policies grant (boundary
   *  on the union of their statements — prevents escalation via bundling). */
  private static async assertPoliciesWithinBoundary(
    caller: PermissionContext,
    policyIds: string[]
  ): Promise<void> {
    if (policyIds.length === 0) return;
    const statements =
      await DbService.repository.permissionStatements.findByPolicyIds(
        policyIds
      );
    const set = await PermissionService.loadSet(caller);
    await set.assertStatementsWithinBoundary(statements, (rt, rid) =>
      RbacObjectResolver.resolveCreatedBy(caller.organizationId, rt, rid)
    );
  }

  private static async load(
    caller: PermissionContext,
    id: string
  ): Promise<RoleSelect> {
    const role = await DbService.repository.roles.findById(id);
    if (!role || role.organizationId !== caller.organizationId) {
      throw new ApiError(404, ApiCode.ROLE_NOT_FOUND, "Role not found");
    }
    return role;
  }

  private static assertMutable(role: RoleSelect): void {
    if (role.kind === "system") {
      throw new ApiError(
        403,
        ApiCode.RBAC_SYSTEM_IMMUTABLE,
        "System roles cannot be modified or deleted"
      );
    }
  }

  private static async assertNameFree(
    caller: PermissionContext,
    name: string,
    exceptId?: string
  ): Promise<void> {
    const existing = await DbService.repository.roles.findByName(
      caller.organizationId,
      name
    );
    if (existing && existing.id !== exceptId) {
      throw new ApiError(
        409,
        ApiCode.RBAC_NAME_CONFLICT,
        `A role named "${name}" already exists`
      );
    }
  }

  private static async currentPolicyIds(
    roleId: string,
    client?: DbClient
  ): Promise<{ id: string; policyId: string }[]> {
    const rows = await DbService.repository.policyAttachments.findByPrincipals(
      [{ principalType: "role", principalId: roleId }],
      client
    );
    return rows.map((r) => ({ id: r.id, policyId: r.policyId }));
  }

  /** Diff the role's attached policies to the desired set (set-the-set).
   *  Soft-deletes removed attachments, inserts added ones. Returns the diff
   *  for the audit trail. */
  private static async syncPolicies(
    caller: PermissionContext,
    roleId: string,
    desired: string[],
    client: DbClient
  ): Promise<{ attached: string[]; detached: string[] }> {
    const current = await RoleService.currentPolicyIds(roleId, client);
    const currentSet = new Set(current.map((c) => c.policyId));
    const desiredSet = new Set(desired);

    const toDetach = current.filter((c) => !desiredSet.has(c.policyId));
    const toAttachIds = desired.filter((pid) => !currentSet.has(pid));

    if (toDetach.length > 0) {
      await DbService.repository.policyAttachments.softDeleteMany(
        toDetach.map((c) => c.id),
        caller.userId,
        client
      );
    }
    if (toAttachIds.length > 0) {
      const rows = toAttachIds.map((policyId) =>
        new PolicyAttachmentModelFactory()
          .create(caller.userId)
          .update({
            organizationId: caller.organizationId,
            policyId,
            principalType: "role",
            principalId: roleId,
          })
          .parse()
      );
      await DbService.repository.policyAttachments.createMany(
        rows as never,
        client
      );
    }
    return {
      attached: toAttachIds,
      detached: toDetach.map((c) => c.policyId),
    };
  }

  private static auditDiff(
    caller: PermissionContext,
    roleId: string,
    diff: { attached: string[]; detached: string[] },
    audit: RbacAuditContext
  ): void {
    for (const policyId of diff.attached) {
      void AuditService.record({
        organizationId: caller.organizationId,
        userId: caller.userId,
        action: "policy.attach",
        targetType: "role",
        targetId: roleId,
        sourceIp: audit.sourceIp,
        userAgent: audit.userAgent,
        metadata: { policyId },
      });
    }
    for (const policyId of diff.detached) {
      void AuditService.record({
        organizationId: caller.organizationId,
        userId: caller.userId,
        action: "policy.detach",
        targetType: "role",
        targetId: roleId,
        sourceIp: audit.sourceIp,
        userAgent: audit.userAgent,
        metadata: { policyId },
      });
    }
  }

  static async list(caller: PermissionContext): Promise<RoleView[]> {
    await RoleService.gate(caller);
    const roles = await DbService.repository.roles.findByOrganizationId(
      caller.organizationId
    );
    const attachments =
      await DbService.repository.policyAttachments.findByPrincipals(
        roles.map((r) => ({
          principalType: "role" as const,
          principalId: r.id,
        }))
      );
    const byRole = new Map<string, string[]>();
    for (const a of attachments) {
      const list = byRole.get(a.principalId) ?? [];
      list.push(a.policyId);
      byRole.set(a.principalId, list);
    }
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      policyIds: byRole.get(r.id) ?? [],
    }));
  }

  static async get(caller: PermissionContext, id: string): Promise<RoleView> {
    await RoleService.gate(caller);
    const role = await RoleService.load(caller, id);
    const current = await RoleService.currentPolicyIds(id);
    return {
      id: role.id,
      name: role.name,
      kind: role.kind,
      policyIds: current.map((c) => c.policyId),
    };
  }

  static async create(
    caller: PermissionContext,
    req: RoleUpsertRequest,
    audit: RbacAuditContext
  ): Promise<RoleView> {
    await RoleService.gate(caller);
    await RoleService.assertPoliciesWithinBoundary(caller, req.policyIds);
    await RoleService.assertNameFree(caller, req.name);

    const role = new RoleModelFactory()
      .create(caller.userId)
      .update({
        organizationId: caller.organizationId,
        name: req.name,
        kind: "custom",
      })
      .parse();

    const diff = await DbService.transaction(async (tx) => {
      await DbService.repository.roles.create(role as never, tx);
      return RoleService.syncPolicies(caller, role.id, req.policyIds, tx);
    });

    void AuditService.record({
      organizationId: caller.organizationId,
      userId: caller.userId,
      action: "role.create",
      targetType: "role",
      targetId: role.id,
      sourceIp: audit.sourceIp,
      userAgent: audit.userAgent,
      metadata: { name: role.name, policyCount: req.policyIds.length },
    });
    RoleService.auditDiff(caller, role.id, diff, audit);

    return {
      id: role.id,
      name: role.name,
      kind: role.kind,
      policyIds: req.policyIds,
    };
  }

  static async update(
    caller: PermissionContext,
    id: string,
    req: RoleUpsertRequest,
    audit: RbacAuditContext
  ): Promise<RoleView> {
    await RoleService.gate(caller);
    const role = await RoleService.load(caller, id);
    RoleService.assertMutable(role);
    await RoleService.assertPoliciesWithinBoundary(caller, req.policyIds);
    await RoleService.assertNameFree(caller, req.name, id);

    const diff = await DbService.transaction(async (tx) => {
      await DbService.repository.roles.update(
        id,
        { name: req.name, updatedBy: caller.userId } as never,
        tx
      );
      return RoleService.syncPolicies(caller, id, req.policyIds, tx);
    });

    void AuditService.record({
      organizationId: caller.organizationId,
      userId: caller.userId,
      action: "role.update",
      targetType: "role",
      targetId: id,
      sourceIp: audit.sourceIp,
      userAgent: audit.userAgent,
      metadata: { name: req.name, policyCount: req.policyIds.length },
    });
    RoleService.auditDiff(caller, id, diff, audit);

    return {
      id,
      name: req.name,
      kind: role.kind,
      policyIds: req.policyIds,
    };
  }

  static async remove(
    caller: PermissionContext,
    id: string,
    audit: RbacAuditContext
  ): Promise<{ id: string }> {
    await RoleService.gate(caller);
    const role = await RoleService.load(caller, id);
    RoleService.assertMutable(role);

    await DbService.transaction(async (tx) => {
      await DbService.repository.policyAttachments.softDeleteByPrincipal(
        "role",
        id,
        caller.userId,
        tx
      );
      await DbService.repository.userRole.softDeleteByRoleId(
        id,
        caller.userId,
        tx
      );
      await DbService.repository.roles.softDelete(id, caller.userId, tx);
    });

    void AuditService.record({
      organizationId: caller.organizationId,
      userId: caller.userId,
      action: "role.delete",
      targetType: "role",
      targetId: id,
      sourceIp: audit.sourceIp,
      userAgent: audit.userAgent,
      metadata: { name: role.name },
    });
    return { id };
  }
}
