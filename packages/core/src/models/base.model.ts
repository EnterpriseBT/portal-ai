import { z } from "zod";

/**
 * Base schema for all database models.
 *
 * Every persisted entity extends this schema which provides standard
 * audit fields for tracking creation, modification, and soft-deletion.
 */
export const BaseModelSchema = z.object({
  id: z.string(),
  created: z.number(),
  createdBy: z.string(),
  updated: z.number().optional(),
  updatedBy: z.string().optional(),
  deleted: z.number().optional(),
  deletedBy: z.string().optional(),
});

export type BaseModel = z.infer<typeof BaseModelSchema>;
