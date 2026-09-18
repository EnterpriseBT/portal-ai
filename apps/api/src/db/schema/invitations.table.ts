import { pgTable, text, bigint, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { ORG_ROLES, INVITATION_STATUSES } from "@portalai/core/models";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { users } from "./users.table.js";

/**
 * Organization invitations (#584) — an app-generated invite-link + accept-on-
 * login flow (no Auth0 Management API). One pending offer of membership at a
 * role, redeemable by hashed token.
 *
 * Indexes carry the invariants: one live **pending** invite per `(org, email)`
 * (resend rotates it), a unique live `token_hash` (the accept lookup key), and
 * an `(org, status)` index for the list/seat-count paths. The plaintext token
 * is never stored — only its sha256 (`token_hash`).
 *
 * Kept in sync with `InvitationSchema` in `@portalai/core` via `type-checks.ts`.
 */
export const invitations = pgTable(
  "invitations",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    email: text("email").notNull(),
    role: text("role", { enum: ORG_ROLES }).notNull(),
    tokenHash: text("token_hash").notNull(),
    status: text("status", { enum: INVITATION_STATUSES })
      .notNull()
      .default("pending"),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => users.id),
    acceptedByUserId: text("accepted_by_user_id").references(() => users.id),
    acceptedAt: bigint("accepted_at", { mode: "number" }),
  },
  (t) => [
    // One live pending invite per (org, email); resend rotates that row.
    uniqueIndex("invitations_org_email_pending_unique")
      .on(t.organizationId, t.email)
      .where(sql`${t.status} = 'pending' AND ${t.deleted} IS NULL`),
    // The accept lookup key.
    uniqueIndex("invitations_token_hash_unique")
      .on(t.tokenHash)
      .where(sql`${t.deleted} IS NULL`),
    // List + seat-count access path.
    index("invitations_org_status_idx").on(t.organizationId, t.status),
  ]
);
