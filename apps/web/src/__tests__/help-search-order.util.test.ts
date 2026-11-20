import { describe, it, expect } from "@jest/globals";

import {
  FAQ_ENTRIES,
  contentEntrySlug,
  filterFAQ,
} from "@portalai/core/content";
import { orderBySearch } from "../utils/help-search-order.util";

const slugOf = (e: (typeof FAQ_ENTRIES)[number]) =>
  contentEntrySlug(e.question);

describe("orderBySearch (#1049)", () => {
  it("lists the ranked entries first, then every other substring match", () => {
    const query = "csv";
    const substring = filterFAQ(FAQ_ENTRIES, { query });
    const ordered = orderBySearch(
      FAQ_ENTRIES,
      slugOf,
      "faq",
      query,
      undefined,
      substring
    );

    // "csv" is an alias of the data-source FAQ: it ranks first.
    expect(slugOf(ordered[0]!)).toBe("how-do-i-connect-my-first-data-source");
    // Nothing a substring search would have listed is lost.
    for (const e of substring) expect(ordered).toContain(e);
    expect(new Set(ordered).size).toBe(ordered.length);
  });

  it("falls back to the substring matches when the ranker finds nothing", () => {
    const substring = filterFAQ(FAQ_ENTRIES, { query: "connec" });
    expect(
      orderBySearch(FAQ_ENTRIES, slugOf, "faq", "connec", undefined, substring)
    ).toEqual(substring);
  });

  it("keeps the entries' own order for no query", () => {
    expect(
      orderBySearch(FAQ_ENTRIES, slugOf, "faq", "", undefined, FAQ_ENTRIES)
    ).toEqual(FAQ_ENTRIES);
  });
});
