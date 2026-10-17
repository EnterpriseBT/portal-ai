import { z } from "zod";

import {
  D3BaseContentSchema,
  VizPipelineSchema,
} from "./d3-widget.contract.js";
import { GeoBaseContentSchema } from "./map-spec.contract.js";
import { WidgetRefreshResponseSchema } from "./portal-sql.contract.js";
import type { PortalResultType } from "../models/portal-result.model.js";

/**
 * Stored-content contracts for pinned portal results (#312, #640).
 *
 * A data pin is a **recipe**, not a snapshot (#640): it stores the query that
 * produces its data (`pipeline`) and how to draw it, never the rows. Its data
 * is executed on every view as the pin's definer
 * (`GET /api/portal-results/:id/data`), so it is always current, never holds
 * rows its definer can't see now, and empties when the definer loses access.
 * Every data kind therefore requires a `pipeline`; a block without one can't
 * be pinned. Narrative text stays self-contained.
 *
 * These are the **write** contracts. Pins saved before #640 may lack a
 * `pipeline`; the read path keeps `content` loose so they still list and open
 * (their data route answers `PORTAL_RESULT_NOT_REEXECUTABLE`).
 */

/** Stored content of a pinned data-table. */
export const PinnedDataTableContentSchema = z
  .object({
    /** Display-order hint; the live rows are authoritative. */
    columns: z.array(z.string()),
    pipeline: VizPipelineSchema,
  })
  .strict();
export type PinnedDataTableContent = z.infer<
  typeof PinnedDataTableContentSchema
>;

/** Stored content of a pinned d3 widget: the program and its query. */
export const PinnedD3ContentSchema = D3BaseContentSchema.extend({
  pipeline: VizPipelineSchema,
}).strict();
export type PinnedD3Content = z.infer<typeof PinnedD3ContentSchema>;

/** Stored content of a pinned map: the spec and its query. */
export const PinnedGeoContentSchema = GeoBaseContentSchema.extend({
  pipeline: VizPipelineSchema,
  /**
   * #371: the source was larger than an inline result when pinned, so the
   * widget renders through the pin's tile endpoint from the start rather than
   * waiting for the live delivery to say so.
   */
  tiled: z.boolean().optional(),
}).strict();
export type PinnedGeoContent = z.infer<typeof PinnedGeoContentSchema>;

/**
 * Per-type stored-content validators. A pin attempt for a type without an
 * entry is rejected with `PORTAL_RESULT_TYPE_NOT_PINNABLE` — same code as a
 * non-durable type.
 */
export const PINNED_CONTENT_SCHEMAS: Partial<
  Record<PortalResultType, z.ZodType>
> = {
  text: z.string().min(1),
  "data-table": PinnedDataTableContentSchema,
  d3: PinnedD3ContentSchema,
  geo: PinnedGeoContentSchema,
};

/**
 * #640: `GET /api/portal-results/:id/data` — a pin's data, live, as its
 * definer sees it: inline rows, or a query handle that belongs to the pin.
 */
export const PinDataResponseSchema = WidgetRefreshResponseSchema;
export type PinDataResponse = z.infer<typeof PinDataResponseSchema>;
