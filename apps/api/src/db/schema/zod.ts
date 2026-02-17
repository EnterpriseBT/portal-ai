/**
 * Zod schemas derived from Drizzle table definitions via drizzle-zod.
 *
 * These are the single source of truth for database-layer validation.
 * Compile-time assertions in `./type-checks.ts` ensure that the
 * hand-written Zod schemas in `@mcp-ui/core` stay in sync with these.
 */
import { createSelectSchema, createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users.table.js";
import { organizations } from "./organizations.table.js";
import { organizationUsers } from "./organization-users.table.js";

// ── Users ─────────────────────────────────────────────────────────────

/** Zod schema for a `users` row returned by SELECT. */
export const UserSelectSchema = createSelectSchema(users);

/** Zod schema for inserting into `users`. */
export const UserInsertSchema = createInsertSchema(users);

/** Inferred types */
export type UserSelect = z.infer<typeof UserSelectSchema>;
export type UserInsert = z.infer<typeof UserInsertSchema>;

// ── Organizations ─────────────────────────────────────────────────────

/** Zod schema for an `organizations` row returned by SELECT. */
export const OrganizationSelectSchema = createSelectSchema(organizations);

/** Zod schema for inserting into `organizations`. */
export const OrganizationInsertSchema = createInsertSchema(organizations);

/** Inferred types */
export type OrganizationSelect = z.infer<typeof OrganizationSelectSchema>;
export type OrganizationInsert = z.infer<typeof OrganizationInsertSchema>;

// ── Organization Users ────────────────────────────────────────────────

/** Zod schema for an `organization_users` row returned by SELECT. */
export const OrganizationUserSelectSchema =
  createSelectSchema(organizationUsers);

/** Zod schema for inserting into `organization_users`. */
export const OrganizationUserInsertSchema =
  createInsertSchema(organizationUsers);

/** Inferred types */
export type OrganizationUserSelect = z.infer<
  typeof OrganizationUserSelectSchema
>;
export type OrganizationUserInsert = z.infer<
  typeof OrganizationUserInsertSchema
>;
