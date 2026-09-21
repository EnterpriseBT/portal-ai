import {
  and,
  or,
  eq,
  inArray,
  notInArray,
  sql,
  type SQL,
  type AnyColumn,
} from "drizzle-orm";

import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { SystemUtilities } from "../utils/system.util.js";
import type { PermissionStatementSelect } from "../db/schema/zod.js";

/**
 * The structural fields the resolver reads — the common shape of a policy
 * `PermissionStatementSelect` and an ad-hoc `PermissionGrantSelect` (#621), so
 * the engine unions both without caring which table a rule came from.
 */
export type EffectiveStatement = Pick<
  PermissionStatementSelect,
  "effect" | "verb" | "resourceType" | "resourceId" | "condition"
>;
import type {
  PermissionContext,
  PermissionAction,
  PermissionObject,
} from "./permission.service.js";

/** The canonical `(verb, resourceType)` a dotted {@link PermissionAction}
 *  normalizes to (the statement shape the engine matches against). */
interface NormalizedAction {
  verb: string;
  resourceType: string;
  resourceId?: string;
  createdBy?: string;
}

/** Fixed dotted-action → `(verb, resourceType)` map for the non-`resource.*`
 *  actions. `resource.read`/`resource.write` take their resourceType from the
 *  object (see {@link normalize}). Keep in lockstep with the seeded policies. */
const ACTION_MAP: Record<string, { verb: string; resourceType: string }> = {
  "billing.manage": { verb: "manage", resourceType: "billing" },
  "org.delete": { verb: "delete", resourceType: "org" },
  "org.audit.read": { verb: "read", resourceType: "audit" },
  "member.role.assign": { verb: "manage", resourceType: "member" },
  "member.invite": { verb: "invite", resourceType: "member" },
  "member.remove": { verb: "delete", resourceType: "member" },
};

/** The pre-#598 specific deny codes (parity with the retired switch). */
function denyCode(action: PermissionAction): ApiCode {
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

function denyMessage(action: PermissionAction): string {
  switch (action) {
    case "billing.manage":
      return "Only the organization owner can manage billing";
    case "org.delete":
      return "Only the organization owner can delete the organization";
    default:
      return "Your role does not permit this action";
  }
}

/**
 * A caller's resolved authorization — the effective statements (from their
 * role's policies + direct attachments + grants) loaded **once per request**
 * ({@link PermissionService.loadSet}) and evaluated in-memory. Pure AWS
 * semantics: explicit **deny** → explicit **allow** → implicit deny. Fail-
 * closed: an empty set denies everything.
 *
 * `check`/`can`/`visibilityPredicate` are the engine API. In #598 the engine
 * governs the migrated privileged guards; `visibilityPredicate` + object
 * `resource.*` are exercised by tests but wired into routes in #621.
 */
export class PermissionSet {
  constructor(
    private readonly ctx: PermissionContext,
    private readonly statements: EffectiveStatement[]
  ) {}

  /** Guard a mutation — throws `ApiError(403, …)` on deny, returns on allow. */
  check(action: PermissionAction, object?: PermissionObject): void {
    if (this.can(action, object)) return;
    throw new ApiError(403, denyCode(action), denyMessage(action));
  }

  /** Non-throwing allow/deny decision. */
  can(action: PermissionAction, object?: PermissionObject): boolean {
    return this.resolve(this.normalize(action, object)) === "allow";
  }

  /**
   * A SQL predicate to AND into a list query's `where` for `read` on
   * `resourceType`, or `undefined` when the caller may see every row (an
   * unconditional class-level allow). Fail-closed: when no allow applies,
   * a predicate that matches nothing. Resolved once (never a per-row probe,
   * #440). Built here in #598; wired into routes in #621.
   */
  visibilityPredicate(
    resourceType: string,
    cols: { createdByCol: AnyColumn; idCol: AnyColumn }
  ): SQL | undefined {
    const { createdByCol, idCol } = cols;
    const reads = this.statements.filter(
      (s) =>
        (s.verb === "read" || s.verb === "*") &&
        (s.resourceType === resourceType || s.resourceType === "*")
    );
    const allows = reads.filter((s) => s.effect === "allow");
    const denies = reads.filter((s) => s.effect === "deny");
    const denyIds = denies
      .filter((s) => s.resourceId !== null)
      .map((s) => s.resourceId as string);

    // An unconditional class-level allow ⇒ see all — unless an unconditional
    // class-level deny revokes it. Instance denies still subtract.
    if (allows.some((s) => s.resourceId === null && s.condition === null)) {
      if (denies.some((s) => s.resourceId === null && s.condition === null)) {
        return sql`false`;
      }
      return denyIds.length ? notInArray(idCol, denyIds) : undefined;
    }

    const orParts: SQL[] = [];
    if (
      allows.some(
        (s) => s.resourceId === null && s.condition === "created_by_caller"
      )
    ) {
      orParts.push(eq(createdByCol, this.ctx.userId));
    }
    if (
      allows.some(
        (s) => s.resourceId === null && s.condition === "created_by_system"
      )
    ) {
      orParts.push(eq(createdByCol, SystemUtilities.id.system));
    }
    const allowIds = allows
      .filter((s) => s.resourceId !== null)
      .map((s) => s.resourceId as string);
    if (allowIds.length) orParts.push(inArray(idCol, allowIds));

    if (orParts.length === 0) return sql`false`; // fail-closed: nothing visible
    const base = orParts.length === 1 ? orParts[0] : (or(...orParts) as SQL);
    return denyIds.length
      ? (and(base, notInArray(idCol, denyIds)) as SQL)
      : base;
  }

  // ── internals ──────────────────────────────────────────────────────

  private normalize(
    action: PermissionAction,
    object?: PermissionObject
  ): NormalizedAction {
    if (action === "resource.read" || action === "resource.write") {
      return {
        verb: action === "resource.read" ? "read" : "write",
        resourceType: object?.type ?? "",
        resourceId: object?.id,
        createdBy: object?.createdBy,
      };
    }
    const mapped = ACTION_MAP[action];
    return {
      verb: mapped?.verb ?? "",
      resourceType: mapped?.resourceType ?? "",
      resourceId: object?.id,
      createdBy: object?.createdBy,
    };
  }

  private resolve(norm: NormalizedAction): "allow" | "deny" {
    let hasAllow = false;
    let hasDeny = false;
    for (const s of this.statements) {
      if (!this.matches(s, norm)) continue;
      if (s.effect === "deny") hasDeny = true;
      else hasAllow = true;
    }
    return hasDeny ? "deny" : hasAllow ? "allow" : "deny";
  }

  private matches(s: EffectiveStatement, norm: NormalizedAction): boolean {
    const verbOk = s.verb === "*" || s.verb === norm.verb;
    const typeOk =
      s.resourceType === "*" || s.resourceType === norm.resourceType;
    const idOk = s.resourceId === null || s.resourceId === norm.resourceId;
    const condOk =
      s.condition === null ||
      (s.condition === "created_by_caller" &&
        norm.createdBy === this.ctx.userId) ||
      (s.condition === "created_by_system" &&
        norm.createdBy === SystemUtilities.id.system);
    return verbOk && typeOk && idOk && condOk;
  }
}
