import { z } from "zod";

import { ConnectorEntitySchema } from "../models/connector-entity.model.js";
import { FieldMappingSchema } from "../models/field-mapping.model.js";
import { FieldMappingWithColumnDefinitionSchema } from "./connector-entity.contract.js";
import { PaginatedResponsePayloadSchema, PaginationRequestQuerySchema } from "./pagination.contract.js";

// ── Enriched schemas ─────────────────────────────────────────────────

export const FieldMappingWithConnectorEntitySchema = FieldMappingSchema.extend({
  connectorEntity: ConnectorEntitySchema.nullable(),
});

export type FieldMappingWithConnectorEntity = z.infer<typeof FieldMappingWithConnectorEntitySchema>;

// ── List ──────────────────────────────────────────────────────────────

export const FieldMappingListRequestQuerySchema = PaginationRequestQuerySchema.extend({
  connectorEntityId: z.string().optional(),
  columnDefinitionId: z.string().optional(),
  include: z.string().optional(),
});

export type FieldMappingListRequestQuery = z.infer<typeof FieldMappingListRequestQuerySchema>;

export const FieldMappingListResponsePayloadSchema = PaginatedResponsePayloadSchema.extend({
  fieldMappings: z.array(FieldMappingSchema),
});

export type FieldMappingListResponsePayload = z.infer<typeof FieldMappingListResponsePayloadSchema>;

export const FieldMappingListWithConnectorEntityResponsePayloadSchema = PaginatedResponsePayloadSchema.extend({
  fieldMappings: z.array(FieldMappingWithConnectorEntitySchema),
});

export type FieldMappingListWithConnectorEntityResponsePayload = z.infer<typeof FieldMappingListWithConnectorEntityResponsePayloadSchema>;

export const FieldMappingListWithColumnDefinitionResponsePayloadSchema = PaginatedResponsePayloadSchema.extend({
  fieldMappings: z.array(FieldMappingWithColumnDefinitionSchema),
});

export type FieldMappingListWithColumnDefinitionResponsePayload = z.infer<typeof FieldMappingListWithColumnDefinitionResponsePayloadSchema>;

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
  refColumnDefinitionId: z.string().nullable().optional().default(null),
  refEntityKey: z.string().nullable().optional().default(null),
  refBidirectionalFieldMappingId: z.string().nullable().optional().default(null),
});

export type FieldMappingCreateRequestBody = z.infer<typeof FieldMappingCreateRequestBodySchema>;

export const FieldMappingCreateResponsePayloadSchema = z.object({
  fieldMapping: FieldMappingSchema,
});

export type FieldMappingCreateResponsePayload = z.infer<typeof FieldMappingCreateResponsePayloadSchema>;

// ── Update ────────────────────────────────────────────────────────────

export const FieldMappingUpdateRequestBodySchema = z.object({
  sourceField: z.string().min(1),
  isPrimaryKey: z.boolean().optional(),
  columnDefinitionId: z.string(),
  refBidirectionalFieldMappingId: z.string().nullable().optional(),
});

export type FieldMappingUpdateRequestBody = z.infer<typeof FieldMappingUpdateRequestBodySchema>;

export const FieldMappingUpdateResponsePayloadSchema = z.object({
  fieldMapping: FieldMappingSchema,
});

export type FieldMappingUpdateResponsePayload = z.infer<typeof FieldMappingUpdateResponsePayloadSchema>;

// ── Delete ───────────────────────────────────────────────────────────

export const FieldMappingDeleteResponsePayloadSchema = z.object({
  id: z.string(),
  cascaded: z.object({
    entityGroupMembers: z.number(),
  }),
});

export type FieldMappingDeleteResponsePayload = z.infer<typeof FieldMappingDeleteResponsePayloadSchema>;

// ── Impact ───────────────────────────────────────────────────────────

export const FieldMappingImpactResponsePayloadSchema = z.object({
  entityGroupMembers: z.number(),
});

export type FieldMappingImpactResponsePayload = z.infer<typeof FieldMappingImpactResponsePayloadSchema>;

// ── Bidirectional Validation ──────────────────────────────────────────

export const FieldMappingBidirectionalValidationResponsePayloadSchema = z.object({
  isConsistent: z.boolean().nullable(),
  inconsistentRecordIds: z.array(z.string()),
  totalChecked: z.number(),
  reason: z.string().optional(),
});

export type FieldMappingBidirectionalValidationResponsePayload = z.infer<typeof FieldMappingBidirectionalValidationResponsePayloadSchema>;
