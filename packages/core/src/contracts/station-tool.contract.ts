import { z } from "zod";

import { OrganizationToolSchema } from "../models/organization-tool.model.js";
import { StationToolSchema } from "../models/station-tool.model.js";
import {
  PaginatedResponsePayloadSchema,
  PaginationRequestQuerySchema,
} from "./pagination.contract.js";

// ── List ──────────────────────────────────────────────────────────────

export const StationToolListRequestQuerySchema =
  PaginationRequestQuerySchema.extend({});

export type StationToolListRequestQuery = z.infer<
  typeof StationToolListRequestQuerySchema
>;

export const StationToolWithDefinitionSchema = StationToolSchema.extend({
  organizationTool: OrganizationToolSchema,
});

export type StationToolWithDefinition = z.infer<
  typeof StationToolWithDefinitionSchema
>;

export const StationToolListResponsePayloadSchema =
  PaginatedResponsePayloadSchema.extend({
    stationTools: z.array(StationToolWithDefinitionSchema),
  });

export type StationToolListResponsePayload = z.infer<
  typeof StationToolListResponsePayloadSchema
>;

// ── Assign ────────────────────────────────────────────────────────────

export const AssignStationToolBodySchema = z.object({
  organizationToolId: z.string().min(1),
});

export type AssignStationToolBody = z.infer<typeof AssignStationToolBodySchema>;

export const StationToolAssignResponsePayloadSchema = z.object({
  stationTool: StationToolSchema,
});

export type StationToolAssignResponsePayload = z.infer<
  typeof StationToolAssignResponsePayloadSchema
>;
