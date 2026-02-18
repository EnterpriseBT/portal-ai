import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * User profile database model.
 * Extends BaseModel with user-specific fields sourced from Auth0.
 *
 * Sync with the Drizzle `user_profiles` table is enforced at compile
 * time via `apps/api/src/db/schema/type-checks.ts` and at runtime
 * via drizzle-zod derived schemas in `apps/api/src/db/schema/zod.ts`.
 */
export const UserSchema = CoreSchema.extend({
  auth0Id: z.string(), // Auth0 user ID (e.g., "auth0|1234567890")
  email: z.string().nullable(),
  name: z.string().nullable(),
  picture: z.string().nullable(),
});

export type User = z.infer<typeof UserSchema>;

export class UserModel extends CoreModel<User> {
  get schema() {
    return UserSchema;
  }

  parse(): User {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<User> {
    return this.schema.safeParse(this._model);
  }
}

export class UserModelFactory extends ModelFactory<User, UserModel> {
  create(createdBy: string): UserModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const userModel = new UserModel(baseModel.toJSON());
    return userModel;
  }
}
