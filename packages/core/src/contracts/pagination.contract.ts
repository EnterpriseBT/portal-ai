import { z } from "zod";

/**
 * Generic pagination query parameters for list endpoints.
 */
export const PaginationRequestQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).optional().default(20).transform((v) => Math.min(v, 100)),
  offset: z.coerce.number().int().min(0).optional().default(0),
  sortBy: z.string().optional().default("created"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("asc"),
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
