import { z } from "zod";

import { ConnectorInstanceSchema } from "../models/connector-instance.model.js";
import { StationInstanceSchema } from "../models/station-instance.model.js";
import { StationSchema } from "../models/station.model.js";
import {
  PaginatedResponsePayloadSchema,
  PaginationRequestQuerySchema,
} from "./pagination.contract.js";

// ── List ──────────────────────────────────────────────────────────────

export const StationListRequestQuerySchema =
  PaginationRequestQuerySchema.extend({
    search: z.string().optional(),
    include: z.string().optional(),
  });

export type StationListRequestQuery = z.infer<
  typeof StationListRequestQuerySchema
>;

/** Station with its enabled toolpack slugs (from the include=toolpacks join). */
export const StationWithToolpacksSchema = StationSchema.extend({
  enabledToolpacks: z.array(z.string()).optional(),
});

export type StationWithToolpacks = z.infer<typeof StationWithToolpacksSchema>;

export const StationListResponsePayloadSchema =
  PaginatedResponsePayloadSchema.extend({
    stations: z.array(StationWithToolpacksSchema),
  });

export type StationListResponsePayload = z.infer<
  typeof StationListResponsePayloadSchema
>;

// ── Get ───────────────────────────────────────────────────────────────

export const StationGetRequestQuerySchema = z.object({
  include: z.string().optional(),
});

export type StationGetRequestQuery = z.infer<
  typeof StationGetRequestQuerySchema
>;

/** Station instance with its attached connector instance details. */
export const StationInstanceWithConnectorInstanceSchema =
  StationInstanceSchema.extend({
    connectorInstance: ConnectorInstanceSchema.optional(),
  });

export type StationInstanceWithConnectorInstance = z.infer<
  typeof StationInstanceWithConnectorInstanceSchema
>;

export const StationGetResponsePayloadSchema = z.object({
  station: StationWithToolpacksSchema.extend({
    instances: z.array(StationInstanceWithConnectorInstanceSchema).optional(),
  }),
});

export type StationGetResponsePayload = z.infer<
  typeof StationGetResponsePayloadSchema
>;

// ── Create ────────────────────────────────────────────────────────────

export const CreateStationBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  connectorInstanceIds: z.array(z.string()).optional(),
  toolPacks: z.array(z.string()).min(1).optional(),
});

export type CreateStationBody = z.infer<typeof CreateStationBodySchema>;

export const StationCreateResponsePayloadSchema = z.object({
  station: StationWithToolpacksSchema,
});

export type StationCreateResponsePayload = z.infer<
  typeof StationCreateResponsePayloadSchema
>;

// ── Update ────────────────────────────────────────────────────────────

export const UpdateStationBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    connectorInstanceIds: z.array(z.string()).optional(),
    toolPacks: z.array(z.string()).min(1).optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "At least one field must be provided",
  });

export type UpdateStationBody = z.infer<typeof UpdateStationBodySchema>;

export const StationUpdateResponsePayloadSchema = z.object({
  station: StationWithToolpacksSchema,
});

export type StationUpdateResponsePayload = z.infer<
  typeof StationUpdateResponsePayloadSchema
>;
