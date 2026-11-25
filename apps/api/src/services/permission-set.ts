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

import {
  PERMISSION_VERBS,
  PERMISSION_RESOURCE_TYPES,
  OWNERSHIPLESS_RESOURCE_TYPES,
  PERSONAL_RESOURCE_TYPES,
} from "@portalai/core/models";

import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { SystemUtilities } from "../utils/system.util.js";
import { permissionDenied } from "./permission-refusal.js";
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
  /** `null` is an explicit "creator unknown" (#731): like an absent creator,
   *  it matches no ownership condition in {@link PermissionSet.matches}. */
  createdBy?: string | null;
}

/**
 * How a check reads the statements (#1127). `access` asks "may the caller do
 * this?", and narrows a wildcard allow on a personal type to the caller's own
 * (and system-created) objects. `delegation` asks "may the caller hand this
 * out?" (the authoring boundary), where the wildcard keeps covering them.
 */
type ResolveMode = "access" | "delegation";

/** The condition a statement applies with: its own, or, for a narrowed
 *  wildcard, the caller's own or system-created objects. */
type EffectiveCondition =
  | EffectiveStatement["condition"]
  | "created_by_caller_or_system";

const isPersonalType = (resourceType: string): boolean =>
  (PERSONAL_RESOURCE_TYPES as readonly string[]).includes(resourceType);

/** Fixed dotted-action → `(verb, resourceType)` map for the non-`resource.*`
 *  actions. `resource.read`/`resource.write` take their resourceType from the
 *  object (see {@link normalize}). Keep in lockstep with the seeded policies. */
