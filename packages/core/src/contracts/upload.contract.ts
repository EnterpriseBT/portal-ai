import { z } from "zod";

import { JobSchema } from "../models/job.model.js";

// --- Request Schemas ---

export const PresignFileSchema = z.object({
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().positive(),
});
export type PresignFile = z.infer<typeof PresignFileSchema>;

export const PresignRequestBodySchema = z.object({
  organizationId: z.string(),
  connectorDefinitionId: z.string(),
  files: z.array(PresignFileSchema).min(1),
});
export type PresignRequestBody = z.infer<typeof PresignRequestBodySchema>;

export const ProcessRequestParamsSchema = z.object({
  jobId: z.string(),
});
export type ProcessRequestParams = z.infer<typeof ProcessRequestParamsSchema>;

// --- Response Schemas ---

export const PresignUploadItemSchema = z.object({
  fileName: z.string(),
  s3Key: z.string(),
  presignedUrl: z.string(),
  expiresIn: z.number(),
});
export type PresignUploadItem = z.infer<typeof PresignUploadItemSchema>;

export const PresignResponsePayloadSchema = z.object({
  jobId: z.string(),
  uploads: z.array(PresignUploadItemSchema),
});
export type PresignResponsePayload = z.infer<typeof PresignResponsePayloadSchema>;

export const ProcessResponsePayloadSchema = z.object({
  job: JobSchema,
});
export type ProcessResponsePayload = z.infer<typeof ProcessResponsePayloadSchema>;
