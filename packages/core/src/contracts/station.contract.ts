import { z } from "zod";

import { descriptionField, nameField } from "./text-limits.contract.js";

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
import { TagListQueryFields, TaggedRowFields } from "./tag-list.contract.js";
import {
  FavoriteListQueryFields,
  FavoriteRowFields,
} from "./favorite.contract.js";

// ── List ──────────────────────────────────────────────────────────────

export const StationListRequestQuerySchema =
  PaginationRequestQuerySchema.extend({
    sortBy: z.enum(["name", "created"]).optional().default("created"),
    search: z.string().optional(),
    include: z.string().optional(),
    ...TagListQueryFields,
    ...FavoriteListQueryFields,
  });

export type StationListRequestQuery = z.infer<
  typeof StationListRequestQuerySchema
>;

/**
 * #1063: a pack attached to a station, named for anyone who can read the
 * station. Reading a station conveys what is attached to it, so a member sees
 * a custom pack's name though they can't list the organization's packs. Only
 * the ref, kind and name: never a pack's endpoint, headers or secrets.
 */
export const AttachedToolpackSchema = z.object({
  /** A built-in slug or `org:<uuid>`, as in `enabledToolpacks`. */
  ref: z.string(),
  kind: z.enum(["builtin", "custom"]),
  name: z.string(),
});

export type AttachedToolpack = z.infer<typeof AttachedToolpackSchema>;

/** Station with its enabled toolpack slugs (from the include=toolpacks join). */
export const StationWithToolpacksSchema = StationSchema.extend({
  enabledToolpacks: z.array(z.string()).optional(),
  /**
   * #1063: the attached packs with their names, in `enabledToolpacks` order.
   * A custom ref whose pack no longer exists has no item.
   */
  toolpacks: z.array(AttachedToolpackSchema).optional(),
  ...TaggedRowFields,
  ...FavoriteRowFields,
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
    name: nameField(),
    description: descriptionField().optional(),
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
 *
 * #1052: the same shape and rules carry a station's tool pack changes, where
 * an "id" is a built-in slug or an `org:<id>` ref.
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
    name: nameField().optional(),
    description: descriptionField().optional(),
    connectorInstanceChanges: StationAttachmentChangesSchema.optional(),
    curatedViewChanges: StationAttachmentChangesSchema.optional(),
    /**
     * #1052: tool packs change by difference too. Values are built-in slugs
     * and `org:<id>` refs. An update has no whole-list `toolPacks` (create
     * keeps its own): a list read when a dialog opened goes stale, and a
     * save of it put back what another editor had removed. Sent here, it is
     * an unknown key.
     */
    toolPackChanges: StationAttachmentChangesSchema.optional(),
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
