import { z } from "zod";

import { QueryHandleEnvelopeFieldsSchema } from "./portal-sql.contract.js";

/**
 * Content contract for the `d3` block type (#268, epic #267): an
 * agent-authored D3 render program plus its data binding.
 *
 * The program is **function-body source** with the documented signature —
 * it is executed only inside the sandboxed iframe runtime
 * (`apps/web/src/modules/D3Widget/`) as `new Function("api", program)`,
 * where `api = { d3, container, data, params, theme, width, height }`.
 * It is never evaluated in the app context.
 */

/** Free-form parameters the program receives as `api.params`. */
export const D3ProgramParamsSchema = z.record(z.string(), z.unknown());
export type D3ProgramParams = z.infer<typeof D3ProgramParamsSchema>;

/**
 * The durable, re-executable data pipeline behind a visualization (#270,
 * widened in #349). Present on every block minted from a SQL-backed result —
 * `d3`, `geo`, and (from #349) `data-table` alike — so a widget can re-run its
 * SQL for live data long after the ephemeral Redis handle expires. Named for
 * the concept, not the block type: it also governs pinned tables
 * (`pinned-result.contract.ts`) and map tiles (`portal-map-tile.service.ts`).
 *
 * Optional wherever it appears so pre-#270/#349 blocks and mid-stream
 * (unpersisted) blocks still parse and render (fail-safe); refresh treats its
 * absence as `VIZ_WIDGET_NOT_REFRESHABLE`.
 */
export const VizPipelineSchema = z.object({
  /** The originating SELECT — the authoritative durable copy (the handle
   *  envelope's own nullable `sql` serves the cursor tier separately). */
  sql: z.string().min(1),
  stationId: z.string().min(1),
  organizationId: z.string().min(1),
  /** Forward-looking (#270 Q4): mirrors the api `TransformDescriptor` for
   *  aggregate-backed widgets. `visualize_d3` never sets it today. Opaque at
   *  the core layer. */
  transform: z.record(z.string(), z.unknown()).optional(),
});
export type VizPipeline = z.infer<typeof VizPipelineSchema>;

const D3BaseContentSchema = z.object({
  /** Function-body source (see module doc above). Never empty. */
  program: z.string().min(1),
  title: z.string().optional(),
  params: D3ProgramParamsSchema.optional(),
  /** Durable re-executable pipeline (#270). Optional — see `VizPipelineSchema`. */
  pipeline: VizPipelineSchema.optional(),
});

/**
 * Inline binding — rows baked into the block content
 * (results ≤ `INLINE_ROWS_THRESHOLD`).
 */
export const D3InlineContentSchema = D3BaseContentSchema.extend({
  rows: z.array(z.record(z.string(), z.unknown())),
});
export type D3InlineContent = z.infer<typeof D3InlineContentSchema>;

/**
 * Handle binding — the full query-handle envelope rides the content,
 * matching the data-table handle-block shape (`content.queryHandle`
 * sniffing); the web runtime pages the snapshot endpoint progressively.
 */
export const D3HandleContentSchema = D3BaseContentSchema.extend(
  QueryHandleEnvelopeFieldsSchema.shape
);
export type D3HandleContent = z.infer<typeof D3HandleContentSchema>;

/**
 * Handle branch first: content carrying a `queryHandle` must resolve to
 * the handle branch (the inline schema would otherwise accept it as an
 * extra key when `rows` is also present — #269, the only producer,
 * never emits both).
 */
export const D3BlockContentSchema = z.union([
  D3HandleContentSchema,
  D3InlineContentSchema,
]);
export type D3BlockContent = z.infer<typeof D3BlockContentSchema>;
