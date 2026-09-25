/**
 * Custom RBAC policy authoring (#622 slice 3). CRUD over `kind:"custom"`
 * `permission_policies` + their statements, behind the three write-path gates
 * (CLAUDE.md → gate layering): the org **entitlement** (`customRbacEntitled`),
 * the owner/admin **capability** (`member.role.assign`), and the statement
 * **boundary** (`assertStatementsWithinBoundary` — an author can't grant beyond
 * their own set). System policies are immutable. Every mutation is audited.
 */

import {
  PolicyModelFactory,
  PermissionStatementModelFactory,
  validateStatements,
} from "@portalai/core/models";
import type {
  PolicyUpsertRequest,
  PolicyStatementInput,
  PolicyView,
} from "@portalai/core/contracts";

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
import type {
  PolicySelect,
  PermissionStatementSelect,
} from "../db/schema/zod.js";

export interface RbacAuditContext {
  sourceIp: string | null;
  userAgent: string | null;
}

export class PolicyService {
  /** Gate A (entitlement) + Gate B1 (capability). Throws on either. */
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

  /**
   * Gate B0 — statement **shape** validity, the same `RESOURCE_CAPABILITIES` rule
   * the web editor constructs against (#630). Pure + synchronous (no DB): rejects
   * an inert `(verb × resource × scope)` combination (e.g. `read page`) before the
   * boundary check resolves the caller's set. Runs for every authored-statement
   * path — the HTTP router AND the `rbac_management` toolpack both reach here via
   * `create`/`update`, so the rule is enforced in exactly one place.
   */
  private static assertStatementsValid(
    statements: PolicyStatementInput[]
  ): void {
    const result = validateStatements(statements);
    if (!result.valid) {
      throw new ApiError(
        400,
        ApiCode.RBAC_STATEMENT_INVALID,
        `Statement ${result.index + 1} is invalid: ${result.reason}`
      );
    }
  }

  /** Gate B2 — the statement boundary, on the caller's own resolved set. */
  private static async assertBoundary(
    caller: PermissionContext,
    statements: PolicyStatementInput[]
  ): Promise<void> {
    const set = await PermissionService.loadSet(caller);
    await set.assertStatementsWithinBoundary(statements, (rt, rid) =>
      RbacObjectResolver.resolveCreatedBy(caller.organizationId, rt, rid)
    );
  }

  private static async load(
    caller: PermissionContext,
    id: string
  ): Promise<PolicySelect> {
    const policy = await DbService.repository.permissionPolicies.findById(id);
    if (!policy || policy.organizationId !== caller.organizationId) {
      throw new ApiError(404, ApiCode.POLICY_NOT_FOUND, "Policy not found");
    }
    return policy;
  }

  private static assertMutable(policy: PolicySelect): void {
    if (policy.kind === "system") {
      throw new ApiError(
        403,
        ApiCode.RBAC_SYSTEM_IMMUTABLE,
        "System policies cannot be modified or deleted"
      );
    }
  }

  private static async assertNameFree(
    caller: PermissionContext,
    name: string,
    exceptId?: string
  ): Promise<void> {
    const existing = await DbService.repository.permissionPolicies.findByName(
      caller.organizationId,
      name
    );
    if (existing && existing.id !== exceptId) {
      throw new ApiError(
        409,
        ApiCode.RBAC_NAME_CONFLICT,
        `A policy named "${name}" already exists`
      );
    }
  }

  private static buildStatements(
    caller: PermissionContext,
    policyId: string,
    inputs: PolicyStatementInput[]
  ): PermissionStatementSelect[] {
    return inputs.map((i) =>
      new PermissionStatementModelFactory()
        .create(caller.userId)
        .update({
          organizationId: caller.organizationId,
          policyId,
          effect: i.effect,
          verb: i.verb,
          resourceType: i.resourceType,
          resourceId: i.resourceId,
          condition: i.condition,
        })
        .parse()
    );
  }

  private static toView(
    policy: PolicySelect,
    statements: PermissionStatementSelect[]
  ): PolicyView {
    return {
      id: policy.id,
      name: policy.name,
      kind: policy.kind,
      description: policy.description,
      statements: statements.map((s) => ({
        effect: s.effect,
        verb: s.verb,
        resourceType: s.resourceType,
        resourceId: s.resourceId,
        condition: s.condition,
      })),
    };
  }

