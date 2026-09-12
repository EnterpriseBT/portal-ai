import { pgTable, text, jsonb, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { AUDIT_ACTIONS } from "@portalai/core/models";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";

/**
 * Security audit log (#575) — one append-only row per security-relevant
 * action (logins, org/member changes, credential create/update/use, secret
 * rotation, data export/delete).
 *
 * Append-only, no idempotency key: duplicate rows are acceptable for an audit
 * trail (a retried login webhook producing two `auth.login` rows is accurate,
 * not a bug) — unlike the billing ledger's `tool_call_id` dedup. Tamper-
 * evidence is enforced two ways: the repository surfaces no update/delete
 * method, and the migration `REVOKE`s UPDATE/DELETE on this table from the
 * app role. Retained past org soft-delete (#197) — the org-delete is itself
 * audited — and purged only by the retention job past
 * `AUDIT_LOG_RETENTION_MONTHS`.
 *
 * Kept in sync with `AuditLogEntrySchema` in `@portalai/core` via
 * `type-checks.ts`.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    // The actor — user id, or the system id for system-initiated events.
    userId: text("user_id").notNull(),
    action: text("action", { enum: AUDIT_ACTIONS }).notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    outcome: text("outcome", { enum: ["success", "failure"] }).notNull(),
    sourceIp: text("source_ip"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (t) => [
    // The list read's access path — scope + sort key + id tiebreaker (#433).
    index("audit_log_org_created_idx").on(t.organizationId, t.created, t.id),
    check(
      "audit_log_outcome_check",
      sql`${t.outcome} IN ('success', 'failure')`
    ),
  ]
);
