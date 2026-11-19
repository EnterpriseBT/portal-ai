import { z } from "zod";
import { tool } from "ai";
import {
  FAQ_ENTRIES,
  GLOSSARY_ENTRIES,
  HELP_TAB,
  buildHelpUrl,
  contentEntrySlug,
  filterFAQ,
  filterGlossary,
} from "@portalai/core/content";

import { Tool } from "../types/tools.js";

const InputSchema = z.object({
  question: z
    .string()
    .max(500)
    .optional()
    .describe(
      "The user's question about the product, verbatim. Omit for a general orientation answer."
    ),
});

/** How much shipped content one answer may carry. */
const MAX_FAQ = 3;
const MAX_GLOSSARY = 3;

/**
 * In-session platform help (#367).
 *
 * The `help` pack's tool (#1050), built only on a station that attaches the
 * pack. It answers **general** questions about how Portals works and how to do
 * things in it, from the shipped help content (FAQ and glossary), with links
 * into Help. It never reads the station or the user's data: finding things in
 * the organization is other tools' work, and why a station returns little is
 * `station_context`'s `status`, which every session has. It's never gated or
 * charged: every tier is entitled to the pack (`ALWAYS_ENTITLED_PACKS`) and
 * its capability is `free`.
 *
 * The tool **composes the final prose itself** and the agent relays it. That
 * is the point: platform behavior is what a model states confidently and
 * wrongly, and a wrong answer about the product is worse than no answer. The
 * agent's job here is routing, not authorship.
 */
export class PlatformHelpTool extends Tool<typeof InputSchema> {
  slug = "platform_help";
  name = "Platform Help";
  description =
    "Answer a general question about **Portals AI itself** — what portals, " +
    "stations, connectors, entities, tool packs, or pinned results are, and " +
    "how to do things in the product — from the help content, with links " +
    "into Help. Use it whenever the user asks how the product works. " +
    "**This is not a data-query tool**, and it knows nothing about the " +
    "user's organization: it never reads their records, stations or setup. " +
    "Use the data tools for their data, and `station_context` for why " +
    "answers here come back empty.";

  get schema() {
    return InputSchema;
  }

  build() {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input: z.infer<typeof InputSchema>) =>
        composeAnswer(selectContent(input.question)),
    });
  }
}

interface SelectedContent {
  faq: { question: string; answer: string; slug: string }[];
  glossary: { term: string; definition: string; slug: string }[];
}

/**
 * Pick the shipped material this answer quotes. Bounded on purpose — the tool
 * sends a handful of entries, never the corpus.
 */
function selectContent(question?: string): SelectedContent {
  const query = question?.trim();
  if (!query) return { faq: [], glossary: [] };

  return {
    faq: filterFAQ(FAQ_ENTRIES, { query })
      .slice(0, MAX_FAQ)
      .map((e) => ({
        question: e.question,
        answer: e.answer,
        slug: contentEntrySlug(e.question),
      })),
    glossary: filterGlossary(GLOSSARY_ENTRIES, { query })
      .slice(0, MAX_GLOSSARY)
      .map((e) => ({
        term: e.term,
        definition: e.definition,
        slug: contentEntrySlug(e.term),
      })),
  };
}

/** What a bare call, or a question nothing in the content matches, gets. */
const ORIENTATION =
  "A portal is a chat session on a station: ask a question in plain " +
  "language and the assistant answers with the station's tool packs, over " +
  "the data attached to it. You get the most out of it by asking about one " +
  "thing at a time, and by naming entities and columns the way they appear " +
  "in your data. Results worth keeping can be pinned, and pinned charts and " +
  "tables reload live data when you open them.";

/**
 * The matched content, quoted, leads the answer; orientation only when
 * nothing matched. #1050: no station situation, since this tool answers
 * general questions and never reads the station.
 */
function composeAnswer(selected: SelectedContent): {
  answer: string;
  links: { label: string; url: string }[];
} {
  const parts: string[] = [];
  for (const entry of selected.faq) {
    parts.push(`- **${entry.question}** ${entry.answer}`);
  }
  for (const entry of selected.glossary) {
    parts.push(`- **${entry.term}** — ${entry.definition}`);
  }
  if (parts.length === 0) parts.push(ORIENTATION);
  return { answer: parts.join("\n"), links: buildLinks(selected) };
}

function buildLinks(
  selected: SelectedContent
): { label: string; url: string }[] {
  const links = [
    ...selected.faq.map((e) => ({
      label: e.question,
      url: buildHelpUrl({
        tab: HELP_TAB.faq,
        entry: { surface: "faq" as const, slug: e.slug },
      }),
    })),
    ...selected.glossary.map((e) => ({
      label: e.term,
      url: buildHelpUrl({
        tab: HELP_TAB.glossary,
        entry: { surface: "glossary" as const, slug: e.slug },
      }),
    })),
  ];

  // Always offer the portal material, so even a bare question has somewhere
  // to go.
  links.push({
    label: "Analytics & Portals help",
    url: buildHelpUrl({ tab: HELP_TAB.faq, category: "analytics" }),
  });

  return links;
}
