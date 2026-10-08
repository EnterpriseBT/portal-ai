import { z } from "zod";

import { withShareableCapabilities } from "./capabilities.contract.js";

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
    /** #688: each row carries the caller's capabilities on it. */
    stations: z.array(withShareableCapabilities(StationWithToolpacksSchema)),
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
    /**
     * Readable: the connector without its `credentials`, which never leave in
     * this payload. Unreadable: only `id` and `name`, enough for the locked
     * chip and nothing more (no config, error text or flags).
     */
    connectorInstance: z
      .union([
        ConnectorInstanceSchema.omit({ credentials: true }),
        ConnectorInstanceSchema.pick({ id: true, name: true }),
      ])
      .optional(),
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
  /** #688: `capabilities` (read/write/delete/share) replaces the #621
   *  canShare/canWrite/canDelete flags: the same server-computed per-object
   *  decision, in the shape every per-object payload now carries. */
  station: withShareableCapabilities(
    StationWithToolpacksSchema.extend({
      instances: z.array(StationInstanceWithConnectorInstanceSchema).optional(),
      /** #674: present when include=curatedView. */
      views: z.array(StationViewWithCuratedViewSchema).optional(),
    })
  ),
});

export type StationGetResponsePayload = z.infer<
  typeof StationGetResponsePayloadSchema
>;

// ── Create ────────────────────────────────────────────────────────────

export const CreateStationBodySchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    connectorInstanceIds: z.array(z.string()).optional(),
    /** #674: curated views to attach, independent of the connectors. Each must
     *  be readable by the caller. */
    curatedViewIds: z.array(z.string()).optional(),
    toolPacks: z.array(z.string()).min(1).optional(),
  })
  // #706: an unknown key (e.g. update's `curatedViewChanges`) is a 400, not
  // silently dropped.
  .strict();

export type CreateStationBody = z.infer<typeof CreateStationBodySchema>;

export const StationCreateResponsePayloadSchema = z.object({
  station: StationWithToolpacksSchema,
});

export type StationCreateResponsePayload = z.infer<
  typeof StationCreateResponsePayloadSchema
>;

// ── Update ────────────────────────────────────────────────────────────

/**
 * #674: an update changes one attachment kind by difference, never by full
 * set. A full set read when an edit dialog opened goes stale, so saving it
 * later silently re-attached what another editor had just removed. `add`
 * attaches (each id must be readable by the caller); `remove` detaches,
 * skipping any attachment the caller can't read. An id that isn't attached
 * (for `remove`) or is already attached (for `add`) is a no-op.
 */
export const StationAttachmentChangesSchema = z
  .object({
    add: z.array(z.string()).optional(),
    remove: z.array(z.string()).optional(),
  })
  // #706: a typo like `added` is a 400, not a change that attaches nothing.
  .strict()
  .refine(
    (c) => {
      const removed = new Set(c.remove ?? []);
      return !(c.add ?? []).some((id) => removed.has(id));
    },
    { message: "An id can't be both added and removed" }
  );

export type StationAttachmentChanges = z.infer<
  typeof StationAttachmentChangesSchema
>;

export const UpdateStationBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    connectorInstanceChanges: StationAttachmentChangesSchema.optional(),
    curatedViewChanges: StationAttachmentChangesSchema.optional(),
    toolPacks: z.array(z.string()).min(1).optional(),
  })
  // #706: an unknown key (e.g. create's `curatedViewIds`) is a 400, not a
  // silent no-op that reports success while attaching nothing.
  .strict()
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
