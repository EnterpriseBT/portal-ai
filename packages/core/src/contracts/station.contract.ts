import { z } from "zod";

import { ConnectorInstanceSchema } from "../models/connector-instance.model.js";
import { CuratedViewSchema } from "../models/curated-view.model.js";
import { StationInstanceSchema } from "../models/station-instance.model.js";
import { StationSchema } from "../models/station.model.js";
import { StationViewSchema } from "../models/station-view.model.js";
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

/**
 * Station instance with its attached connector instance details. #674: every
 * attachment is returned, readable or not; `canRead` says whether the caller
 * can read the connector (an unreadable one renders as a locked chip, with
 * its real name).
 */
export const StationInstanceWithConnectorInstanceSchema =
  StationInstanceSchema.extend({
    connectorInstance: ConnectorInstanceSchema.optional(),
    canRead: z.boolean(),
  });

export type StationInstanceWithConnectorInstance = z.infer<
  typeof StationInstanceWithConnectorInstanceSchema
>;

/**
 * #674: a station's curated-view attachment, with the view's display fields
 * (from include=curatedView) and whether the caller can read the view.
 */
export const StationViewWithCuratedViewSchema = StationViewSchema.extend({
  curatedView: CuratedViewSchema.pick({
    id: true,
    key: true,
    label: true,
    connectorEntityId: true,
  }).optional(),
  canRead: z.boolean(),
});

export type StationViewWithCuratedView = z.infer<
  typeof StationViewWithCuratedViewSchema
>;

export const StationGetResponsePayloadSchema = z.object({
  station: StationWithToolpacksSchema.extend({
    instances: z.array(StationInstanceWithConnectorInstanceSchema).optional(),
    /** #674: present when include=curatedView. */
    views: z.array(StationViewWithCuratedViewSchema).optional(),
  }),
  /** #621: whether the caller may share this station (`resource.share`) — gates
   *  the Share entry point. Server-computed per-object, never a client role
   *  heuristic. */
  canShare: z.boolean(),
  /** #621: whether the caller may edit (`resource.write`) — gates the Edit
   *  entry point, so a read-only grantee isn't shown an action that 403s. */
  canWrite: z.boolean(),
  /** #621: whether the caller may delete (`resource.delete`) — gates the Delete
   *  entry point (a shared object's grantee never gets delete). */
  canDelete: z.boolean(),
});

export type StationGetResponsePayload = z.infer<
  typeof StationGetResponsePayloadSchema
>;

// ── Create ────────────────────────────────────────────────────────────

export const CreateStationBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  connectorInstanceIds: z.array(z.string()).optional(),
  /** #674: curated views to attach, independent of the connectors. Each must
   *  be readable by the caller. */
  curatedViewIds: z.array(z.string()).optional(),
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
    /** Full set of attached connector instances among those the caller can
     *  read. Attachments the caller can't read are preserved server-side (#674). */
    connectorInstanceIds: z.array(z.string()).optional(),
    /** #674: full set of attached curated views among those the caller can
     *  read; same preservation rule. */
    curatedViewIds: z.array(z.string()).optional(),
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
