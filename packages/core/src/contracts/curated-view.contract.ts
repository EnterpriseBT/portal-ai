import { z } from "zod";

import { withShareableCapabilities } from "./capabilities.contract.js";

import { CuratedViewSchema } from "../models/curated-view.model.js";
import { FilterExpressionSchema } from "./filter.contract.js";
import {
  PaginatedResponsePayloadSchema,
  PaginationRequestQuerySchema,
} from "./pagination.contract.js";
import { ResolvedColumnSchema } from "./entity-record.contract.js";

// ── Enriched ──────────────────────────────────────────────────────────

/**
 * What every reader of a view may know about its definition (#680): whether
 * it has a row filter and whether it selects columns. A caller without write
 * on the view gets `filter: null` and only the projection ids they can read,
 * so these booleans are how the UI says "Filtered" / "N selected".
 */
const CuratedViewReaderFlags = {
  filtered: z.boolean(),
  projected: z.boolean(),
};

/** A curated view plus the ids of the field mappings in its projection
 *  (empty = unrestricted / all the entity's columns). For a caller without
 *  write on the view, `filter` is null and `fieldMappingIds` lists only the
 *  projection's field mappings they can read (#680). */
export const CuratedViewWithProjectionSchema = CuratedViewSchema.extend({
  fieldMappingIds: z.array(z.string()),
  ...CuratedViewReaderFlags,
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

/** A curated view enriched with its connector entity's display identifiers
 *  (#646) — `entity` is null when the entity is unresolvable (e.g. deleted).
 *  For a caller without write on the view, `filter` is null (#680). */
export const CuratedViewListItemSchema = CuratedViewSchema.extend({
  entity: z.object({ key: z.string(), label: z.string() }).nullable(),
  ...CuratedViewReaderFlags,
});

export type CuratedViewListItem = z.infer<typeof CuratedViewListItemSchema>;

export const CuratedViewListResponsePayloadSchema =
  PaginatedResponsePayloadSchema.extend({
    /** #688: each row carries the caller's capabilities on it. */
    curatedViews: z.array(withShareableCapabilities(CuratedViewListItemSchema)),
  });

export type CuratedViewListResponsePayload = z.infer<
  typeof CuratedViewListResponsePayloadSchema
>;

// ── Get ───────────────────────────────────────────────────────────────

export const CuratedViewGetResponsePayloadSchema = z.object({
  /** #688: with the caller's capabilities on the view. */
  curatedView: withShareableCapabilities(CuratedViewWithProjectionSchema),
});

export type CuratedViewGetResponsePayload = z.infer<
  typeof CuratedViewGetResponsePayloadSchema
>;

// ── Create ────────────────────────────────────────────────────────────

/** Reserved session-view identifiers a curated-view `key` must not collide
 *  with — the `_meta_*` introspection views + the fixed projection columns
 *  (#599). A view keyed one of these would clobber the agent's introspection
 *  when materialized as a temp view. */
const RESERVED_VIEW_KEYS = new Set([
  "_meta_entities",
  "_meta_columns",
  "_meta_column_catalog",
  "_record_id",
  "_connector_entity_id",
  "source_id",
]);

/** A curated-view `key` becomes a Postgres temp-view identifier (≤63 bytes),
 *  so it is length-capped and may not reuse a reserved/system name. */
export const CuratedViewKeySchema = z
  .string()
  .min(1)
  .max(63)
  .refine((k) => !k.startsWith("_meta_") && !RESERVED_VIEW_KEYS.has(k), {
    message:
      "Reserved key — must not be a _meta_* name, _record_id, _connector_entity_id, or source_id",
  });

// #745: an unknown key is a 400 naming it, not silently dropped.
export const CuratedViewCreateRequestBodySchema = z
  .object({
    connectorEntityId: z.string().min(1),
    key: CuratedViewKeySchema,
    label: z.string().min(1),
    description: z.string().nullable().optional(),
    /** A structured `FilterGroup` (filter.contract.ts); omit for no row filter. */
    filter: FilterExpressionSchema.nullable().optional(),
    /** The projection's field-mapping ids; omit/empty = unrestricted (all columns). */
    fieldMappingIds: z.array(z.string()).optional(),
  })
  .strict();

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

// #745: an unknown key is a 400 naming it, not silently dropped.
export const CuratedViewUpdateRequestBodySchema = z
  .object({
    label: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    filter: FilterExpressionSchema.nullable().optional(),
    fieldMappingIds: z.array(z.string()).optional(),
  })
  .strict();

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

// #745: an unknown key is a 400 naming it, not silently dropped.
export const CuratedViewAttachRequestBodySchema = z
  .object({
    stationId: z.string().min(1),
  })
  .strict();

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
  PaginationRequestQuerySchema.extend({
    /**
     * #678: a base64-encoded JSON FilterExpression (the entity records list's
     * format), ANDed after the view's own filter, so it can only narrow. Its
     * fields must be the caller's readable projected columns (normalizedKey);
     * anything else is a 400.
     */
    filters: z.string().optional(),
  });

export type CuratedViewRecordsRequestQuery = z.infer<
  typeof CuratedViewRecordsRequestQuerySchema
>;

export const CuratedViewRecordsResponsePayloadSchema =
  PaginatedResponsePayloadSchema.extend({
    /**
     * #678: the caller's readable projected columns, in the entity's field-mapping order (as the entity table), in
     * the entity records list's `ResolvedColumn` shape. This is the whole set
     * the detail table can show, sort, filter, reorder or hide. Headers are
     * `normalizedKey`, with `label · type` as the caption. A `sortBy` naming
     * none of them falls back to the stable record-id order; one naming an
     * unsortable type (json, arrays) is refused.
     */
    columns: z.array(ResolvedColumnSchema),
    /** Keyed by `normalizedKey`, plus `_record_id` and `_source_id`. */
    records: z.array(z.record(z.string(), z.unknown())),
  });

export type CuratedViewRecordsResponsePayload = z.infer<
  typeof CuratedViewRecordsResponsePayloadSchema
>;