  static async list(caller: PermissionContext): Promise<PolicyView[]> {
    await PolicyService.gate(caller);
    const policies =
      await DbService.repository.permissionPolicies.findByOrganizationId(
        caller.organizationId
      );
    const statements =
      await DbService.repository.permissionStatements.findByPolicyIds(
        policies.map((p) => p.id)
      );
    const byPolicy = new Map<string, PermissionStatementSelect[]>();
    for (const s of statements) {
      const list = byPolicy.get(s.policyId) ?? [];
      list.push(s);
      byPolicy.set(s.policyId, list);
    }
    return policies.map((p) =>
      PolicyService.toView(p, byPolicy.get(p.id) ?? [])
    );
  }

  static async get(caller: PermissionContext, id: string): Promise<PolicyView> {
    await PolicyService.gate(caller);
    const policy = await PolicyService.load(caller, id);
    const statements =
      await DbService.repository.permissionStatements.findByPolicyId(id);
    return PolicyService.toView(policy, statements);
  }

  static async create(
    caller: PermissionContext,
    req: PolicyUpsertRequest,
    audit: RbacAuditContext
  ): Promise<PolicyView> {
    await PolicyService.gate(caller);
    PolicyService.assertStatementsValid(req.statements);
    await PolicyService.assertBoundary(caller, req.statements);
    await PolicyService.assertNameFree(caller, req.name);

    const policy = new PolicyModelFactory()
      .create(caller.userId)
      .update({
        organizationId: caller.organizationId,
        name: req.name,
        kind: "custom",
        description: req.description ?? null,
      })
      .parse();
    const rows = PolicyService.buildStatements(
      caller,
      policy.id,
      req.statements
    );

    await DbService.transaction(async (tx) => {
      await DbService.repository.permissionPolicies.create(policy as never, tx);
      await DbService.repository.permissionStatements.replaceForPolicy(
        policy.id,
        rows as never,
        tx
      );
    });

    void AuditService.record({
      organizationId: caller.organizationId,
      userId: caller.userId,
      action: "policy.create",
      targetType: "policy",
      targetId: policy.id,
      sourceIp: audit.sourceIp,
      userAgent: audit.userAgent,
      metadata: { name: policy.name, statementCount: rows.length },
    });
    return PolicyService.toView(policy, rows);
  }

  static async update(
    caller: PermissionContext,
    id: string,
    req: PolicyUpsertRequest,
    audit: RbacAuditContext
  ): Promise<PolicyView> {
    await PolicyService.gate(caller);
    const policy = await PolicyService.load(caller, id);
    PolicyService.assertMutable(policy);
    PolicyService.assertStatementsValid(req.statements);
    await PolicyService.assertBoundary(caller, req.statements);
    await PolicyService.assertNameFree(caller, req.name, id);

    const rows = PolicyService.buildStatements(caller, id, req.statements);
    await DbService.transaction(async (tx) => {
      await DbService.repository.permissionPolicies.update(
        id,
        {
          name: req.name,
          description: req.description ?? null,
          updatedBy: caller.userId,
        } as never,
        tx
      );
      await DbService.repository.permissionStatements.replaceForPolicy(
        id,
        rows as never,
        tx
      );
    });

    void AuditService.record({
      organizationId: caller.organizationId,
      userId: caller.userId,
      action: "policy.update",
      targetType: "policy",
      targetId: id,
      sourceIp: audit.sourceIp,
      userAgent: audit.userAgent,
      metadata: { name: req.name, statementCount: rows.length },
    });
    return PolicyService.toView({ ...policy, name: req.name }, rows);
  }

  static async remove(
    caller: PermissionContext,
    id: string,
    audit: RbacAuditContext
  ): Promise<{ id: string }> {
    await PolicyService.gate(caller);
    const policy = await PolicyService.load(caller, id);
    PolicyService.assertMutable(policy);

    await DbService.transaction(async (tx) => {
      await DbService.repository.permissionStatements.replaceForPolicy(
        id,
        [] as never,
        tx
      );
      await DbService.repository.policyAttachments.softDeleteByPolicyId(
        id,
        caller.userId,
        tx
      );
      await DbService.repository.permissionPolicies.softDelete(
        id,
        caller.userId,
        tx
      );
    });

    void AuditService.record({
      organizationId: caller.organizationId,
      userId: caller.userId,
      action: "policy.delete",
      targetType: "policy",
      targetId: id,
      sourceIp: audit.sourceIp,
      userAgent: audit.userAgent,
      metadata: { name: policy.name },
    });
    return { id };
  }
}
