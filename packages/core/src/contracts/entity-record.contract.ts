import { z } from "zod";

import { ColumnDataTypeEnum } from "../models/column-definition.model.js";
import { EntityRecordSchema } from "../models/entity-record.model.js";
import { PaginatedResponsePayloadSchema, PaginationRequestQuerySchema } from "./pagination.contract.js";

// ── Column summary (returned alongside record rows) ─────────────────

export const ColumnDefinitionSummarySchema = z.object({
  key: z.string(),
  label: z.string(),
  type: ColumnDataTypeEnum,
  required: z.boolean(),
  enumValues: z.array(z.string()).nullable(),
  defaultValue: z.string().nullable(),
  validationPattern: z.string().nullable(),
  canonicalFormat: z.string().nullable(),
});

export type ColumnDefinitionSummary = z.infer<typeof ColumnDefinitionSummarySchema>;

// ── List records ────────────────────────────────────────────────────

export const EntityRecordListRequestQuerySchema = PaginationRequestQuerySchema.extend({
  columns: z.string().optional(),
  /** Base64-encoded JSON string containing a FilterExpression. Decoded and validated at the API layer. */
  filters: z.string().optional(),
  /** Filter by validation status. Query params are strings; parsed to boolean in the router. */
  isValid: z.enum(["true", "false"]).optional(),
});

export type EntityRecordListRequestQuery = z.infer<typeof EntityRecordListRequestQuerySchema>;

export const EntityRecordListResponsePayloadSchema = PaginatedResponsePayloadSchema.extend({
  records: z.array(EntityRecordSchema),
  columns: z.array(ColumnDefinitionSummarySchema),
  source: z.enum(["cache", "live"]),
});

export type EntityRecordListResponsePayload = z.infer<typeof EntityRecordListResponsePayloadSchema>;

// ── Count records ───────────────────────────────────────────────────

export const EntityRecordCountResponsePayloadSchema = z.object({
  total: z.number(),
});

export type EntityRecordCountResponsePayload = z.infer<typeof EntityRecordCountResponsePayloadSchema>;

// ── Bulk import ─────────────────────────────────────────────────────

export const EntityRecordImportRowSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  normalizedData: z.record(z.string(), z.unknown()),
  sourceId: z.string(),
  checksum: z.string(),
});

export const EntityRecordImportRequestBodySchema = z.object({
  records: z.array(EntityRecordImportRowSchema).min(1),
});

export type EntityRecordImportRequestBody = z.infer<typeof EntityRecordImportRequestBodySchema>;

export const EntityRecordImportResponsePayloadSchema = z.object({
  created: z.number(),
  updated: z.number(),
  unchanged: z.number(),
});

export type EntityRecordImportResponsePayload = z.infer<typeof EntityRecordImportResponsePayloadSchema>;

// ── Sync ────────────────────────────────────────────────────────────

export const EntityRecordSyncResponsePayloadSchema = z.object({
  created: z.number(),
  updated: z.number(),
  unchanged: z.number(),
  errors: z.number(),
});

export type EntityRecordSyncResponsePayload = z.infer<typeof EntityRecordSyncResponsePayloadSchema>;

// ── Get single record ────────────────────────────────────────────────

export const EntityRecordGetResponsePayloadSchema = z.object({
  record: EntityRecordSchema,
  columns: z.array(ColumnDefinitionSummarySchema),
});

export type EntityRecordGetResponsePayload = z.infer<typeof EntityRecordGetResponsePayloadSchema>;

// ── Delete single record ────────────────────────────────────────────

export const EntityRecordDeleteOneResponsePayloadSchema = z.object({
  id: z.string(),
});

export type EntityRecordDeleteOneResponsePayload = z.infer<typeof EntityRecordDeleteOneResponsePayloadSchema>;

// ── Update single record ────────────────────────────────────────────

export const EntityRecordPatchRequestBodySchema = z.object({
  data: z.record(z.string(), z.unknown()).optional(),
  normalizedData: z.record(z.string(), z.unknown()).optional(),
});

export type EntityRecordPatchRequestBody = z.infer<typeof EntityRecordPatchRequestBodySchema>;

export const EntityRecordPatchResponsePayloadSchema = z.object({
  record: EntityRecordSchema,
});

export type EntityRecordPatchResponsePayload = z.infer<typeof EntityRecordPatchResponsePayloadSchema>;

// ── Create single record ─────────────────────────────────────────────

export const EntityRecordCreateRequestBodySchema = z.object({
  normalizedData: z.record(z.string(), z.unknown()),
  sourceId: z.string().optional(),
});

export type EntityRecordCreateRequestBody = z.infer<typeof EntityRecordCreateRequestBodySchema>;

export const EntityRecordCreateResponsePayloadSchema = z.object({
  record: EntityRecordSchema,
});

export type EntityRecordCreateResponsePayload = z.infer<typeof EntityRecordCreateResponsePayloadSchema>;

// ── Delete (clear) ──────────────────────────────────────────────────

export const EntityRecordDeleteResponsePayloadSchema = z.object({
  deleted: z.number(),
});

export type EntityRecordDeleteResponsePayload = z.infer<typeof EntityRecordDeleteResponsePayloadSchema>;
