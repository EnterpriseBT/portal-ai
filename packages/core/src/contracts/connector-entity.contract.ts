import { z } from "zod";

import { ConnectorEntitySchema } from "../models/connector-entity.model.js";
import { PaginatedResponsePayloadSchema, PaginationRequestQuerySchema } from "./pagination.contract.js";

// ── List ──────────────────────────────────────────────────────────────

export const ConnectorEntityListRequestQuerySchema = PaginationRequestQuerySchema.extend({
  connectorInstanceId: z.string().optional(),
});

export type ConnectorEntityListRequestQuery = z.infer<typeof ConnectorEntityListRequestQuerySchema>;

export const ConnectorEntityListResponsePayloadSchema = PaginatedResponsePayloadSchema.extend({
  connectorEntities: z.array(ConnectorEntitySchema),
});

export type ConnectorEntityListResponsePayload = z.infer<typeof ConnectorEntityListResponsePayloadSchema>;

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
