import { z } from "zod";

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

export const StationListResponsePayloadSchema =
  PaginatedResponsePayloadSchema.extend({
    stations: z.array(StationSchema),
  });

export type StationListResponsePayload = z.infer<
  typeof StationListResponsePayloadSchema
>;

// ── Get ───────────────────────────────────────────────────────────────

export const StationGetResponsePayloadSchema = z.object({
  station: StationSchema,
});

export type StationGetResponsePayload = z.infer<
  typeof StationGetResponsePayloadSchema
>;

// ── Create ────────────────────────────────────────────────────────────

export const CreateStationBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  connectorInstanceIds: z.array(z.string()).optional(),
});

export type CreateStationBody = z.infer<typeof CreateStationBodySchema>;

export const StationCreateResponsePayloadSchema = z.object({
  station: StationSchema,
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
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "At least one field must be provided",
  });

export type UpdateStationBody = z.infer<typeof UpdateStationBodySchema>;

export const StationUpdateResponsePayloadSchema = z.object({
  station: StationSchema,
});

export type StationUpdateResponsePayload = z.infer<
  typeof StationUpdateResponsePayloadSchema
>;
