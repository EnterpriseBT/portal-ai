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

  it.each(HELP_NONSENSE.map((q) => [q] as const))(
    '"%s" matches nothing',
    (query) => {
      expect(searchHelp(query)).toEqual([]);
    }
  );
});
