import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Organization Tool model.
 * Represents a custom webhook-based tool definition scoped to an
 * organization. Tools are assigned to stations via the `station_tools`
 * join table.
 *
 * Sync with the Drizzle `organization_tools` table is enforced at
 * compile time via `apps/api/src/db/schema/type-checks.ts` and at
 * runtime via drizzle-zod derived schemas in
 * `apps/api/src/db/schema/zod.ts`.
 */
export const OrganizationToolImplementationSchema = z.object({
  type: z.literal("webhook"),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
});

export type OrganizationToolImplementation = z.infer<
  typeof OrganizationToolImplementationSchema
>;

export const OrganizationToolSchema = CoreSchema.extend({
  organizationId: z.string(),
  name: z.string().min(1),
  description: z.string().nullable(),
  parameterSchema: z.record(z.string(), z.unknown()),
  implementation: OrganizationToolImplementationSchema,
});

export type OrganizationTool = z.infer<typeof OrganizationToolSchema>;

export class OrganizationToolModel extends CoreModel<OrganizationTool> {
  get schema() {
    return OrganizationToolSchema;
  }

  parse(): OrganizationTool {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<OrganizationTool> {
    return this.schema.safeParse(this._model);
  }
}

export class OrganizationToolModelFactory extends ModelFactory<
  OrganizationTool,
  OrganizationToolModel
> {
  create(createdBy: string): OrganizationToolModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const organizationToolModel = new OrganizationToolModel(
      baseModel.toJSON()
    );
    return organizationToolModel;
  }
}
