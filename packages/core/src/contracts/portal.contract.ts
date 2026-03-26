import { z } from "zod";

import { PortalSchema } from "../models/portal.model.js";
import {
  PaginatedResponsePayloadSchema,
  PaginationRequestQuerySchema,
} from "./pagination.contract.js";

// ── List ──────────────────────────────────────────────────────────────

export const PortalListRequestQuerySchema =
  PaginationRequestQuerySchema.extend({
    stationId: z.string().optional(),
  });

export type PortalListRequestQuery = z.infer<
  typeof PortalListRequestQuerySchema
>;

export const PortalListResponsePayloadSchema =
  PaginatedResponsePayloadSchema.extend({
    portals: z.array(PortalSchema),
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

export const PortalGetResponsePayloadSchema = z.object({
  portal: PortalSchema,
  messages: z.array(PortalMessageResponseSchema),
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

// ── Pin Result ────────────────────────────────────────────────────────

export const PinResultBodySchema = z.object({
  portalId: z.string().min(1),
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
 * - `data-table` — row-set result from sql_query, detect_outliers, cluster
 * - `tool-call`  — CoreMessage tool-call part (persisted for multi-turn)
 * - `tool-result`— CoreMessage tool-result part (persisted for multi-turn)
 */
export const DataTableContentBlockSchema = z.object({
  type: z.literal("data-table"),
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
});

export type DataTableContentBlock = z.infer<typeof DataTableContentBlockSchema>;

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

export const PortalSSEEventSchema = z.discriminatedUnion("type", [
  DeltaEventSchema,
  ToolResultEventSchema,
  DoneEventSchema,
]);

export type PortalSSEEvent = z.infer<typeof PortalSSEEventSchema>;
