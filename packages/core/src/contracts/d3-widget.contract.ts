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

const D3BaseContentSchema = z.object({
  /** Function-body source (see module doc above). Never empty. */
  program: z.string().min(1),
  title: z.string().optional(),
  params: D3ProgramParamsSchema.optional(),
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
 * matching the vega-lite handle-block shape (`content.queryHandle`
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
