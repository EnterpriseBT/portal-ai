import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * The per-membership role (#576). Seeded, fixed set — the authorization
 * baseline every `PermissionService` check starts from:
 * - `owner`  — the org creator; allow everything (billing + org delete are
 *   owner-exclusive).
 * - `admin`  — everything an owner can, minus billing and org delete.
 * - `member` — createdBy-scoped; widened later by object grants (#598).
 *
 * A required field with no default: every membership-creation site sets it
 * explicitly (owner → `owner`, all others → `member`). Kept required rather
 * than defaulted so a new creation site that forgets it fails loudly at
 * `parse()` instead of silently minting a `member`.
 */
export const ORG_ROLES = ["owner", "admin", "member"] as const;
export const OrgRoleSchema = z.enum(ORG_ROLES);
export type OrgRole = z.infer<typeof OrgRoleSchema>;

/**
 * The highest-privilege role in a set (owner > admin > member), or `member` when
 * empty. #620 transitional: the single scalar `role` on responses is derived
 * from the caller's `roles[]` via this while the FE migrates to `capabilities`;
 * it is **not** an authorization heuristic (the engine unions all roles' policies).
 */
export function highestRole(roles: readonly OrgRole[]): OrgRole {
  if (roles.includes("owner")) return "owner";
  if (roles.includes("admin")) return "admin";
  return "member";
}

/**
 * Organization–User join model (many-to-many).
 * Extends CoreModel with foreign-key references to both tables.
 *
 * Sync with the Drizzle `organization_users` table is enforced at
 * compile time via `apps/api/src/db/schema/type-checks.ts` and at
 * runtime via drizzle-zod derived schemas in
 * `apps/api/src/db/schema/zod.ts`.
 */
export const OrganizationUserSchema = CoreSchema.extend({
  organizationId: z.string(),
  userId: z.string(),
  role: OrgRoleSchema,
  lastLogin: z.number().nullable(),
});

export type OrganizationUser = z.infer<typeof OrganizationUserSchema>;

export class OrganizationUserModel extends CoreModel<OrganizationUser> {
  get schema() {
    return OrganizationUserSchema;
  }

  parse(): OrganizationUser {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<OrganizationUser> {
    return this.schema.safeParse(this._model);
  }
}

export class OrganizationUserModelFactory extends ModelFactory<
  OrganizationUser,
  OrganizationUserModel
> {
  create(createdBy: string): OrganizationUserModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const organizationUserModel = new OrganizationUserModel(baseModel.toJSON());
    return organizationUserModel;
  }
}
