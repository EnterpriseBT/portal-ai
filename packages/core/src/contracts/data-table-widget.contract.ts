import { z } from "zod";

import { VizPipelineSchema } from "./d3-widget.contract.js";
import { QueryHandleEnvelopeFieldsSchema } from "./portal-sql.contract.js";

/**
 * Content contract for the `data-table` block type (#349).
 *
 * Tables were the last visualization delivered as a **terminal snapshot**:
 * `sql_query` minted no pipeline and `resolveDisplayBlock` whitelisted the
 * handle envelope's `sql` away, so a table block — at any size — had nothing
 * behind it to re-execute. This contract gives the table the same
 * inline/handle shape `d3` (#268) and `geo` (#314) already have, with the
 * durable `pipeline` that makes it refreshable.
 *
 * Mirrors `D3BlockContentSchema` deliberately: same optionality rules, same
 * union ordering, so all three block types read alike.
 */

const DataTableBaseContentSchema = z.object({
  /** Present on persisted blocks; absent on some in-flight tool results. */
  type: z.literal("data-table").optional(),
  /** Set by `visualize_d3`'s codegen-failure fallback, which degrades a chart
   *  to a table and explains why. */
  message: z.string().optional(),
  /** Durable re-executable pipeline (#349). Optional — pre-#349 blocks have
   *  none, and neither do externally-supplied rows (`produceFromRows`), which
   *  have no originating query to re-run. */
  pipeline: VizPipelineSchema.optional(),
});

/**
 * Inline binding — rows baked into the block content
 * (results ≤ `INLINE_ROWS_THRESHOLD`). With `pipeline` present these rows are
 * a **fast first paint**, not the source of truth.
 */
export const DataTableInlineContentSchema = DataTableBaseContentSchema.extend({
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
});
export type DataTableInlineContent = z.infer<
  typeof DataTableInlineContentSchema
>;

/**
 * Handle binding — the full query-handle envelope rides the content; the web
 * runtime pages the snapshot endpoint.
 */
export const DataTableHandleContentSchema = DataTableBaseContentSchema.extend(
  QueryHandleEnvelopeFieldsSchema.shape
);
export type DataTableHandleContent = z.infer<
  typeof DataTableHandleContentSchema
>;

/**
 * Handle branch first — same reason as `D3BlockContentSchema`: content
 * carrying a `queryHandle` must resolve to the handle branch, which the
 * inline schema would otherwise accept as an extra key when `rows` is also
 * present.
 */
export const DataTableBlockContentSchema = z.union([
  DataTableHandleContentSchema,
  DataTableInlineContentSchema,
]);
export type DataTableBlockContent = z.infer<typeof DataTableBlockContentSchema>;
