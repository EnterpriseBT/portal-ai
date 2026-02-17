import { z } from "zod";
import { BaseModelClass, BaseModelSchema, ModelFactory } from "./base.model.js";

/**
 * User profile database model.
 * Extends BaseModel with user-specific fields sourced from Auth0.
 *
 * Sync with the Drizzle `user_profiles` table is enforced at compile
 * time via `apps/api/src/db/schema/type-checks.ts` and at runtime
 * via drizzle-zod derived schemas in `apps/api/src/db/schema/zod.ts`.
 */
export const UserSchema = BaseModelSchema.extend({
  auth0Id: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  picture: z.string().nullable(),
});

export type User = z.infer<typeof UserSchema>;

export class UserModel extends BaseModelClass<User> {
  get schema() {
    return UserSchema;
  }
}

export class UserModelFactory extends ModelFactory<User, UserModel> {
  create(createdBy: string): UserModel {
    const baseModel = this._baseModelFactory.create(createdBy);
    const userModel = new UserModel(baseModel.toJSON());
    return userModel;
  }
}