const ACTION_MAP: Record<string, { verb: string; resourceType: string }> = {
  "billing.manage": { verb: "manage", resourceType: "billing" },
  "org.delete": { verb: "delete", resourceType: "org" },
  "org.write": { verb: "write", resourceType: "org" },
  "org.audit.read": { verb: "read", resourceType: "audit" },
  "member.role.assign": { verb: "manage", resourceType: "member" },
  "member.invite": { verb: "invite", resourceType: "member" },
  "member.remove": { verb: "delete", resourceType: "member" },
};

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
    throw permissionDenied(action, object);
  }

  /** Non-throwing allow/deny decision. */
  can(action: PermissionAction, object?: PermissionObject): boolean {
    return this.resolve(this.normalize(action, object)) === "allow";
  }

  /**
   * Whether the caller can perform `verb` on **any** object of `resourceType`
   * (own, system, unconditional, or a specific instance) — the coarse
   * class-level affordance behind `resourcePermissions` (#630). Unlike `can`
   * with a fixed `createdBy`, this doesn't miss a `created_by_system`-only or
   * instance-only grant (a real list still shows those rows, so hiding the
   * surface would be dishonest). Mirrors `visibilityPredicate`'s "returns
   * something" condition without building SQL: any matching allow counts, unless
   * an unconditional class-level deny suppresses the whole type.
   */
  canPerformAny(verb: string, resourceType: string): boolean {
    const rules = this.statements.filter(
      (s) =>
        (s.verb === verb || s.verb === "*") &&
        (s.resourceType === resourceType || s.resourceType === "*")
    );
    if (
      rules.some(
        (s) =>
          s.effect === "deny" && s.resourceId === null && s.condition === null
      )
    ) {
      return false;
    }
    return rules.some((s) => s.effect === "allow");
  }

  /**
   * Whether an **explicit deny** matches `verb` on `resourceType` (optionally a
   * specific object) — independent of any allow (#599). Deny-wins as a
   * *subtraction*: `resolveViewsForSession` suppresses a view only when an
   * `entity_record` deny is explicitly present, never merely because the member
   * holds no `entity_record` allow (a view's read authority IS the view grant).
   * Called with no object, it detects an unconditional class-level deny (the v1
   * granularity — per-row deny is deferred). Mirrors {@link matches} over the
   * deny statements only.
   */
  isDenied(
    verb: string,
    resourceType: string,
    object?: PermissionObject
  ): boolean {
    const norm = this.normalizeResource(verb, resourceType, object);
    return this.statements.some(
      (s) => s.effect === "deny" && this.matches(s, norm)
    );
  }

  /**
   * The permissions boundary (#621): a granter can only *give away* access they
   * themselves hold. (Policy authoring differs for personal types, #1127: see
   * {@link assertStatementsWithinBoundary}. Portals aren't shareable, so this
   * share-flow check never meets one.) Each `verb` a share materializes must be within THIS (the
   * granter's) set on the target object; the first one that isn't throws
   * `RBAC_GRANT_EXCEEDS_BOUNDARY`. Deny grants are always in-boundary
   * (restricting is safe). Called on the granter's resolved set at share time.
   */
  assertWithinBoundary(object: PermissionObject, verbs: string[]): void {
    for (const verb of verbs) {
      if (!this.can(`resource.${verb}` as PermissionAction, object)) {
        throw new ApiError(
          403,
          ApiCode.RBAC_GRANT_EXCEEDS_BOUNDARY,
          "You cannot grant access you do not have on this object"
        );
      }
    }
  }

  /**
   * The **statement-level** permissions boundary (#622) — a custom-policy author
   * can only write `allow` statements covered by their **own** resolved set;
   * `deny` statements are always in-boundary (restricting is safe). Two modes,
   * keyed on `resourceId`, both probing the private {@link resolve} (so
   * deny-override is free):
   *
   * - **Class-level** (`resourceId` null): the `verb`/`resourceType` wildcards
   *   fan out to every concrete pair, probed with a `createdBy` derived from the
   *   statement's `condition` — the author (`created_by_caller`), the system id
   *   (`created_by_system`), or a **sentinel** for an unconditional statement so
   *   only an *unconditional* author allow covers it (not an ownership-scoped
   *   one).
   * - **Instance-level** (`resourceId` set): `resolveCreatedBy` looks up the
   *   target object's real `createdBy` (a `null` — absent / unresolvable type —
   *   rejects) and each verb is probed against it, so an author who **created**
   *   the object (via `created_by_caller`) or holds class-level access can grant
   *   on it. Instance statements ignore `condition` (the object pins ownership).
   *
   * The first uncovered probe throws `RBAC_POLICY_EXCEEDS_BOUNDARY`.
   *
   * #1127: probes resolve in `delegation` mode, so a wildcard keeps covering
   * personal types here: whoever holds `* *` may author portal grants beyond
   * their own (narrowed) access, themselves included. That is the one place a
   * granter hands out access they don't hold: the default keeps portals
   * private, and widening it is an explicit, recorded policy.
   */
  async assertStatementsWithinBoundary(
    statements: EffectiveStatement[],
    resolveCreatedBy: (
      resourceType: string,
      resourceId: string
    ) => Promise<string | null>
  ): Promise<void> {
    const CONCRETE_VERBS = PERMISSION_VERBS.filter((v) => v !== "*");
    const CONCRETE_TYPES = PERMISSION_RESOURCE_TYPES.filter((t) => t !== "*");
    const SENTINEL_ID = " rbac-boundary-instance";
    const SENTINEL_UID = " rbac-boundary-caller";

    const reject = (): never => {
      throw new ApiError(
        403,
        ApiCode.RBAC_POLICY_EXCEEDS_BOUNDARY,
        "This policy grants access you do not have"
      );
    };

    for (const s of statements) {
      if (s.effect !== "allow") continue; // deny is always in-boundary
      const verbs = s.verb === "*" ? CONCRETE_VERBS : [s.verb];

      if (
        s.resourceId != null &&
        (OWNERSHIPLESS_RESOURCE_TYPES as readonly string[]).includes(
          s.resourceType
        )
      ) {
        // Instance-level on a pseudo-resource (e.g. `view page:connectors`, #630):
        // there is no object creator, so it is in-boundary iff the author holds
        // the verb on this specific instance (or a wildcard) — probe by id with a
        // sentinel `createdBy` (a page grant carries no ownership condition, so
        // only an unconditional author allow covers it).
        for (const verb of verbs) {
          if (
            this.resolve(
              {
                verb,
                resourceType: s.resourceType,
                resourceId: s.resourceId,
                createdBy: SENTINEL_UID,
              },
              "delegation"
            ) !== "allow"
          )
            reject();
        }
      } else if (s.resourceId != null) {
        // Instance-level — probe against the object's real creator.
        const createdBy = await resolveCreatedBy(s.resourceType, s.resourceId);
        if (createdBy == null) reject();
        for (const verb of verbs) {
          if (
            this.resolve(
              {
                verb,
                resourceType: s.resourceType,
                resourceId: s.resourceId,
                createdBy: createdBy as string,
              },
              "delegation"
            ) !== "allow"
          )
            reject();
        }
      } else {
        // Class-level — probe breadth, condition → probe createdBy.
        const types =
          s.resourceType === "*" ? CONCRETE_TYPES : [s.resourceType];
        const createdBy =
          s.condition === "created_by_caller"
            ? this.ctx.userId
            : s.condition === "created_by_system"
              ? SystemUtilities.id.system
              : SENTINEL_UID;
        for (const verb of verbs)
          for (const resourceType of types) {
            if (
              this.resolve(
                {
                  verb,
                  resourceType,
                  resourceId: SENTINEL_ID,
                  createdBy,
                },
                "delegation"
              ) !== "allow"
            )
              reject();
          }
      }
    }
  }

  /**
   * A SQL predicate to AND into a list query's `where` for `verb` (default
   * `read`) on `resourceType`, or `undefined` when the caller may do it to
   * every row (an unconditional class-level allow). Fail-closed: when no allow
   * applies, a predicate that matches nothing. Resolved once (never a per-row
   * probe, #440). Built here in #598; wired into routes in #621; `verb` added
   * by #829 for the writable-entity list.
   */
  visibilityPredicate(
    resourceType: string,
    cols: { createdByCol: AnyColumn; idCol: AnyColumn },
    verb: "read" | "write" = "read"
  ): SQL | undefined {
    const { createdByCol, idCol } = cols;
    const reads = this.statements.filter(
      (s) =>
        (s.verb === verb || s.verb === "*") &&
        (s.resourceType === resourceType || s.resourceType === "*")
    );
    // #1127: each allow with the condition it applies with for this type, so
    // a wildcard on a personal type contributes the caller's own (and
    // system-created) rows rather than "see all".
    const allows = reads
      .filter((s) => s.effect === "allow")
      .map((s) => ({
        ...s,
        condition: this.effectiveCondition(s, resourceType, "access"),
      }));
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
    const classAllow = (cond: EffectiveCondition) =>
      allows.some((s) => s.resourceId === null && s.condition === cond);
    const narrowed = classAllow("created_by_caller_or_system");
    if (narrowed || classAllow("created_by_caller")) {
      orParts.push(eq(createdByCol, this.ctx.userId));
    }
    if (narrowed || classAllow("created_by_system")) {
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
    // `resource.<verb>` (read | write | delete | share) — the verb is the
    // suffix and the resourceType comes from the object (#621 adds delete/share).
    if (action.startsWith("resource.")) {
      return this.normalizeResource(
        action.slice("resource.".length),
        object?.type ?? "",
        object
      );
    }
    const mapped = ACTION_MAP[action];
    return this.normalizeResource(
      mapped?.verb ?? "",
      mapped?.resourceType ?? "",
      object
    );
  }

  /** The one place an object becomes a {@link NormalizedAction}, shared by
   *  `can` (via {@link normalize}) and {@link isDenied}. */
  private normalizeResource(
    verb: string,
    resourceType: string,
    object?: PermissionObject
  ): NormalizedAction {
    return {
      verb,
      resourceType,
      resourceId: object?.id,
      createdBy: object?.createdBy,
    };
  }

  private resolve(
    norm: NormalizedAction,
    mode: ResolveMode = "access"
  ): "allow" | "deny" {
    let hasAllow = false;
    let hasDeny = false;
    for (const s of this.statements) {
      if (!this.matches(s, norm, mode)) continue;
      if (s.effect === "deny") hasDeny = true;
      else hasAllow = true;
    }
    return hasDeny ? "deny" : hasAllow ? "allow" : "deny";
  }

  private matches(
    s: EffectiveStatement,
    norm: NormalizedAction,
    mode: ResolveMode = "access"
  ): boolean {
    const verbOk = s.verb === "*" || s.verb === norm.verb;
    const typeOk =
      s.resourceType === "*" || s.resourceType === norm.resourceType;
    const idOk = s.resourceId === null || s.resourceId === norm.resourceId;
    const condition = this.effectiveCondition(s, norm.resourceType, mode);
    const ownedByCaller = norm.createdBy === this.ctx.userId;
    const ownedBySystem = norm.createdBy === SystemUtilities.id.system;
    const condOk =
      condition === null ||
      (condition === "created_by_caller" && ownedByCaller) ||
      (condition === "created_by_system" && ownedBySystem) ||
      (condition === "created_by_caller_or_system" &&
        (ownedByCaller || ownedBySystem));
    return verbOk && typeOk && idOk && condOk;
  }

  /**
   * #1127: the condition `s` applies with for `resourceType`. In `access` mode
   * an unconditional, class-level wildcard **allow** on a personal type
   * (`portal`) reaches only the caller's own and system-created objects. Every
   * other statement, every deny, and every `delegation` check uses the
   * statement's own condition, so explicit portal grants and authoring work as
   * written.
   */
  private effectiveCondition(
    s: EffectiveStatement,
    resourceType: string,
    mode: ResolveMode
  ): EffectiveCondition {
    const narrowed =
      mode === "access" &&
      s.effect === "allow" &&
      s.resourceType === "*" &&
      s.resourceId === null &&
      s.condition === null &&
      isPersonalType(resourceType);
    return narrowed ? "created_by_caller_or_system" : s.condition;
  }
}
