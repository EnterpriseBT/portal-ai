import { z } from "zod";

import { ColumnDataTypeEnum, ColumnDefinitionSchema } from "../models/column-definition.model.js";
import { PaginatedResponsePayloadSchema, PaginationRequestQuerySchema } from "./pagination.contract.js";

// ── List ──────────────────────────────────────────────────────────────

export const ColumnDefinitionListRequestQuerySchema = PaginationRequestQuerySchema.extend({
  type: z.string().optional(),
  required: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

export type ColumnDefinitionListRequestQuery = z.infer<typeof ColumnDefinitionListRequestQuerySchema>;

export const ColumnDefinitionListResponsePayloadSchema = PaginatedResponsePayloadSchema.extend({
  columnDefinitions: z.array(ColumnDefinitionSchema),
});

export type ColumnDefinitionListResponsePayload = z.infer<typeof ColumnDefinitionListResponsePayloadSchema>;

// ── Get ───────────────────────────────────────────────────────────────

export const ColumnDefinitionGetResponsePayloadSchema = z.object({
  columnDefinition: ColumnDefinitionSchema,
});

export type ColumnDefinitionGetResponsePayload = z.infer<typeof ColumnDefinitionGetResponsePayloadSchema>;

// ── Create ────────────────────────────────────────────────────────────

export const ColumnDefinitionCreateRequestBodySchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1),
  type: ColumnDataTypeEnum,
  required: z.boolean().optional().default(false),
  defaultValue: z.string().nullable().optional().default(null),
  format: z.string().nullable().optional().default(null),
  enumValues: z.array(z.string()).nullable().optional().default(null),
  description: z.string().nullable().optional().default(null),
});

export type ColumnDefinitionCreateRequestBody = z.infer<typeof ColumnDefinitionCreateRequestBodySchema>;

export const ColumnDefinitionCreateResponsePayloadSchema = z.object({
  columnDefinition: ColumnDefinitionSchema,
});

export type ColumnDefinitionCreateResponsePayload = z.infer<typeof ColumnDefinitionCreateResponsePayloadSchema>;

// ── Update ────────────────────────────────────────────────────────────

export const ColumnDefinitionUpdateRequestBodySchema = z.object({
  label: z.string().min(1).optional(),
  type: ColumnDataTypeEnum.optional(),
  required: z.boolean().optional(),
  defaultValue: z.string().nullable().optional(),
  format: z.string().nullable().optional(),
  enumValues: z.array(z.string()).nullable().optional(),
  description: z.string().nullable().optional(),
});

export type ColumnDefinitionUpdateRequestBody = z.infer<typeof ColumnDefinitionUpdateRequestBodySchema>;

export const ColumnDefinitionUpdateResponsePayloadSchema = z.object({
  columnDefinition: ColumnDefinitionSchema,
  warnings: z.array(z.string()).optional(),
});

export type ColumnDefinitionUpdateResponsePayload = z.infer<typeof ColumnDefinitionUpdateResponsePayloadSchema>;

// ── Impact ───────────────────────────────────────────────────────────

export const ColumnDefinitionImpactResponsePayloadSchema = z.object({
  fieldMappings: z.number(),
  refFieldMappings: z.number(),
  entityRecords: z.number(),
});

export type ColumnDefinitionImpactResponsePayload = z.infer<typeof ColumnDefinitionImpactResponsePayloadSchema>;

// ── Delete ───────────────────────────────────────────────────────────

export const ColumnDefinitionDeleteResponsePayloadSchema = z.object({
  id: z.string(),
});

export type ColumnDefinitionDeleteResponsePayload = z.infer<typeof ColumnDefinitionDeleteResponsePayloadSchema>;
