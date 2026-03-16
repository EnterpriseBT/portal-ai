import { z } from "zod";

import { FieldMappingSchema } from "../models/field-mapping.model.js";
import { PaginatedResponsePayloadSchema, PaginationRequestQuerySchema } from "./pagination.contract.js";

// ── List ──────────────────────────────────────────────────────────────

export const FieldMappingListRequestQuerySchema = PaginationRequestQuerySchema.extend({
  connectorEntityId: z.string(),
  columnDefinitionId: z.string().optional(),
});

export type FieldMappingListRequestQuery = z.infer<typeof FieldMappingListRequestQuerySchema>;

export const FieldMappingListResponsePayloadSchema = PaginatedResponsePayloadSchema.extend({
  fieldMappings: z.array(FieldMappingSchema),
});

export type FieldMappingListResponsePayload = z.infer<typeof FieldMappingListResponsePayloadSchema>;

// ── Get ───────────────────────────────────────────────────────────────

export const FieldMappingGetResponsePayloadSchema = z.object({
  fieldMapping: FieldMappingSchema,
});

export type FieldMappingGetResponsePayload = z.infer<typeof FieldMappingGetResponsePayloadSchema>;

// ── Create ────────────────────────────────────────────────────────────

export const FieldMappingCreateRequestBodySchema = z.object({
  connectorEntityId: z.string(),
  columnDefinitionId: z.string(),
  sourceField: z.string().min(1),
  isPrimaryKey: z.boolean().optional().default(false),
});

export type FieldMappingCreateRequestBody = z.infer<typeof FieldMappingCreateRequestBodySchema>;

export const FieldMappingCreateResponsePayloadSchema = z.object({
  fieldMapping: FieldMappingSchema,
});

export type FieldMappingCreateResponsePayload = z.infer<typeof FieldMappingCreateResponsePayloadSchema>;

// ── Update ────────────────────────────────────────────────────────────

export const FieldMappingUpdateRequestBodySchema = z.object({
  sourceField: z.string().min(1).optional(),
  isPrimaryKey: z.boolean().optional(),
});

export type FieldMappingUpdateRequestBody = z.infer<typeof FieldMappingUpdateRequestBodySchema>;

export const FieldMappingUpdateResponsePayloadSchema = z.object({
  fieldMapping: FieldMappingSchema,
});

export type FieldMappingUpdateResponsePayload = z.infer<typeof FieldMappingUpdateResponsePayloadSchema>;
