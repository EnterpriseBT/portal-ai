import { z } from "zod";
import { tool } from "ai";
import {
  FAQ_ENTRIES,
  FAQCategory,
  HELP_TAB,
  buildHelpUrl,
  contentEntrySlug,
  findHelpDocument,
  helpDocumentUrl,
  searchHelp,
  type HelpDocument,
  type HelpSurface,
} from "@portalai/core/content";
import type { HelpBlockContent } from "@portalai/core/contracts";

import { Tool } from "../types/tools.js";

const ENTRY_ID = /^(faq|glossary|troubleshooting):[a-z0-9-]+$/;

const InputSchema = z.object({
  question: z
    .string()
    .max(500)
    .optional()
    .describe(
      "The user's question about the product, verbatim. Omit for the Getting Started entries."
    ),
  keywords: z
    .string()
    .max(200)
    .optional()
    .describe(
      'A few topic words for what the question is about, separated by spaces (e.g. "upload spreadsheet csv"). Ranked with the question, at lower weight.'
    ),
  entryIds: z
    .array(z.string().regex(ENTRY_ID))
    .max(5)
    .optional()
    .describe(
      "Up to 5 entry ids (`<surface>:<slug>`) from a previous result's `candidates`, to fetch those entries."
    ),
});

/** How much one result may carry, whatever the size of the help content. */
const MAX_ENTRIES = 3;
const MAX_CANDIDATES = 5;

/**
 * In-session platform help (#367).
 *
 * The `help` pack's tool (#1050), built only on a station that attaches the
 * pack. It answers **general** questions about how Portals works, how to do
 * things in it, and what to do when something goes wrong, from the shipped
 * help content: FAQ, glossary and troubleshooting. It never reads the station
 * or the user's data. It's never gated or charged: every tier is entitled to
 * the pack (`ALWAYS_ENTITLED_PACKS`) and its capability is `free`.
 *
 * #1049: it ranks the content with help search (the same ranker as Help's
 * search box) and returns a structured result, which the portal renders as a
 * `help` block quoting the entries verbatim. No sentence in the result is
 * anything but corpus text, and the model's framing sits outside the block.
 * Platform behaviour is what a model states confidently and wrongly, and a
 * wrong answer about the product is worse than no answer: so when nothing
 * matches, the result says so and describes nothing.
 */
export class PlatformHelpTool extends Tool<typeof InputSchema> {
  slug = "platform_help";
  name = "Platform Help";
  description =
    "Answer a general question about **Portals AI itself** — what portals, " +
    "stations, connectors, entities, tool packs, or pinned results are, how " +
    "to do things in the product, and what to do when something goes wrong " +
    "— from the help content. Pass the user's `question`, and your reading " +
    "of it as `keywords` (a few topic words). The result is shown to the user as a help block " +
    "quoting the best entries with links into Help; its `candidates` are " +
    "further entries you can fetch with `entryIds`. **This is not a " +
    "data-query tool**, and it knows nothing about the user's organization: " +
    "use the data tools for their data, and `station_context` for why " +
    "answers here come back empty.";

  get schema() {
    return InputSchema;
  }

  build() {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input: z.infer<typeof InputSchema>) => answer(input),
    });
  }
}

const entryOf = (doc: HelpDocument) => ({
  surface: doc.surface,
  slug: doc.slug,
  title: doc.title,
  url: helpDocumentUrl(doc),
  body: doc.body,
});

const candidateOf = (doc: HelpDocument) => ({
  surface: doc.surface,
  slug: doc.slug,
  title: doc.title,
  url: helpDocumentUrl(doc),
});

function answer(input: z.infer<typeof InputSchema>): HelpBlockContent {
  const question = input.question?.trim() ?? "";
  const base = {
    type: "help" as const,
    query: question,
    helpUrl: buildHelpUrl({ tab: HELP_TAB.gettingStarted }),
  };

  // A follow-up naming entries from a previous result's candidates.
  if (input.entryIds && input.entryIds.length > 0) {
    const docs = input.entryIds.flatMap((id) => {
      const [surface, slug] = id.split(":") as [HelpSurface, string];
      return findHelpDocument(surface, slug) ?? [];
    });
    if (docs.length > 0) {
      // Ids past the third come back as candidates, so none the agent asked
      // for silently disappears.
      return {
        ...base,
        entries: docs.slice(0, MAX_ENTRIES).map(entryOf),
        candidates: docs
          .slice(MAX_ENTRIES, MAX_ENTRIES + MAX_CANDIDATES)
          .map(candidateOf),
        noMatch: false,
      };
    }
    // Ids that no longer exist (content changed): say no entry covers it,
    // unless there's a question to search with instead.
    if (!question && !(input.keywords && input.keywords.length > 0)) {
      return { ...base, entries: [], candidates: [], noMatch: true };
    }
  }

  // A bare call: where a newcomer starts.
  if (!question && !(input.keywords && input.keywords.length > 0)) {
    const docs = FAQ_ENTRIES.filter(
      (e) => e.category === FAQCategory.GettingStarted
    )
      .slice(0, MAX_ENTRIES)
      .flatMap(
        (e) => findHelpDocument("faq", contentEntrySlug(e.question)) ?? []
      );
    return {
      ...base,
      entries: docs.map(entryOf),
      candidates: [],
      noMatch: false,
    };
  }

  const matches = searchHelp(question, {
    keywords: input.keywords ? [input.keywords] : undefined,
    limit: MAX_ENTRIES + MAX_CANDIDATES,
  });
  return {
    ...base,
    entries: matches.slice(0, MAX_ENTRIES).map((m) => entryOf(m.doc)),
    candidates: matches.slice(MAX_ENTRIES).map((m) => candidateOf(m.doc)),
    noMatch: matches.length === 0,
  };
}
