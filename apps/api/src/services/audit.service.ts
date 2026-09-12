import {
  AuditLogEntryModelFactory,
  type AuditAction,
  type AuditOutcome,
} from "@portalai/core/models";

import { auditLogRepo } from "../db/repositories/audit-log.repository.js";
import type { AuditLogInsert } from "../db/schema/zod.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "audit-service" });

/**
 * A running count of audit writes that failed. This is the durable
 * degradation marker (#575 D1/§7): fail-open means a failed write is a
 * *detectable* gap, never a silent drop. Exposed for a metrics/health surface
 * to read; the `error` log carries the per-event detail.
 */
let auditWriteFailures = 0;
export const getAuditWriteFailureCount = (): number => auditWriteFailures;

/** A security event to record. `outcome` defaults to "success"; the target,
 *  request context, and metadata are all optional (a login has no target). */
export interface AuditEvent {
  organizationId: string;
  /** The actor — user id, or the system id for system-initiated events. */
  userId: string;
  action: AuditAction;
  outcome?: AuditOutcome;
  targetType?: string | null;
  targetId?: string | null;
  sourceIp?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

export class AuditService {
  /**
   * Record a security event. **Fail-open**: this never throws into the
   * caller. Call it *after* the audited action has committed — an audit-write
   * failure must not roll back or block the action it records. A failure is
   * logged at `error` and counted (`getAuditWriteFailureCount`), so the gap is
   * detectable rather than silent.
   */
  static async record(event: AuditEvent): Promise<void> {
    try {
      const row = new AuditLogEntryModelFactory()
        .create(event.userId)
        .update({
          organizationId: event.organizationId,
          userId: event.userId,
          action: event.action,
          outcome: event.outcome ?? "success",
          targetType: event.targetType ?? null,
          targetId: event.targetId ?? null,
          sourceIp: event.sourceIp ?? null,
          userAgent: event.userAgent ?? null,
          metadata: event.metadata ?? null,
        })
        .parse();

      await auditLogRepo.append(row as AuditLogInsert);
    } catch (err) {
      auditWriteFailures += 1;
      logger.error(
        {
          err,
          action: event.action,
          organizationId: event.organizationId,
          auditWriteFailures,
        },
        "Audit write failed — trail gap (fail-open, action not blocked)"
      );
    }
  }
}
