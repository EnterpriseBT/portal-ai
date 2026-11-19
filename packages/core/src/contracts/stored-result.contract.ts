import { z } from "zod";

/**
 * #1038: a persisted result with no recipe to re-run it (a custom tool's
 * table, a table over rows that had no query). Its rows aren't kept, so a
 * reader who lost access to the data behind it can't still read them; what
 * remains says what it was, for the widget's "isn't kept" state.
 *
 * Not a branch of the `data-table` / `d3` / `geo` block unions, which keep
 * the fields a widget draws from: a widget checks this schema first and
 * renders the not-kept state instead of parsing the block.
 */
export const NotKeptContentSchema = z.object({
  type: z.string().optional(),
  notKept: z.literal(true),
  columns: z.array(z.string()),
  rowCount: z.number().int().nonnegative(),
});
export type NotKeptContent = z.infer<typeof NotKeptContentSchema>;
