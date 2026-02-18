import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

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
