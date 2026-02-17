/**
 * Zod schemas derived from Drizzle table definitions via drizzle-zod.
 *
 * These are the single source of truth for database-layer validation.
 * Compile-time assertions in `./type-checks.ts` ensure that the
 * hand-written Zod schemas in `@mcp-ui/core` stay in sync with these.
 */
import { createSelectSchema, createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { userProfiles } from "./user-profiles.table.js";

// ── User Profiles ───────────────────────────────────────────────────

/** Zod schema for a `user_profiles` row returned by SELECT. */
export const UserProfileSelectSchema = createSelectSchema(userProfiles);

/** Zod schema for inserting into `user_profiles`. */
export const UserProfileInsertSchema = createInsertSchema(userProfiles);

/** Inferred types */
export type UserProfileSelect = z.infer<typeof UserProfileSelectSchema>;
export type UserProfileInsert = z.infer<typeof UserProfileInsertSchema>;
