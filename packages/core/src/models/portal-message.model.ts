import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Portal Message model.
 * Represents an individual message in a portal chat session.
 *
 * Sync with the Drizzle `portal_messages` table is enforced at
 * compile time via `apps/api/src/db/schema/type-checks.ts` and at
 * runtime via drizzle-zod derived schemas in
 * `apps/api/src/db/schema/zod.ts`.
 */
export const PortalMessageRoleSchema = z.enum(["user", "assistant"]);

export type PortalMessageRole = z.infer<typeof PortalMessageRoleSchema>;

export const PortalMessageSchema = CoreSchema.extend({
  portalId: z.string(),
  organizationId: z.string(),
  role: PortalMessageRoleSchema,
  blocks: z.array(z.record(z.string(), z.unknown())),
});

export type PortalMessage = z.infer<typeof PortalMessageSchema>;

export class PortalMessageModel extends CoreModel<PortalMessage> {
  get schema() {
    return PortalMessageSchema;
  }

  parse(): PortalMessage {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<PortalMessage> {
    return this.schema.safeParse(this._model);
  }
}

export class PortalMessageModelFactory extends ModelFactory<
  PortalMessage,
  PortalMessageModel
> {
  create(createdBy: string): PortalMessageModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const portalMessageModel = new PortalMessageModel(baseModel.toJSON());
    return portalMessageModel;
  }
}
