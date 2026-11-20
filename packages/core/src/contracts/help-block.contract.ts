import { z } from "zod";

/**
 * The `help` block (#1049): `platform_help`'s result, rendered in the portal
 * as the matched help entries, verbatim, with links into Help. The server
 * builds the block from the tool's own result, so the model's text sits
 * outside it and can't alter the quoted entries.
 *
 * Bounded on purpose: at most 3 entries with their bodies, and the titles of
 * up to 5 more, whatever the size of the help content.
 */
const HelpEntryRefSchema = z.object({
  surface: z.enum(["faq", "glossary", "troubleshooting"]),
  slug: z.string(),
  title: z.string(),
  url: z.string(),
});

export const HelpBlockContentSchema = z.object({
  type: z.literal("help"),
  /** The question asked, or "" for a bare call. */
  query: z.string(),
  /** The best entries, each with its body exactly as written. */
  entries: z.array(HelpEntryRefSchema.extend({ body: z.string() })).max(3),
  /** The next-best entries, titles only; fetch one by its id. */
  candidates: z.array(HelpEntryRefSchema).max(5),
  /** True when no entry covers the question. */
  noMatch: z.boolean(),
  /** Where "browse Help" points. */
  helpUrl: z.string(),
});

export type HelpBlockContent = z.infer<typeof HelpBlockContentSchema>;
