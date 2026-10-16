import { z } from "zod";

import {
  descriptionField,
  keyField,
  nameField,
} from "./text-limits.contract.js";

import { withCapabilities } from "./capabilities.contract.js";

import {
  ColumnDataTypeEnum,
  ColumnDefinitionSchema,
  GeoRoleSchema,
} from "../models/column-definition.model.js";
import {
  PaginatedResponsePayloadSchema,
  PaginationRequestQuerySchema,
} from "./pagination.contract.js";

// ── List ──────────────────────────────────────────────────────────────

export const ColumnDefinitionListRequestQuerySchema =
  PaginationRequestQuerySchema.extend({
    sortBy: z
      .enum(["key", "label", "type", "created"])
      .optional()
      .default("created"),
    type: z.string().optional(),
    system: z.enum(["true", "false"]).optional(),
  });

export type ColumnDefinitionListRequestQuery = z.infer<
  typeof ColumnDefinitionListRequestQuerySchema
>;

export const ColumnDefinitionListResponsePayloadSchema =
  PaginatedResponsePayloadSchema.extend({
    /** #688: each row with the caller's capabilities. */
    columnDefinitions: z.array(withCapabilities(ColumnDefinitionSchema)),
  });

export type ColumnDefinitionListResponsePayload = z.infer<
  typeof ColumnDefinitionListResponsePayloadSchema
>;

// ── Get ───────────────────────────────────────────────────────────────

export const ColumnDefinitionGetResponsePayloadSchema = z.object({
  columnDefinition: withCapabilities(ColumnDefinitionSchema),
});

export type ColumnDefinitionGetResponsePayload = z.infer<
  typeof ColumnDefinitionGetResponsePayloadSchema
>;

// ── Create ────────────────────────────────────────────────────────────

// #745: an unknown key is a 400 naming it, not silently dropped.
export const ColumnDefinitionCreateRequestBodySchema = z
  .object({
    key: keyField().regex(/^[a-z][a-z0-9_]*$/),
    label: nameField("Label"),
    type: ColumnDataTypeEnum,
    description: descriptionField().nullable().optional().default(null),
    validationPattern: z.string().nullable().optional().default(null),
    validationMessage: descriptionField("Validation message")
      .nullable()
      .optional()
      .default(null),
    canonicalFormat: z.string().nullable().optional().default(null),
    geoRole: GeoRoleSchema.nullable().optional().default(null),
  })
  .strict();

export type ColumnDefinitionCreateRequestBody = z.infer<
  typeof ColumnDefinitionCreateRequestBodySchema
>;

export const ColumnDefinitionCreateResponsePayloadSchema = z.object({
  columnDefinition: ColumnDefinitionSchema,
});

export type ColumnDefinitionCreateResponsePayload = z.infer<
  typeof ColumnDefinitionCreateResponsePayloadSchema
>;

// ── Update ────────────────────────────────────────────────────────────

// #745: an unknown key is a 400 naming it, not silently dropped.
export const ColumnDefinitionUpdateRequestBodySchema = z
  .object({
    label: nameField("Label").optional(),
    type: ColumnDataTypeEnum.optional(),
    description: descriptionField().nullable().optional(),
    validationPattern: z.string().nullable().optional(),
    validationMessage: descriptionField("Validation message")
      .nullable()
      .optional(),
    canonicalFormat: z.string().nullable().optional(),
    geoRole: GeoRoleSchema.nullable().optional(),
  })
  .strict();

export type ColumnDefinitionUpdateRequestBody = z.infer<
  typeof ColumnDefinitionUpdateRequestBodySchema
>;

export const ColumnDefinitionUpdateResponsePayloadSchema = z.object({
  columnDefinition: ColumnDefinitionSchema,
  warnings: z.array(z.string()).optional(),
});

export type ColumnDefinitionUpdateResponsePayload = z.infer<
  typeof ColumnDefinitionUpdateResponsePayloadSchema
>;

// ── Impact ───────────────────────────────────────────────────────────

export const ColumnDefinitionImpactResponsePayloadSchema = z.object({
  fieldMappings: z.number(),
  refFieldMappings: z.number(),
  entityRecords: z.number(),
});

export type ColumnDefinitionImpactResponsePayload = z.infer<
  typeof ColumnDefinitionImpactResponsePayloadSchema
>;

// ── Delete ───────────────────────────────────────────────────────────

export const ColumnDefinitionDeleteResponsePayloadSchema = z.object({
  id: z.string(),
});

export type ColumnDefinitionDeleteResponsePayload = z.infer<
  typeof ColumnDefinitionDeleteResponsePayloadSchema
>;
