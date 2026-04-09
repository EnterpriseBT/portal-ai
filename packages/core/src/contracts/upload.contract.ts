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

// --- Confirm Schemas ---

export const ConfirmColumnSchema = z.object({
  sourceField: z.string(),
  existingColumnDefinitionId: z.string(),
  normalizedKey: z.string().regex(/^[a-z][a-z0-9_]*$/),
  format: z.string().nullable(),
  isPrimaryKey: z.boolean(),
  required: z.boolean(),
  defaultValue: z.string().nullable().optional(),
  enumValues: z.array(z.string()).nullable().optional(),
  // Reference fields (populated when type === "reference")
  refEntityKey: z.string().nullable().optional(),
  refNormalizedKey: z.string().nullable().optional(),
});
export type ConfirmColumn = z.infer<typeof ConfirmColumnSchema>;

export const ConfirmEntitySchema = z.object({
  entityKey: z.string(),
  entityLabel: z.string(),
  sourceFileName: z.string(),
  columns: z.array(ConfirmColumnSchema).min(1),
});
export type ConfirmEntity = z.infer<typeof ConfirmEntitySchema>;

export const ConfirmRequestBodySchema = z.object({
  connectorInstanceName: z.string().min(1),
  entities: z.array(ConfirmEntitySchema).min(1),
});
export type ConfirmRequestBody = z.infer<typeof ConfirmRequestBodySchema>;

export const ConfirmResponseEntitySchema = z.object({
  connectorEntityId: z.string(),
  entityKey: z.string(),
  entityLabel: z.string(),
  columnDefinitions: z.array(z.object({
    id: z.string(),
    key: z.string(),
    label: z.string(),
  })),
  fieldMappings: z.array(z.object({
    id: z.string(),
    sourceField: z.string(),
    columnDefinitionId: z.string(),
    isPrimaryKey: z.boolean(),
    normalizedKey: z.string(),
  })),
  importResult: z.object({
    created: z.number(),
    updated: z.number(),
    unchanged: z.number(),
    invalid: z.number(),
  }).optional(),
});
export type ConfirmResponseEntity = z.infer<typeof ConfirmResponseEntitySchema>;

export const ConfirmResponsePayloadSchema = z.object({
  connectorInstanceId: z.string(),
  connectorInstanceName: z.string(),
  confirmedEntities: z.array(ConfirmResponseEntitySchema),
});
export type ConfirmResponsePayload = z.infer<typeof ConfirmResponsePayloadSchema>;
