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

// ── Users ─────────────────────────────────────────────────────────────

/** Zod schema for a `users` row returned by SELECT. */
export const UserSelectSchema = createSelectSchema(users);

/** Zod schema for inserting into `users`. */
export const UserInsertSchema = createInsertSchema(users);

/** Inferred types */
export type UserSelect = z.infer<typeof UserSelectSchema>;
export type UserInsert = z.infer<typeof UserInsertSchema>;
