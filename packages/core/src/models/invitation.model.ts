import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";
import { OrgRoleSchema } from "./organization-user.model.js";

/**
 * Organization invitation (#584) — a pending offer of membership in an org at a
 * given role, redeemable via an app-generated link (no Auth0 Management API).
 *
 * Lifecycle: `pending → accepted`, plus `revoked` (owner/admin rescinds) and
 * `expired` (past `expiresAt`; enforced lazily — a pending row past its expiry
 * simply cannot be accepted and does not count toward the seat cap). The
 * plaintext token is a bearer capability: only its **sha256 hash** is stored
 * (`tokenHash`); the link is returned to the caller once and never persisted.
 *
 * Sync with the Drizzle `invitations` table is enforced at compile time via
 * `apps/api/src/db/schema/type-checks.ts` and at runtime via drizzle-zod
 * schemas in `apps/api/src/db/schema/zod.ts`.
 */
export const INVITATION_STATUSES = [
  "pending",
  "accepted",
  "revoked",
  "expired",
] as const;
export const InvitationStatusSchema = z.enum(INVITATION_STATUSES);
export type InvitationStatus = z.infer<typeof InvitationStatusSchema>;

export const InvitationSchema = CoreSchema.extend({
  organizationId: z.string(),
  /** Normalized (lower-cased) invitee email. */
  email: z.string(),
  /** The role the invitee receives on acceptance. Never `owner`. */
  role: OrgRoleSchema,
  /** sha256 hex of the plaintext invite token — the stored capability. */
  tokenHash: z.string(),
  status: InvitationStatusSchema,
  /** Epoch ms; a pending invite past this cannot be accepted. */
  expiresAt: z.number(),
  invitedByUserId: z.string(),
  acceptedByUserId: z.string().nullable(),
  acceptedAt: z.number().nullable(),
});

export type Invitation = z.infer<typeof InvitationSchema>;

export class InvitationModel extends CoreModel<Invitation> {
  get schema() {
    return InvitationSchema;
  }

  parse(): Invitation {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<Invitation> {
    return this.schema.safeParse(this._model);
  }
}

export class InvitationModelFactory extends ModelFactory<
  Invitation,
  InvitationModel
> {
  create(createdBy: string): InvitationModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    return new InvitationModel(baseModel.toJSON());
  }
}
