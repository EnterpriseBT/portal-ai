import { FAQ_ENTRIES, contentEntrySlug } from "@portalai/core/content";

import {
  EMPTY_LIST_HELP,
  emptyListHelp,
  type EmptyList,
} from "../utils/empty-list-help.util";

const LISTS = Object.keys(EMPTY_LIST_HELP) as EmptyList[];

// #1059: every top-level list's empty state explains itself in one sentence
// and links to the Help FAQ entry that covers it.
describe("EMPTY_LIST_HELP", () => {
  it("covers every in-scope list", () => {
    expect(LISTS.sort()).toEqual(
      [
        "columnDefinitions",
        "connectorDefinitions",
        "connectors",
        "entities",
        "entityGroups",
        "jobs",
        "pinnedResults",
        "stations",
        "tags",
        "views",
      ].sort()
    );
  });

  // A renamed or removed FAQ entry fails here, not as a dead link.
  it.each(LISTS)("%s links to an FAQ entry that exists", (list) => {
    const questions = FAQ_ENTRIES.map((e) => e.question);
    expect(questions).toContain(EMPTY_LIST_HELP[list].faq);
  });

  it.each(LISTS)("%s explains itself in one short sentence", (list) => {
    const { description } = EMPTY_LIST_HELP[list];
    expect(description).toMatch(/^[A-Z][^.!?]*\.$/);
    expect(description.length).toBeLessThanOrEqual(110);
  });

  it.each(LISTS)("%s names no role and claims no permission", (list) => {
    expect(EMPTY_LIST_HELP[list].description).not.toMatch(
      /\b(admin|owner|member|role|permission|allowed|access|shared with you|you can)\b/i
    );
  });
});

describe("emptyListHelp", () => {
  it("builds the Help entry anchor and labels it with the question", () => {
    const { description, helpLink } = emptyListHelp("tags");
    expect(description).toBe(EMPTY_LIST_HELP.tags.description);
    expect(helpLink).toEqual({
      href: `/help#faq-entry-${contentEntrySlug(EMPTY_LIST_HELP.tags.faq)}`,
      label: EMPTY_LIST_HELP.tags.faq,
    });
  });
});
