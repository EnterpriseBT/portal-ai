import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * User–Role assignment (#620) — the many-to-many join replacing the single
 * `organization_users.role` enum. A user holds any number of roles per org; the
 * engine (#598) resolves the **union** of their policies. Org-scoped: `roleId`
 * references an org's `roles` row, and `organizationId` is denormalized so
 * `loadSet` gathers a user's roles by `(userId, organizationId)` directly.
 *
 * Unique `(userId, organizationId, roleId)` (a role can't be assigned twice);
 * sync with the Drizzle `user_role` table is enforced via `type-checks.ts`.
 */
export const UserRoleSchema = CoreSchema.extend({
  userId: z.string(),
  organizationId: z.string(),
  roleId: z.string(),
});

export type UserRole = z.infer<typeof UserRoleSchema>;

export class UserRoleModel extends CoreModel<UserRole> {
  get schema() {
    return UserRoleSchema;
  }
  parse(): UserRole {
    return this.schema.parse(this._model);
  }
  validate(): z.ZodSafeParseResult<UserRole> {
    return this.schema.safeParse(this._model);
  }
}

export class UserRoleModelFactory extends ModelFactory<
  UserRole,
  UserRoleModel
> {
  create(createdBy: string): UserRoleModel {
    return new UserRoleModel(this._coreModelFactory.create(createdBy).toJSON());
  }
}
