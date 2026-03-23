import { z } from "zod";

import { ColumnDefinitionSchema } from "../models/column-definition.model.js";
import { ConnectorEntitySchema } from "../models/connector-entity.model.js";
import { ConnectorInstanceSchema } from "../models/connector-instance.model.js";
import { FieldMappingSchema } from "../models/field-mapping.model.js";
import { PaginatedResponsePayloadSchema, PaginationRequestQuerySchema } from "./pagination.contract.js";

// ── Enriched schemas (entity + nested field mappings + column defs) ──

export const FieldMappingWithColumnDefinitionSchema = FieldMappingSchema.extend({
  columnDefinition: ColumnDefinitionSchema.nullable(),
});

export type FieldMappingWithColumnDefinition = z.infer<typeof FieldMappingWithColumnDefinitionSchema>;

export const ConnectorEntityWithMappingsSchema = ConnectorEntitySchema.extend({
  fieldMappings: z.array(FieldMappingWithColumnDefinitionSchema),
});

export type ConnectorEntityWithMappings = z.infer<typeof ConnectorEntityWithMappingsSchema>;

// ── Enriched schema (entity + connector instance name) ───────────────

export const ConnectorEntityWithInstanceSchema = ConnectorEntitySchema.extend({
  connectorInstance: ConnectorInstanceSchema,
});

export type ConnectorEntityWithInstance = z.infer<typeof ConnectorEntityWithInstanceSchema>;

// ── List ──────────────────────────────────────────────────────────────

export const ConnectorEntityListRequestQuerySchema = PaginationRequestQuerySchema.extend({
  connectorInstanceId: z.string().optional(),
  include: z.enum(["fieldMappings", "connectorInstance", "tags"]).optional(),
  tagIds: z.string().optional(),
});

export type ConnectorEntityListRequestQuery = z.infer<typeof ConnectorEntityListRequestQuerySchema>;

export const ConnectorEntityListResponsePayloadSchema = PaginatedResponsePayloadSchema.extend({
  connectorEntities: z.array(ConnectorEntitySchema),
});

export type ConnectorEntityListResponsePayload = z.infer<typeof ConnectorEntityListResponsePayloadSchema>;

export const ConnectorEntityListWithMappingsResponsePayloadSchema = PaginatedResponsePayloadSchema.extend({
  connectorEntities: z.array(ConnectorEntityWithMappingsSchema),
});

export type ConnectorEntityListWithMappingsResponsePayload = z.infer<typeof ConnectorEntityListWithMappingsResponsePayloadSchema>;

export const ConnectorEntityListWithInstanceResponsePayloadSchema = PaginatedResponsePayloadSchema.extend({
  connectorEntities: z.array(ConnectorEntityWithInstanceSchema),
});

export type ConnectorEntityListWithInstanceResponsePayload = z.infer<typeof ConnectorEntityListWithInstanceResponsePayloadSchema>;

// ── Get ───────────────────────────────────────────────────────────────

export const ConnectorEntityGetResponsePayloadSchema = z.object({
  connectorEntity: ConnectorEntitySchema,
});

export type ConnectorEntityGetResponsePayload = z.infer<typeof ConnectorEntityGetResponsePayloadSchema>;

// ── Create ────────────────────────────────────────────────────────────

export const ConnectorEntityCreateRequestBodySchema = z.object({
  connectorInstanceId: z.string(),
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1),
});

export type ConnectorEntityCreateRequestBody = z.infer<typeof ConnectorEntityCreateRequestBodySchema>;

export const ConnectorEntityCreateResponsePayloadSchema = z.object({
  connectorEntity: ConnectorEntitySchema,
});

export type ConnectorEntityCreateResponsePayload = z.infer<typeof ConnectorEntityCreateResponsePayloadSchema>;
