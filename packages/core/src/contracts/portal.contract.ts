import { z } from "zod";

import { PortalSchema } from "../models/portal.model.js";
import { PortalResultSchema, PortalResultTypeSchema, type PortalResultType } from "../models/portal-result.model.js";
import {
  PaginatedResponsePayloadSchema,
  PaginationRequestQuerySchema,
} from "./pagination.contract.js";

// ── List ──────────────────────────────────────────────────────────────

export const PortalListRequestQuerySchema =
  PaginationRequestQuerySchema.extend({
    stationId: z.string().optional(),
    include: z.string().optional(),
  });

export type PortalListRequestQuery = z.infer<
  typeof PortalListRequestQuerySchema
>;

const PortalWithIncludesSchema = PortalSchema.extend({
  stationName: z.string().optional(),
});

export type PortalWithIncludes = z.infer<typeof PortalWithIncludesSchema>;

export const PortalListResponsePayloadSchema =
  PaginatedResponsePayloadSchema.extend({
    portals: z.array(PortalWithIncludesSchema),
  });

export type PortalListResponsePayload = z.infer<
  typeof PortalListResponsePayloadSchema
>;

// ── Get ───────────────────────────────────────────────────────────────

export const PortalMessageBlockSchema = z.object({
  type: z.string(),
  content: z.unknown(),
});

export type PortalMessageBlock = z.infer<typeof PortalMessageBlockSchema>;

export const PortalMessageResponseSchema = z.object({
  id: z.string(),
  portalId: z.string(),
  organizationId: z.string(),
  role: z.enum(["user", "assistant"]),
  blocks: z.array(PortalMessageBlockSchema),
  created: z.number(),
});

export type PortalMessageResponse = z.infer<
  typeof PortalMessageResponseSchema
>;

// ── Get ───────────────────────────────────────────────────────────────

export const PortalGetRequestQuerySchema = z.object({
  include: z.string().optional(),
});

export type PortalGetRequestQuery = z.infer<typeof PortalGetRequestQuerySchema>;

/**
 * Lightweight pin-status entry returned when `include=pinnedResults`.
 * Maps a specific message block to its portal-result ID so the UI can
 * show filled pin icons and trigger unpins without a separate query.
 */
export const PinnedBlockEntrySchema = z.object({
  messageId: z.string(),
  blockIndex: z.number().int().min(0),
  portalResultId: z.string(),
});

export type PinnedBlockEntry = z.infer<typeof PinnedBlockEntrySchema>;

export const PortalGetResponsePayloadSchema = z.object({
  portal: PortalSchema,
  messages: z.array(PortalMessageResponseSchema),
  pinnedBlocks: z.array(PinnedBlockEntrySchema).optional(),
});

export type PortalGetResponsePayload = z.infer<
  typeof PortalGetResponsePayloadSchema
>;

// ── Create ────────────────────────────────────────────────────────────

export const CreatePortalBodySchema = z.object({
  stationId: z.string().min(1),
});

export type CreatePortalBody = z.infer<typeof CreatePortalBodySchema>;

export const PortalCreateResponsePayloadSchema = z.object({
  portal: PortalSchema,
});

export type PortalCreateResponsePayload = z.infer<
  typeof PortalCreateResponsePayloadSchema
>;

// ── Send Message ──────────────────────────────────────────────────────

export const SendMessageBodySchema = z.object({
  message: z.string().min(1),
});

export type SendMessageBody = z.infer<typeof SendMessageBodySchema>;

// ── Portal Result List ────────────────────────────────────────────────

export const PortalResultListRequestQuerySchema =
  PortalListRequestQuerySchema.extend({
    portalId: z.string().optional(),
  });

export type PortalResultListRequestQuery = z.infer<
  typeof PortalResultListRequestQuerySchema
>;

const PortalResultWithIncludesSchema = PortalResultSchema.extend({
  portalName: z.string().nullable().optional(),
});

export type PortalResultWithIncludes = z.infer<
  typeof PortalResultWithIncludesSchema
>;

// ── Pin Result ────────────────────────────────────────────────────────

export const PinResultBodySchema = z.object({
  portalId: z.string().min(1),
  messageId: z.string().min(1).optional(),
  blockIndex: z.number().int().min(0),
  name: z.string().min(1),
});

export type PinResultBody = z.infer<typeof PinResultBodySchema>;

// ── Content Block Types ───────────────────────────────────────────────

