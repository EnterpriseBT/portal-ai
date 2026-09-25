import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * RBAC IAM engine (#598) — the data-driven authorization primitives that
 * replace #576's hardcoded role switch. A **policy** is a named bundle of
 * **statements** (`{ effect, verb, resourceType, resourceId?, condition? }`);
 * policies attach to principals (a **role** in #598; a user/group too) via
 * `policy_attachments`. Resolution is pure AWS: explicit deny → explicit allow
 * → implicit deny (no specificity ranking).
 *
 * Sync with the Drizzle tables is enforced at compile time via
 * `apps/api/src/db/schema/type-checks.ts` and at runtime via drizzle-zod in
 * `apps/api/src/db/schema/zod.ts`.
 */

/** allow beats nothing; an explicit deny beats everything. */
export const PERMISSION_EFFECTS = ["allow", "deny"] as const;
export const PermissionEffectSchema = z.enum(PERMISSION_EFFECTS);
export type PermissionEffect = z.infer<typeof PermissionEffectSchema>;

/** The action verb. `*` is the wildcard (FullAccess). `view` (#630) gates a nav
 *  page/section — distinct from `read` on an object, so a `deny read <class>`
 *  never collides with a page `view` grant (they are different resources). */
export const PERMISSION_VERBS = [
  "read",
  "write",
  "delete",
  "share",
  "manage",
  "invite",
  "view",
  "*",
] as const;
export const PermissionVerbSchema = z.enum(PERMISSION_VERBS);
export type PermissionVerb = z.infer<typeof PermissionVerbSchema>;

/** The object class a statement targets. `*` is any type.
 *  #630 adds the remaining plumbing object types (`entity_group`, `tag`,
 *  `column_definition`, `job`, `toolpack`) and the `page` nav pseudo-resource
 *  (`view page:<id>` gates a sidebar page/sub-tab). `view` (the #599 curated-view
 *  object) is unrelated to the `view` verb. Adding a type needs no migration —
 *  `resource_type` is a `text` column with no CHECK (only `effect`/`condition`
 *  are constrained). */
export const PERMISSION_RESOURCE_TYPES = [
  "station",
  "pin",
  "curated_view",
  "portal",
  "entity",
  "entity_record",
  "field_mapping",
  "connector_instance",
  "connector_definition",
  "entity_group",
  "tag",
  "column_definition",
  "job",
  "toolpack",
  "page",
  "billing",
  "org",
  "member",
  "audit",
  "*",
] as const;
export const PermissionResourceTypeSchema = z.enum(PERMISSION_RESOURCE_TYPES);
export type PermissionResourceType = z.infer<
  typeof PermissionResourceTypeSchema
>;

/**
 * The data object types a member's ownership condition + object grants apply to
 * — the user-created/connector-materialized entities, excluding the privileged
 * pseudo-resources (`billing`/`org`/`member`/`audit`) and the `*` wildcard.
 * `MemberAccess` is seeded as read/write over exactly these (D6/D8).
 */
export const DATA_RESOURCE_TYPES = [
  "station",
  "pin",
  "curated_view",
  "portal",
  "entity",
  "entity_record",
  "field_mapping",
  "connector_instance",
] as const satisfies readonly PermissionResourceType[];

/**
 * The object types that carry ownership + object grants + **sharing** (#621, D8)
 * — the ones with a `ShareDialog` and a member `delete`/`share` own-object seed.
 * A subset of {@link DATA_RESOURCE_TYPES}; the rest are data-plane (governed by
 * views + policies in #599), never user-shared.
 */
export const SHAREABLE_RESOURCE_TYPES = [
  "station",
  "pin",
] as const satisfies readonly PermissionResourceType[];

/**
 * The bounded, SQL-translatable condition vocabulary (#598 D6). Ownership is a
 * statement condition, not resolver code: `created_by_caller` ⇒ the object's
 * `createdBy === ctx.userId`; `created_by_system` ⇒ `=== SystemUtilities.id.system`.
 * Everything else (data-attribute slicing) is done with views (#599), never a
 * dynamic condition — so this set stays closed.
 */
export const PERMISSION_CONDITIONS = [
  "created_by_caller",
  "created_by_system",
] as const;
export const PermissionConditionSchema = z.enum(PERMISSION_CONDITIONS);
export type PermissionCondition = z.infer<typeof PermissionConditionSchema>;

/**
 * The app-level (non-object) actions the frontend gates on (#620) — the server
 * evaluates the caller's `PermissionSet.can(a)` for each and returns a
 * {@link CapabilityMap} on `current()`, so the FE gates on *capabilities*, never
 * role-name heuristics. Object-level (`resource.*`) gates stay per-object (#621).
 * Revisited during the smoke walk.
 */
export const CALLER_CAPABILITY_ACTIONS = [
  "billing.manage",
  "org.delete",
  "org.audit.read",
  "member.role.assign",
  "member.invite",
  "member.remove",
] as const;
export const CallerCapabilityActionSchema = z.enum(CALLER_CAPABILITY_ACTIONS);
export type CallerCapabilityAction = z.infer<
  typeof CallerCapabilityActionSchema
>;

export const CapabilityMapSchema = z.record(
  CallerCapabilityActionSchema,
  z.boolean()
);
export type CapabilityMap = z.infer<typeof CapabilityMapSchema>;

// ── Page + object permission surfaces (#630) ──────────────────────────

/**
 * The gateable sidebar pages — the `resourceId`s a `view page:<id>` statement
 * targets, and the **single source of truth** for the page set (the nav table,
 * the policy-editor page picker, and the route guards all derive from it, so a
 * new page can't be silently missed). One id **per page**, not per tab: a page's
 * sub-tabs / lists / tables are gated by the **object** `read` of the data they
 * show (e.g. the Connectors page is `connectors`; its Connected tab is gated by
 * `read connector_instance`, its Catalog tab by `read connector_definition`).
 * `page` is the only UI-only grant — everything else maps to a real object.
 * Dashboard is deliberately absent — the un-gated safe landing. The FE reads a
 * per-id `PagePermissionMap` off `current()` and gates nav/route on it (never a
 * role-name check).
 */
export const NAV_PAGE_IDS = [
  "stations",
  "pinned",
  "jobs",
  "connectors",
  "entities",
  "entity_groups",
  "tags",
  "column_definitions",
  "toolpacks",
] as const;
export const NavPageIdSchema = z.enum(NAV_PAGE_IDS);
export type NavPageId = z.infer<typeof NavPageIdSchema>;

/**
 * The pages `MemberAccess` grants `view` on (#630, Decision A). Dashboard is
 * un-gated; the admin pages (connectors/entities/…) carry **no** member grant —
 * a role that needs them is an admin-authored policy, which composes with zero
 * code change. Data-defined here so the seed and the backfill share one source.
 */
export const MEMBER_VIEW_PAGE_IDS = [
  "stations",
  "pinned",
  "jobs",
] as const satisfies readonly NavPageId[];

export const PagePermissionMapSchema = z.record(NavPageIdSchema, z.boolean());
export type PagePermissionMap = z.infer<typeof PagePermissionMapSchema>;

/**
 * The object resource types the FE reads a coarse class-level `{read,write,
 * delete}` map for (#630) — the data objects plus the plumbing catalogs, minus
 * the privileged pseudo-resources (governed by {@link CapabilityMap}) and `page`
 * (governed by {@link PagePermissionMap}). Per-object interactability is still a
 * per-object `check`; this map only powers coarse affordances.
 */
export const RESOURCE_PERMISSION_TYPES = [
  ...DATA_RESOURCE_TYPES,
  "connector_definition",
  "entity_group",
  "tag",
  "column_definition",
  "job",
  "toolpack",
] as const satisfies readonly PermissionResourceType[];

/**
 * Pseudo-resources with **no per-object ownership** (#630) — an instance-level
 * grant on them (`view page:connectors`) is authorized at the **class** level,
 * not against an object's creator (there is none). The custom-policy authoring
 * boundary (`assertStatementsWithinBoundary`) probes these by verb+id rather than
 * resolving a `createdBy`, so an admin who holds `view page` (or `* *`) can author
 * a role/group/policy granting a specific page — the composability guarantee.
 * `page` is the only one today; the privileged pseudo-resources
 * (`billing`/`org`/`member`/`audit`) are class-only in practice.
 */
export const OWNERSHIPLESS_RESOURCE_TYPES = [
  "page",
] as const satisfies readonly PermissionResourceType[];
export const ResourcePermissionTypeSchema = z.enum(RESOURCE_PERMISSION_TYPES);
export type ResourcePermissionType = z.infer<
  typeof ResourcePermissionTypeSchema
>;

export const ResourcePermissionMapSchema = z.record(
  ResourcePermissionTypeSchema,
  z.object({
    read: z.boolean(),
    write: z.boolean(),
    delete: z.boolean(),
  })
);
export type ResourcePermissionMap = z.infer<typeof ResourcePermissionMapSchema>;

// ── Statement construction validity (#630) ────────────────────────────

/**
 * What a legal statement may say about a resource: which **verbs** are meaningful
 * on it, whether it may target a **specific instance** (vs class-level only), and
 * whether a class statement may carry an **ownership** condition. This is the one
 * source of truth for "which (verb × resource × scope) combinations exist", so the
 * policy editor can only *construct* valid statements (and a future server-side
 * check can *reject* invalid ones) instead of allowing inert combinations like
 * `read page` or `manage station`.
 *
 * It is **composed from the vocabulary above**, not hand-maintained in parallel:
 *  - object/data + catalog types ({@link RESOURCE_PERMISSION_TYPES}) take
 *    `read`/`write`/`delete` (+ `share` for {@link SHAREABLE_RESOURCE_TYPES}) and
 *    the `*` verb; they support ownership; instance scope for the searchable ones;
 *  - `page` is the `view`-only nav pseudo-resource — fixed instance ids
 *    ({@link NAV_PAGE_IDS}), no ownership;
 *  - the privileged singletons (`billing`/`org`/`member`/`audit`) take exactly the
 *    verbs {@link CALLER_CAPABILITY_ACTIONS} defines and are class-only.
 *
 * The `view`⟺`page` pairing is **not** special-cased: `view` simply appears in no
 * verb set except `page`'s, so it can only ever pair with `page` — the coupling
 * falls out of the matrix. A `verbForStatement` guard test pins these invariants.
 */
export interface ResourceCapability {
  readonly verbs: readonly PermissionVerb[];
  readonly instanceScope: boolean;
  readonly ownership: boolean;
}

/** The object types with a searchable instance picker (mirrors the server's
 *  `RbacObjectSearchService`); `page` is instance-scoped too but via a fixed id
 *  list, so it is handled explicitly below. */
const INSTANCE_SEARCHABLE_TYPES = [
  "station",
  "pin",
  "portal",
  "connector_instance",
  "entity",
] as const satisfies readonly PermissionResourceType[];

const objectCapability = (t: PermissionResourceType): ResourceCapability => ({
  verbs: (
    SHAREABLE_RESOURCE_TYPES as readonly PermissionResourceType[]
  ).includes(t)
    ? ["read", "write", "delete", "share", "*"]
    : ["read", "write", "delete", "*"],
  instanceScope: (
    INSTANCE_SEARCHABLE_TYPES as readonly PermissionResourceType[]
  ).includes(t),
  ownership: true,
});

export const RESOURCE_CAPABILITIES: Record<
  PermissionResourceType,
  ResourceCapability
> = {
  station: objectCapability("station"),
  pin: objectCapability("pin"),
  curated_view: objectCapability("curated_view"),
  portal: objectCapability("portal"),
  entity: objectCapability("entity"),
  entity_record: objectCapability("entity_record"),
  field_mapping: objectCapability("field_mapping"),
  connector_instance: objectCapability("connector_instance"),
  connector_definition: objectCapability("connector_definition"),
  entity_group: objectCapability("entity_group"),
  tag: objectCapability("tag"),
  column_definition: objectCapability("column_definition"),
  job: objectCapability("job"),
  toolpack: objectCapability("toolpack"),
  // `view`-only nav pseudo-resource — fixed page ids, no per-object ownership.
  page: { verbs: ["view"], instanceScope: true, ownership: false },
  // Privileged singletons — verbs are exactly what CALLER_CAPABILITY_ACTIONS
  // gates (billing.manage / org.delete / org.audit.read / member.*); class-only.
  billing: { verbs: ["manage"], instanceScope: false, ownership: false },
  org: { verbs: ["delete"], instanceScope: false, ownership: false },
  audit: { verbs: ["read"], instanceScope: false, ownership: false },
  member: {
    verbs: ["invite", "manage", "delete"],
    instanceScope: false,
    ownership: false,
  },
  // Wildcard resource — any concrete verb (or `*`), never the page-only `view`.
  "*": {
    verbs: ["read", "write", "delete", "share", "manage", "invite", "*"],
    instanceScope: false,
    ownership: true,
  },
};

const DEFAULT_CAPABILITY: ResourceCapability = {
  verbs: [...PERMISSION_VERBS],
  instanceScope: false,
  ownership: true,
};

const capabilityFor = (t: PermissionResourceType): ResourceCapability =>
  RESOURCE_CAPABILITIES[t] ?? DEFAULT_CAPABILITY;

/** The verbs a statement on `t` may use (the only ones an editor should offer). */
export const verbsForResource = (
  t: PermissionResourceType
): readonly PermissionVerb[] => capabilityFor(t).verbs;

/** The verb to fall back to when a resource change orphans the current verb. */
export const defaultVerbForResource = (
  t: PermissionResourceType
): PermissionVerb => capabilityFor(t).verbs[0];

/** Whether `t` may be scoped to specific instances (vs class-level only). */
export const resourceAllowsInstanceScope = (
  t: PermissionResourceType
): boolean => capabilityFor(t).instanceScope;

/** Whether a class statement on `t` may carry an ownership condition. */
export const resourceAllowsOwnership = (t: PermissionResourceType): boolean =>
  capabilityFor(t).ownership;

/** Whether `(verb, resourceType)` is a meaningful pair the app enforces. */
export const isVerbValidForResource = (
  verb: PermissionVerb,
  t: PermissionResourceType
): boolean => (verbsForResource(t) as readonly string[]).includes(verb);

/** The shape a validity check reads — a policy statement or an ad-hoc grant. */
export interface StatementShape {
  verb: PermissionVerb;
  resourceType: PermissionResourceType;
  resourceId?: string | null;
  condition?: PermissionCondition | null;
}

export type StatementValidity =
  | { valid: true }
  | { valid: false; reason: string };

/**
 * Validate a statement's **shape** against {@link RESOURCE_CAPABILITIES} — the one
 * rule the policy editor, the API policy write path, and the `rbac_management`
 * toolpack all share, so "which statements are meaningful" lives in exactly one
 * place. Pure (no DB): it checks the `(verb × resource × scope × ownership)`
 * combination is meaningful, **not** that a specific `resourceId` exists — that
 * (and the caller's authority to grant it) is the permissions boundary's job
 * (`assertStatementsWithinBoundary`). `effect` is unconstrained: a `deny` is as
 * shape-valid as an `allow`.
 */
export function validateStatement(s: StatementShape): StatementValidity {
  if (!isVerbValidForResource(s.verb, s.resourceType)) {
    return {
      valid: false,
      reason: `verb '${s.verb}' is not valid for resource '${s.resourceType}'`,
    };
  }
  if (s.resourceId != null && !resourceAllowsInstanceScope(s.resourceType)) {
    return {
      valid: false,
      reason: `resource '${s.resourceType}' cannot be scoped to a specific object`,
    };
  }
  if (s.condition != null) {
    if (s.resourceId != null) {
      return {
        valid: false,
        reason: `an ownership condition applies only to a class-level statement`,
      };
    }
    if (!resourceAllowsOwnership(s.resourceType)) {
      return {
        valid: false,
        reason: `resource '${s.resourceType}' does not support an ownership condition`,
      };
    }
  }
  return { valid: true };
}

/** Validate a list; returns the first offending statement's index + reason. */
export function validateStatements(
  statements: readonly StatementShape[]
): { valid: true } | { valid: false; index: number; reason: string } {
  for (let i = 0; i < statements.length; i++) {
    const r = validateStatement(statements[i]);
    if (!r.valid) return { valid: false, index: i, reason: r.reason };
  }
  return { valid: true };
}

/** A policy/role is `system` (immutable, seeded) or `custom` (org-defined). */
export const RBAC_KINDS = ["system", "custom"] as const;
export const RbacKindSchema = z.enum(RBAC_KINDS);
export type RbacKind = z.infer<typeof RbacKindSchema>;

/** The principals a policy can attach to (#622 adds `group`). */
export const POLICY_PRINCIPAL_TYPES = ["user", "role", "group"] as const;
export const PolicyPrincipalTypeSchema = z.enum(POLICY_PRINCIPAL_TYPES);
export type PolicyPrincipalType = z.infer<typeof PolicyPrincipalTypeSchema>;

// ── Policy ────────────────────────────────────────────────────────────

export const PolicySchema = CoreSchema.extend({
  organizationId: z.string(),
  name: z.string().min(1),
  kind: RbacKindSchema,
  description: z.string().nullable(),
});
export type Policy = z.infer<typeof PolicySchema>;

export class PolicyModel extends CoreModel<Policy> {
  get schema() {
    return PolicySchema;
  }
  parse(): Policy {
    return this.schema.parse(this._model);
  }
  validate(): z.ZodSafeParseResult<Policy> {
    return this.schema.safeParse(this._model);
  }
}

export class PolicyModelFactory extends ModelFactory<Policy, PolicyModel> {
  create(createdBy: string): PolicyModel {
    return new PolicyModel(this._coreModelFactory.create(createdBy).toJSON());
  }
}

// ── PermissionStatement (a policy's statement rows) ───────────────────

export const PermissionStatementSchema = CoreSchema.extend({
  organizationId: z.string(),
  policyId: z.string(),
  effect: PermissionEffectSchema,
  verb: PermissionVerbSchema,
  resourceType: PermissionResourceTypeSchema,
  /** null = class-level (`type:*`); set = a specific instance. */
  resourceId: z.string().nullable(),
  condition: PermissionConditionSchema.nullable(),
});
export type PermissionStatement = z.infer<typeof PermissionStatementSchema>;

export class PermissionStatementModel extends CoreModel<PermissionStatement> {
  get schema() {
    return PermissionStatementSchema;
  }
  parse(): PermissionStatement {
    return this.schema.parse(this._model);
  }
  validate(): z.ZodSafeParseResult<PermissionStatement> {
    return this.schema.safeParse(this._model);
  }
}

export class PermissionStatementModelFactory extends ModelFactory<
  PermissionStatement,
  PermissionStatementModel
> {
  create(createdBy: string): PermissionStatementModel {
    return new PermissionStatementModel(
      this._coreModelFactory.create(createdBy).toJSON()
    );
  }
}

// ── PermissionGrant (ad-hoc, principal-bearing object grants, #621) ───

/**
 * An ad-hoc object grant (#621) — the same five resolver fields as a
 * {@link PermissionStatement}, but **principal-bearing** (`principalType` +
 * `principalId`) instead of policy-attached. The resolver unions grants with
 * policy statements by principal (the user + the user's roles) in exactly the
 * deny→allow→implicit order — a grant is just a statement that lives on the
 * principal, so it needs no resolver change. Grants are always instance-level
 * (`resourceId` non-null) in #621: sharing conveys *one* object.
 */
export const PermissionGrantSchema = CoreSchema.extend({
  organizationId: z.string(),
  principalType: PolicyPrincipalTypeSchema,
  principalId: z.string(),
  effect: PermissionEffectSchema,
  verb: PermissionVerbSchema,
  resourceType: PermissionResourceTypeSchema,
  resourceId: z.string().nullable(),
  condition: PermissionConditionSchema.nullable(),
});
export type PermissionGrant = z.infer<typeof PermissionGrantSchema>;

export class PermissionGrantModel extends CoreModel<PermissionGrant> {
  get schema() {
    return PermissionGrantSchema;
  }
  parse(): PermissionGrant {
    return this.schema.parse(this._model);
  }
  validate(): z.ZodSafeParseResult<PermissionGrant> {
    return this.schema.safeParse(this._model);
  }
}

export class PermissionGrantModelFactory extends ModelFactory<
  PermissionGrant,
  PermissionGrantModel
> {
  create(createdBy: string): PermissionGrantModel {
    return new PermissionGrantModel(
      this._coreModelFactory.create(createdBy).toJSON()
    );
  }
}

// ── PolicyAttachment ──────────────────────────────────────────────────

export const PolicyAttachmentSchema = CoreSchema.extend({
  organizationId: z.string(),
  policyId: z.string(),
  principalType: PolicyPrincipalTypeSchema,
  principalId: z.string(),
});
export type PolicyAttachment = z.infer<typeof PolicyAttachmentSchema>;

export class PolicyAttachmentModel extends CoreModel<PolicyAttachment> {
  get schema() {
    return PolicyAttachmentSchema;
  }
  parse(): PolicyAttachment {
    return this.schema.parse(this._model);
  }
  validate(): z.ZodSafeParseResult<PolicyAttachment> {
    return this.schema.safeParse(this._model);
  }
}

export class PolicyAttachmentModelFactory extends ModelFactory<
  PolicyAttachment,
  PolicyAttachmentModel
> {
  create(createdBy: string): PolicyAttachmentModel {
    return new PolicyAttachmentModel(
      this._coreModelFactory.create(createdBy).toJSON()
    );
  }
}

// ── Role ──────────────────────────────────────────────────────────────

export const RoleSchema = CoreSchema.extend({
  organizationId: z.string(),
  name: z.string().min(1),
  /** Stable, human-readable identifier (#622) — the key role assignment uses,
   *  decoupled from `name` so a rename never breaks existing assignments.
   *  System roles: `owner`/`admin`/`member`; custom: slugified from the name at
   *  creation. Unique per org. */
  slug: z.string().min(1),
  kind: RbacKindSchema,
});
export type Role = z.infer<typeof RoleSchema>;

export class RoleModel extends CoreModel<Role> {
  get schema() {
    return RoleSchema;
  }
  parse(): Role {
    return this.schema.parse(this._model);
  }
  validate(): z.ZodSafeParseResult<Role> {
    return this.schema.safeParse(this._model);
  }
}

export class RoleModelFactory extends ModelFactory<Role, RoleModel> {
  create(createdBy: string): RoleModel {
    return new RoleModel(this._coreModelFactory.create(createdBy).toJSON());
  }
}

// ── Group (a policy-attachment principal, #622) ───────────────────────

/**
 * An org-defined **group** (#622) — a named `policy_attachment` principal
 * alongside `user`/`role`. A member inherits the policies of every group they
 * belong to (via `user_group`). Always org-defined — groups carry no
 * `system`/`custom` kind (there are no system groups).
 */
export const GroupSchema = CoreSchema.extend({
  organizationId: z.string(),
  name: z.string().min(1),
  description: z.string().nullable(),
});
export type Group = z.infer<typeof GroupSchema>;

export class GroupModel extends CoreModel<Group> {
  get schema() {
    return GroupSchema;
  }
  parse(): Group {
    return this.schema.parse(this._model);
  }
  validate(): z.ZodSafeParseResult<Group> {
    return this.schema.safeParse(this._model);
  }
}

export class GroupModelFactory extends ModelFactory<Group, GroupModel> {
  create(createdBy: string): GroupModel {
    return new GroupModel(this._coreModelFactory.create(createdBy).toJSON());
  }
}

// ── UserGroup (the membership edge, #622) ─────────────────────────────

/** A user's membership in a group (#622). Unique per `(userId, groupId)`
 *  among live rows; a re-add is a no-op. */
export const UserGroupSchema = CoreSchema.extend({
  organizationId: z.string(),
  userId: z.string(),
  groupId: z.string(),
});
export type UserGroup = z.infer<typeof UserGroupSchema>;

export class UserGroupModel extends CoreModel<UserGroup> {
  get schema() {
    return UserGroupSchema;
  }
  parse(): UserGroup {
    return this.schema.parse(this._model);
  }
  validate(): z.ZodSafeParseResult<UserGroup> {
    return this.schema.safeParse(this._model);
  }
}

export class UserGroupModelFactory extends ModelFactory<
  UserGroup,
  UserGroupModel
> {
  create(createdBy: string): UserGroupModel {
    return new UserGroupModel(
      this._coreModelFactory.create(createdBy).toJSON()
    );
  }
}
