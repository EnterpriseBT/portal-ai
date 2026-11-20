import { describe, it, expect } from "@jest/globals";

import { HELP_CORPUS, searchHelp } from "../../content/help-search.util";
import { HELP_NONSENSE, HELP_PARAPHRASES } from "./fixtures/help-paraphrases";

/**
 * Findability guards (#1049). No model, no network: they hold the help
 * content to being findable by the words people use. A new entry is covered
 * automatically (self-retrieval is table-driven over the corpus), and a new
 * phrasing that misses goes in the fixture and is fixed with an alias.
 */
const id = (m: { doc: { surface: string; slug: string } }) =>
  `${m.doc.surface}:${m.doc.slug}`;

describe("help findability (#1049)", () => {
  it.each(HELP_CORPUS.map((d) => [`${d.surface}:${d.slug}`, d.title] as const))(
    "%s ranks first for its own title",
    (key, title) => {
      expect(searchHelp(title).map(id)[0]).toBe(key);
    }
  );

  it.each(HELP_PARAPHRASES.map((p) => [p.query, p.expect] as const))(
    '"%s" finds %s in the top 3',
    (query, expected) => {
      expect(searchHelp(query).slice(0, 3).map(id)).toContain(expected);
    }
  );

  // #1049 smoke walk: the agent's own keywords must not outweigh the user's
  // question. These are keywords the agent actually sent.
  it.each([
    [
      "What is a portal?",
      ["portal", "what is", "definition"],
      "glossary:portal",
    ],
    [
      "my sync failed",
      ["sync failed", "connector sync", "troubleshooting", "sync error"],
      "troubleshooting:a-sync-or-import-job-failed",
    ],
  ] as const)(
    '"%s" with the agent\'s keywords %j still ranks %s first',
    (query, keywords, expected) => {
      expect(searchHelp(query, { keywords }).map(id)[0]).toBe(expected);
    }
  );

  it.each(HELP_NONSENSE.map((q) => [q] as const))(
    '"%s" matches nothing',
    (query) => {
      expect(searchHelp(query)).toEqual([]);
    }
  );
});
