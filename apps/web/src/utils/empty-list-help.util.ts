import { contentEntrySlug } from "@portalai/core/content";

import { helpAnchorHash, HelpTab } from "./routes.util";

/** The top-level lists whose empty state explains itself (#1059). */
export type EmptyList =
  | "stations"
  | "connectors"
  | "connectorDefinitions"
  | "entities"
  | "views"
  | "entityGroups"
  | "tags"
  | "columnDefinitions"
  | "pinnedResults"
  | "jobs";

interface EmptyListCopy {
  /** One sentence: what the list holds and what it's for. Names no role and
   *  makes no claim about what the caller may do. */
  description: string;
  /** The FAQ entry's question, exactly as in `FAQ_ENTRIES`. */
  faq: string;
}

/**
 * #1059: the one place each empty list's explainer is written, so every page
 * has the same shape (title, sentence, Help link) and none writes its own.
 * `empty-list-help.util.test.ts` fails if a linked FAQ entry is renamed or
 * removed.
 */
export const EMPTY_LIST_HELP: Record<EmptyList, EmptyListCopy> = {
  stations: {
    description:
      "A station bundles the views, connectors and tool packs a portal session works with.",
    faq: "What is a Station and why do I need one?",
  },
  connectors: {
    description:
      "A connector links a data source, such as a file, a spreadsheet or an API, and brings its data in.",
    faq: "How do I connect my first data source?",
  },
  connectorDefinitions: {
    description:
      "Connector definitions are the kinds of data source a connector links, such as file uploads and APIs.",
    faq: "How do I connect my first data source?",
  },
  entities: {
    description:
      "An entity is one table of records from a connector, such as a sheet or an API endpoint.",
    faq: "What's the difference between a connector and an entity?",
  },
  views: {
    description:
      "A view is a chosen set of an entity's columns and rows that stations query.",
    faq: "What is a view?",
  },
  entityGroups: {
    description:
      "An entity group joins entities from different sources that describe the same things.",
    faq: "What are entity groups and when should I use them?",
  },
  tags: {
    description:
      "Tags are color-coded labels you attach to entities to group and filter them.",
    faq: "How do tags work?",
  },
  columnDefinitions: {
    description:
      "A column definition is a shared field type that field mappings use to validate and format values.",
    faq: "What are column definitions and why do they matter?",
  },
  pinnedResults: {
    description:
      "A pinned result is a chart, table, map or answer kept from a portal session.",
    faq: "How do I save results from a portal session?",
  },
  jobs: {
    description:
      "Jobs are background tasks such as imports, syncs and revalidations.",
    faq: "What are jobs?",
  },
};

/** The `description` and `helpLink` an empty list passes to `EmptyState`. */
export function emptyListHelp(list: EmptyList): {
  description: string;
  helpLink: { href: string; label: string };
} {
  const { description, faq } = EMPTY_LIST_HELP[list];
  const hash = helpAnchorHash({
    surface: HelpTab.Faq,
    slug: contentEntrySlug(faq),
  });
  return { description, helpLink: { href: `/help#${hash}`, label: faq } };
}
