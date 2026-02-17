import { z } from "zod";

/**
 * Base schema for all database models.
 *
 * Every persisted entity extends this schema which provides standard
 * audit fields for tracking creation, modification, and soft-deletion.
 *
 * Sync with the Drizzle table columns is enforced at compile time
 * via `apps/api/src/db/schema/type-checks.ts`.
 */
export const BaseModelSchema = z.object({
  id: z.string(),
  created: z.number(),
  createdBy: z.string(),
  updated: z.number().nullable(),
  updatedBy: z.string().nullable(),
  deleted: z.number().nullable(),
  deletedBy: z.string().nullable(),
});

export type BaseModel = z.infer<typeof BaseModelSchema>;