/**
 * Typed content block discriminants that can appear in `blocks`.
 *
 * - `text`       — markdown narrative
 * - `vega-lite`  — Vega-Lite chart spec
 * - `vega`       — Full Vega spec (trees, networks, maps, force-directed graphs)
 * - `data-table` — row-set result from sql_query, detect_outliers, cluster
 * - `tool-call`  — CoreMessage tool-call part (persisted for multi-turn)
 * - `tool-result`— CoreMessage tool-result part (persisted for multi-turn)
 */
export const PortalBlockTypeSchema = z.enum([
  "text",
  "vega-lite",
  "vega",
  "data-table",
  "mutation-result",
  "tool-call",
  "tool-result",
]);

export type PortalBlockType = z.infer<typeof PortalBlockTypeSchema>;

/**
 * Block types that can be pinned as portal results.
 * Derived from `PortalResultTypeSchema` so that the model enum is the
 * single source of truth for both frontend and backend.
 */
export const PINNABLE_BLOCK_TYPES: ReadonlySet<PortalResultType> = new Set(
  PortalResultTypeSchema.options
);

export const DataTableContentBlockSchema = z.object({
  type: z.literal("data-table"),
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
});

export type DataTableContentBlock = z.infer<typeof DataTableContentBlockSchema>;

/**
 * A single mutated entity. Used for both variants below.
 */
export const MutationItemSchema = z.object({
  entityId: z.string(),
  summary: z.record(z.string(), z.unknown()).optional(),
});

export type MutationItem = z.infer<typeof MutationItemSchema>;

export const MutationOperationSchema = z.enum(["created", "updated", "deleted"]);

export type MutationOperation = z.infer<typeof MutationOperationSchema>;

/**
 * Mutation-result content block.
 *
 * A discriminated union over cardinality:
 *
 * - `item` present   → a single entity was mutated. Use `item.entityId` and
 *                      optionally `item.summary` to describe what changed.
 * - `items` present  → multiple entities were mutated. `count` matches
 *                      `items.length` (≥ 2).
 *
 * Exactly one of `item` / `items` is present, so display logic can
 * branch unambiguously. There is no free-floating top-level summary —
 * per-entity detail always lives under the item it describes.
 */
export const SingleMutationResultContentBlockSchema = z.object({
  type: z.literal("mutation-result"),
  operation: MutationOperationSchema,
  entity: z.string(),
  item: MutationItemSchema,
});

export type SingleMutationResultContentBlock = z.infer<
  typeof SingleMutationResultContentBlockSchema
>;

export const BulkMutationResultContentBlockSchema = z.object({
  type: z.literal("mutation-result"),
  operation: MutationOperationSchema,
  entity: z.string(),
  count: z.number().int().min(2),
  items: z.array(MutationItemSchema).min(2),
});

export type BulkMutationResultContentBlock = z.infer<
  typeof BulkMutationResultContentBlockSchema
>;

export const MutationResultContentBlockSchema = z.union([
  SingleMutationResultContentBlockSchema,
  BulkMutationResultContentBlockSchema,
]);

export type MutationResultContentBlock = z.infer<typeof MutationResultContentBlockSchema>;

export function isBulkMutationResult(
  block: MutationResultContentBlock,
): block is BulkMutationResultContentBlock {
  return "items" in block;
}

// ── SSE Event Payloads ────────────────────────────────────────────────

export const DeltaEventSchema = z.object({
  type: z.literal("delta"),
  content: z.string(),
});

export type DeltaEvent = z.infer<typeof DeltaEventSchema>;

export const ToolResultEventSchema = z.object({
  type: z.literal("tool_result"),
  toolName: z.string(),
  result: z.unknown(),
});

export type ToolResultEvent = z.infer<typeof ToolResultEventSchema>;

export const DoneEventSchema = z.object({
  type: z.literal("done"),
  portalId: z.string(),
  messageId: z.string(),
});

export type DoneEvent = z.infer<typeof DoneEventSchema>;

export const StreamErrorEventSchema = z.object({
  type: z.literal("stream_error"),
  message: z.string(),
});

export type StreamErrorEvent = z.infer<typeof StreamErrorEventSchema>;

export const PortalSSEEventSchema = z.discriminatedUnion("type", [
  DeltaEventSchema,
  ToolResultEventSchema,
  DoneEventSchema,
  StreamErrorEventSchema,
]);

export type PortalSSEEvent = z.infer<typeof PortalSSEEventSchema>;
