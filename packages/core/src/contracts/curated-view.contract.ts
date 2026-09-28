import { z } from "zod";

import { CuratedViewSchema } from "../models/curated-view.model.js";
import { FilterExpressionSchema } from "./filter.contract.js";
import {
  PaginatedResponsePayloadSchema,
  PaginationRequestQuerySchema,
} from "./pagination.contract.js";

// ── Enriched ──────────────────────────────────────────────────────────

/** A curated view plus the ids of the field mappings in its projection
 *  (empty = unrestricted / all the entity's columns). */
export const CuratedViewWithProjectionSchema = CuratedViewSchema.extend({
  fieldMappingIds: z.array(z.string()),
});

export type CuratedViewWithProjection = z.infer<
  typeof CuratedViewWithProjectionSchema
>;

// ── List ──────────────────────────────────────────────────────────────

export const CuratedViewListRequestQuerySchema =
  PaginationRequestQuerySchema.extend({
    search: z.string().optional(),
    sortBy: z.enum(["label", "key", "created"]).optional().default("created"),
    include: z.string().optional(),
    connectorEntityId: z.string().optional(),
    /** Restrict to the curated views attached to this station (#599). */
    stationId: z.string().optional(),
  });

export type CuratedViewListRequestQuery = z.infer<
  typeof CuratedViewListRequestQuerySchema
>;

export const CuratedViewListResponsePayloadSchema =
  PaginatedResponsePayloadSchema.extend({
    curatedViews: z.array(CuratedViewSchema),
  });

export type CuratedViewListResponsePayload = z.infer<
  typeof CuratedViewListResponsePayloadSchema
>;

// ── Get ───────────────────────────────────────────────────────────────

export const CuratedViewGetResponsePayloadSchema = z.object({
  curatedView: CuratedViewWithProjectionSchema,
});

export type CuratedViewGetResponsePayload = z.infer<
  typeof CuratedViewGetResponsePayloadSchema
>;

// ── Create ────────────────────────────────────────────────────────────

export const CuratedViewCreateRequestBodySchema = z.object({
  connectorEntityId: z.string().min(1),
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().nullable().optional(),
  /** A structured `FilterGroup` (filter.contract.ts); omit for no row filter. */
  filter: FilterExpressionSchema.nullable().optional(),
  /** The projection's field-mapping ids; omit/empty = unrestricted (all columns). */
  fieldMappingIds: z.array(z.string()).optional(),
});

export type CuratedViewCreateRequestBody = z.infer<
  typeof CuratedViewCreateRequestBodySchema
>;

export const CuratedViewCreateResponsePayloadSchema = z.object({
  curatedView: CuratedViewSchema,
});

export type CuratedViewCreateResponsePayload = z.infer<
  typeof CuratedViewCreateResponsePayloadSchema
>;

// ── Update ────────────────────────────────────────────────────────────

export const CuratedViewUpdateRequestBodySchema = z.object({
  label: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  filter: FilterExpressionSchema.nullable().optional(),
  fieldMappingIds: z.array(z.string()).optional(),
});

export type CuratedViewUpdateRequestBody = z.infer<
  typeof CuratedViewUpdateRequestBodySchema
>;

export const CuratedViewUpdateResponsePayloadSchema = z.object({
  curatedView: CuratedViewSchema,
});

export type CuratedViewUpdateResponsePayload = z.infer<
  typeof CuratedViewUpdateResponsePayloadSchema
>;

// ── Delete ────────────────────────────────────────────────────────────

export const CuratedViewDeleteResponsePayloadSchema = z.object({
  id: z.string(),
  cascaded: z.object({
    fieldMappings: z.number(),
    stationViews: z.number(),
    grants: z.number(),
  }),
});

export type CuratedViewDeleteResponsePayload = z.infer<
  typeof CuratedViewDeleteResponsePayloadSchema
>;

// ── Attach / detach (station_views) ───────────────────────────────────

export const CuratedViewAttachRequestBodySchema = z.object({
  stationId: z.string().min(1),
});

export type CuratedViewAttachRequestBody = z.infer<
  typeof CuratedViewAttachRequestBodySchema
>;

export const CuratedViewAttachResponsePayloadSchema = z.object({
  stationId: z.string(),
  curatedViewId: z.string(),
});

export type CuratedViewAttachResponsePayload = z.infer<
  typeof CuratedViewAttachResponsePayloadSchema
>;

// ── Records ───────────────────────────────────────────────────────────

export const CuratedViewRecordsRequestQuerySchema =
  PaginationRequestQuerySchema.extend({});

export type CuratedViewRecordsRequestQuery = z.infer<
  typeof CuratedViewRecordsRequestQuerySchema
>;

export const CuratedViewRecordsResponsePayloadSchema =
  PaginatedResponsePayloadSchema.extend({
    records: z.array(z.record(z.string(), z.unknown())),
  });

export type CuratedViewRecordsResponsePayload = z.infer<
  typeof CuratedViewRecordsResponsePayloadSchema
>;
