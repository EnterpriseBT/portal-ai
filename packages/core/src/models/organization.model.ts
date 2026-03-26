import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Organization database model.
 * Extends CoreModel with organization-specific fields.
 *
 * Sync with the Drizzle `organizations` table is enforced at compile
 * time via `apps/api/src/db/schema/type-checks.ts` and at runtime
 * via drizzle-zod derived schemas in `apps/api/src/db/schema/zod.ts`.
 */
export const OrganizationSchema = CoreSchema.extend({
  name: z.string(),
  timezone: z.string(),
  ownerUserId: z.string(), // ID of the user who owns this organization
  defaultStationId: z.string().nullable().default(null),
});

export type Organization = z.infer<typeof OrganizationSchema>;

export class OrganizationModel extends CoreModel<Organization> {
  get schema() {
    return OrganizationSchema;
  }

  parse(): Organization {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<Organization> {
    return this.schema.safeParse(this._model);
  }
}

export class OrganizationModelFactory extends ModelFactory<
  Organization,
  OrganizationModel
> {
  create(createdBy: string): OrganizationModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const organizationModel = new OrganizationModel(baseModel.toJSON());
    return organizationModel;
  }
}
