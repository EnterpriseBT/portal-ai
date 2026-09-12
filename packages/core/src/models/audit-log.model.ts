import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Security audit log entry (#575) — one append-only row per security-relevant
 * action: logins, org/member changes, connector-credential create/update/use,
 * toolpack secret rotation, data export/delete. The tamper-evident trail a
 * SOC 2 reviewer (and an org owner) reads to answer "who did what, to what,
 * from where, and did it succeed".
 *
 * Distinct from the tool-usage ledger (#179), which is billing itemization.
 * Append-only with no update/delete path — enforced at the repository (no
 * mutating methods) and at the DB (a `REVOKE UPDATE, DELETE` in the
 * migration). Emission is fail-open: a failed write never blocks the audited
 * action (see `AuditService`).
 *
 * Sync with the Drizzle `audit_log` table is enforced at compile time via
 * `apps/api/src/db/schema/type-checks.ts`.
 */

/** The closed set of audited actions. A typed union so the read filter and
 *  every emission site key off the same contract (discovery D3). */
export const AUDIT_ACTIONS = [
  "auth.login",
  "org.create",
  "org.delete",
  "member.add",
  "member.remove",
  "member.switch",
  "connector.credential.create",
  "connector.credential.update",
  "connector.credential.access",
  "toolpack.secret.rotate",
  "data.export",
  "data.delete",
] as const;

export const AuditActionSchema = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AuditOutcomeSchema = z.enum(["success", "failure"]);
export type AuditOutcome = z.infer<typeof AuditOutcomeSchema>;

export const AuditLogEntrySchema = CoreSchema.extend({
  organizationId: z.string(),
  /** The actor — the user who performed the action, or the system id for
   *  system-initiated events. Mirrors `createdBy` for user actions. */
  userId: z.string(),
  action: AuditActionSchema,
  /** What the action targeted (e.g. "organization", "connector_instance",
   *  "toolpack", "user"). Null for actions with no distinct target. */
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  outcome: AuditOutcomeSchema,
  /** The real client IP (requires `trust proxy`); null when unavailable
   *  (e.g. a login webhook that did not forward the end-user's IP). */
  sourceIp: z.string().nullable(),
  userAgent: z.string().nullable(),
  /** A free-form structured detail bag. Mirrors the connector-instances
   *  `config` jsonb column for dual-schema compatibility. */
  metadata: z.record(z.string(), z.unknown()).nullable(),
});

export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

export class AuditLogEntryModel extends CoreModel<AuditLogEntry> {
  get schema() {
    return AuditLogEntrySchema;
  }

  parse(): AuditLogEntry {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<AuditLogEntry> {
    return this.schema.safeParse(this._model);
  }
}

export class AuditLogEntryModelFactory extends ModelFactory<
  AuditLogEntry,
  AuditLogEntryModel
> {
  create(createdBy: string): AuditLogEntryModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    return new AuditLogEntryModel(baseModel.toJSON());
  }
}
