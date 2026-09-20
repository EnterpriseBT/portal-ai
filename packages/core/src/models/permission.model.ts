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

/** The action verb. `*` is the wildcard (FullAccess). */
export const PERMISSION_VERBS = [
  "read",
  "write",
  "delete",
  "share",
  "manage",
  "invite",
  "*",
] as const;
export const PermissionVerbSchema = z.enum(PERMISSION_VERBS);
export type PermissionVerb = z.infer<typeof PermissionVerbSchema>;

/** The object class a statement targets. `*` is any type. */
export const PERMISSION_RESOURCE_TYPES = [
  "station",
  "pin",
  "view",
  "portal",
  "entity",
  "entity_record",
  "field_mapping",
  "connector_instance",
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

/** A policy/role is `system` (immutable, seeded) or `custom` (org-defined). */
export const RBAC_KINDS = ["system", "custom"] as const;
export const RbacKindSchema = z.enum(RBAC_KINDS);
export type RbacKind = z.infer<typeof RbacKindSchema>;

/** The principals a policy can attach to. `group` is added in #622. */
export const POLICY_PRINCIPAL_TYPES = ["user", "role"] as const;
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
