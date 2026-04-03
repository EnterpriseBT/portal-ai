import { z } from "zod";

/**
 * Base API response schema — discriminated by `success`.
 */
export const ApiResponseSchema = z.object({
  success: z.boolean(),
});

export type ApiResponse = z.infer<typeof ApiResponseSchema>;

/**
 * Generic API success response.
 * Usage: `ApiSuccessSchema(MyPayloadSchema)`
 */
export const ApiSuccessSchema = <T extends z.ZodType>(payloadSchema: T) =>
  z.object({
    success: z.literal(true),
    payload: payloadSchema,
  });

export type ApiSuccessResponse<P> = {
  success: true;
  payload: P;
};

/**
 * API error response.
 */
export const ApiErrorSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  code: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type ApiErrorResponse = z.infer<typeof ApiErrorSchema>;
