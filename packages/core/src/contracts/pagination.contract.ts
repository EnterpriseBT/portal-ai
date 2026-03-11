import { z } from "zod";

/**
 * Generic pagination query parameters for list endpoints.
 */
export const PaginationRequestQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  sortBy: z.string().default("created"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

export type PaginationRequestQuery = z.infer<typeof PaginationRequestQuerySchema>;

/**
 * Generic pagination metadata included in list responses.
 */
export const PaginatedResponsePayloadSchema = z.object({
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type PaginatedResponsePayload = z.infer<typeof PaginatedResponsePayloadSchema>;
