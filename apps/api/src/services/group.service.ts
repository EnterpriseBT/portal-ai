/**
 * Custom RBAC group authoring (#622 slice 5). A group is a member set that
 * bundles policies (a member inherits every policy attached to a group they're
 * in — resolved in `loadSet`, slice 1). CRUD + policy bundle mirror
 * {@link RoleService} (same gates + union boundary — bundling FullAccess into a
 * group and self-joining can't escalate); membership is set from either side
 * (group-centric `setMembers`, member-centric `setGroups`). Groups are always
 * org-defined (no system groups). Delete cascade-soft-deletes memberships +
 * attachments.
 */

import { GroupModelFactory } from "@portalai/core/models";
import type { GroupUpsertRequest, GroupView } from "@portalai/core/contracts";

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
import type { GroupSelect } from "../db/schema/zod.js";
import type { MembershipDiff } from "../db/repositories/user-groups.repository.js";
import type { RbacAuditContext } from "./policy.service.js";

export class GroupService {
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
  ): Promise<GroupSelect> {
    const group = await DbService.repository.groups.findById(id);
    if (!group || group.organizationId !== caller.organizationId) {
      throw new ApiError(404, ApiCode.GROUP_NOT_FOUND, "Group not found");
    }
    return group;
  }

  private static async assertNameFree(
    caller: PermissionContext,
    name: string,
    exceptId?: string
  ): Promise<void> {
    const existing = await DbService.repository.groups.findByName(
      caller.organizationId,
      name
    );
    if (existing && existing.id !== exceptId) {
      throw new ApiError(
        409,
        ApiCode.RBAC_NAME_CONFLICT,
        `A group named "${name}" already exists`
      );
    }
  }

  /** Every userId must be an active member of the caller's org. */
  private static async assertMembers(
    caller: PermissionContext,
    userIds: string[]
  ): Promise<void> {
    for (const userId of userIds) {
      const membership =
        await DbService.repository.organizationUsers.findByOrganizationAndUser(
          caller.organizationId,
          userId
        );
      if (!membership) {
        throw new ApiError(
          400,
          ApiCode.RBAC_GRANTEE_NOT_MEMBER,
          "Every group member must be an active member of the organization"
        );
      }
    }
  }

  private static async policyIdsOf(id: string): Promise<string[]> {
    const rows = await DbService.repository.policyAttachments.findByPrincipals([
      { principalType: "group", principalId: id },
    ]);
    return rows.map((r) => r.policyId);
  }

  private static async toView(group: GroupSelect): Promise<GroupView> {
    const [policyIds, memberCount] = await Promise.all([
      GroupService.policyIdsOf(group.id),
      DbService.repository.userGroups.countMembers(group.id),
    ]);
    return {
      id: group.id,
      name: group.name,
      description: group.description,
      policyIds,
      memberCount,
    };
  }

  private static auditMembership(
    caller: PermissionContext,
    groupId: string,
    diff: MembershipDiff,
    audit: RbacAuditContext
  ): void {
    const emit =
      (action: "group.member.add" | "group.member.remove") =>
      (userId: string) =>
        void AuditService.record({
          organizationId: caller.organizationId,
          userId: caller.userId,
          action,
          targetType: "group",
          targetId: groupId,
          sourceIp: audit.sourceIp,
          userAgent: audit.userAgent,
          metadata: { memberId: userId },
        });
    diff.added.forEach(emit("group.member.add"));
    diff.removed.forEach(emit("group.member.remove"));
  }

  static async list(caller: PermissionContext): Promise<GroupView[]> {
    await GroupService.gate(caller);
    const groups = await DbService.repository.groups.findByOrganizationId(
      caller.organizationId
    );
    return Promise.all(groups.map((g) => GroupService.toView(g)));
  }

  static async get(caller: PermissionContext, id: string): Promise<GroupView> {
    await GroupService.gate(caller);
    return GroupService.toView(await GroupService.load(caller, id));
  }

  static async create(
    caller: PermissionContext,
    req: GroupUpsertRequest,
    audit: RbacAuditContext
  ): Promise<GroupView> {
    await GroupService.gate(caller);
    await GroupService.assertPoliciesWithinBoundary(caller, req.policyIds);
    await GroupService.assertNameFree(caller, req.name);

    const group = new GroupModelFactory()
      .create(caller.userId)
      .update({
        organizationId: caller.organizationId,
        name: req.name,
        description: req.description ?? null,
      })
      .parse();

    const diff = await DbService.transaction(async (tx) => {
      await DbService.repository.groups.create(group as never, tx);
      return DbService.repository.policyAttachments.setPoliciesForPrincipal(
        caller.organizationId,
        "group",
        group.id,
        req.policyIds,
        caller.userId,
        tx
      );
    });

    void AuditService.record({
      organizationId: caller.organizationId,
      userId: caller.userId,
      action: "group.create",
      targetType: "group",
      targetId: group.id,
      sourceIp: audit.sourceIp,
      userAgent: audit.userAgent,
      metadata: { name: group.name, policyCount: req.policyIds.length },
    });
    for (const policyId of diff.attached) {
      void AuditService.record({
        organizationId: caller.organizationId,
        userId: caller.userId,
        action: "policy.attach",
        targetType: "group",
        targetId: group.id,
        sourceIp: audit.sourceIp,
        userAgent: audit.userAgent,
        metadata: { policyId },
      });
    }
    return GroupService.toView(group);
  }

  static async update(
    caller: PermissionContext,
    id: string,
    req: GroupUpsertRequest,
    audit: RbacAuditContext
  ): Promise<GroupView> {
    await GroupService.gate(caller);
    const group = await GroupService.load(caller, id);
    await GroupService.assertPoliciesWithinBoundary(caller, req.policyIds);
    await GroupService.assertNameFree(caller, req.name, id);

    const diff = await DbService.transaction(async (tx) => {
      await DbService.repository.groups.update(
        id,
        {
          name: req.name,
          description: req.description ?? null,
          updatedBy: caller.userId,
        } as never,
        tx
      );
      return DbService.repository.policyAttachments.setPoliciesForPrincipal(
        caller.organizationId,
        "group",
        id,
        req.policyIds,
        caller.userId,
        tx
      );
    });

    void AuditService.record({
      organizationId: caller.organizationId,
      userId: caller.userId,
      action: "group.update",
      targetType: "group",
      targetId: id,
      sourceIp: audit.sourceIp,
      userAgent: audit.userAgent,
      metadata: { name: req.name, policyCount: req.policyIds.length },
    });
    for (const policyId of diff.attached) {
      void AuditService.record({
        organizationId: caller.organizationId,
        userId: caller.userId,
        action: "policy.attach",
        targetType: "group",
        targetId: id,
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
        targetType: "group",
        targetId: id,
        sourceIp: audit.sourceIp,
        userAgent: audit.userAgent,
        metadata: { policyId },
      });
    }
    return GroupService.toView({ ...group, name: req.name });
  }

  static async remove(
    caller: PermissionContext,
    id: string,
    audit: RbacAuditContext
  ): Promise<{ id: string }> {
    await GroupService.gate(caller);
    const group = await GroupService.load(caller, id);

    await DbService.transaction(async (tx) => {
      await DbService.repository.userGroups.softDeleteByGroup(
        id,
        caller.userId,
        tx
      );
      await DbService.repository.policyAttachments.softDeleteByPrincipal(
        "group",
        id,
        caller.userId,
        tx
      );
      await DbService.repository.groups.softDelete(id, caller.userId, tx);
    });

    void AuditService.record({
      organizationId: caller.organizationId,
      userId: caller.userId,
      action: "group.delete",
      targetType: "group",
      targetId: id,
      sourceIp: audit.sourceIp,
      userAgent: audit.userAgent,
      metadata: { name: group.name },
    });
    return { id };
  }

  /** Set a group's membership (group-centric). */
  static async setMembers(
    caller: PermissionContext,
    id: string,
    userIds: string[],
    audit: RbacAuditContext
  ): Promise<GroupView> {
    await GroupService.gate(caller);
    const group = await GroupService.load(caller, id);
    await GroupService.assertMembers(caller, userIds);

    const diff = await DbService.transaction((tx) =>
      DbService.repository.userGroups.setGroupMembers(
        caller.organizationId,
        id,
        userIds,
        caller.userId,
        tx
      )
    );
    GroupService.auditMembership(caller, id, diff, audit);
    return GroupService.toView(group);
  }

  /** Set a member's groups (member-centric). */
  static async setGroupsForUser(
    caller: PermissionContext,
    userId: string,
    groupIds: string[],
    audit: RbacAuditContext
  ): Promise<{ userId: string; groupIds: string[] }> {
    await GroupService.gate(caller);
    await GroupService.assertMembers(caller, [userId]);
    // Every target group must belong to the caller's org.
    for (const gid of groupIds) await GroupService.load(caller, gid);

    const diff = await DbService.transaction((tx) =>
      DbService.repository.userGroups.setUserGroups(
        caller.organizationId,
        userId,
        groupIds,
        caller.userId,
        tx
      )
    );
    // Audit per group touched (member-centric emits the same group.member.*).
    for (const groupId of diff.added) {
      void AuditService.record({
        organizationId: caller.organizationId,
        userId: caller.userId,
        action: "group.member.add",
        targetType: "group",
        targetId: groupId,
        sourceIp: audit.sourceIp,
        userAgent: audit.userAgent,
        metadata: { memberId: userId },
      });
    }
    for (const groupId of diff.removed) {
      void AuditService.record({
        organizationId: caller.organizationId,
        userId: caller.userId,
        action: "group.member.remove",
        targetType: "group",
        targetId: groupId,
        sourceIp: audit.sourceIp,
        userAgent: audit.userAgent,
        metadata: { memberId: userId },
      });
    }
    return { userId, groupIds };
  }
}
