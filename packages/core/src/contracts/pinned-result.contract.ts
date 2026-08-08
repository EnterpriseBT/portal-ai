import { z } from "zod";

import {
  D3InlineContentSchema,
  D3PipelineSchema,
} from "./d3-widget.contract.js";
import { GeoInlineContentSchema } from "./map-spec.contract.js";
import { WidgetRefreshResponseSchema } from "./portal-sql.contract.js";
import type { PortalResultType } from "../models/portal-result.model.js";

/**
 * Stored-content contracts for pinned portal results (#312).
 *
 * A pin **materializes**: the pin route validates the source block against
 * the per-type schema below and persists a self-contained snapshot (rows
 * bounded by `PIN_SNAPSHOT_ROW_CAP`) plus, where derivable, the durable
 * `pipeline` that makes the pin refreshable. Handle envelopes are never
 * stored — the 24h Redis handle TTL must not outlive a pin.
 */

/** Stored content of a pinned data-table (post-materialization). */
export const PinnedDataTableContentSchema = z.object({
  columns: z.array(z.string()),
  /** Materialized snapshot, ≤ `PIN_SNAPSHOT_ROW_CAP` rows. */
  rows: z.array(z.record(z.string(), z.unknown())),
  /** Source total — a lower bound when `truncated` is true (#147 semantics). */
  rowCount: z.number().int().nonnegative().optional(),
  truncated: z.boolean().optional(),
  /** Present ⇢ the pin is refreshable. Derived from the source handle
   *  envelope's retained `sql` (null for externally-supplied rows). */
  pipeline: D3PipelineSchema.optional(),
});
export type PinnedDataTableContent = z.infer<
  typeof PinnedDataTableContentSchema
>;

/**
 * Stored content of a pinned d3 widget: always the inline shape — a
 * handle-backed widget is materialized at pin time.
 */
export const PinnedD3ContentSchema = D3InlineContentSchema;
export type PinnedD3Content = z.infer<typeof PinnedD3ContentSchema>;

/**
 * Stored content of a pinned geo widget: always the inline shape — a
 * handle/tile-backed map is materialized to inline rows at pin time (#84/#314).
 */
export const PinnedGeoContentSchema = GeoInlineContentSchema;
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
 * Refresh response of `POST /api/portal-results/:id/refresh` — identical
 * union to the message-block widget-refresh endpoint: one contract, two
 * addressers.
 */
export const PinRefreshResponseSchema = WidgetRefreshResponseSchema;
export type PinRefreshResponse = z.infer<typeof PinRefreshResponseSchema>;
