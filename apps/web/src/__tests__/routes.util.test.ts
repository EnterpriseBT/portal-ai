import { FAQCategory, GlossaryCategory } from "@portalai/core/content";

import {
  ApplicationRoute,
  HELP_TAB_INDEX,
  HelpTab,
  helpAnchorHash,
  helpTabIndexFromSearch,
  normalizeHelpSearch,
  parseHelpAnchor,
} from "../utils/routes.util";

describe("ApplicationRoute", () => {
  it("includes Help route at /help", () => {
    expect(ApplicationRoute.Help).toBe("/help");
  });
});

describe("normalizeHelpSearch", () => {
  it("passes through every valid tab slug", () => {
    for (const tab of Object.values(HelpTab)) {
      expect(normalizeHelpSearch({ tab })).toEqual({
        tab,
        category: undefined,
      });
    }
  });

  it("drops an unrecognized tab", () => {
    expect(normalizeHelpSearch({ tab: "nonsense" })).toEqual({
      tab: undefined,
      category: undefined,
    });
  });

  it("keeps a category that belongs to the resolved tab", () => {
    expect(
      normalizeHelpSearch({ tab: HelpTab.Faq, category: FAQCategory.Analytics })
    ).toEqual({ tab: HelpTab.Faq, category: FAQCategory.Analytics });

    expect(
      normalizeHelpSearch({
        tab: HelpTab.Glossary,
        category: GlossaryCategory.DataModeling,
      })
    ).toEqual({
      tab: HelpTab.Glossary,
      category: GlossaryCategory.DataModeling,
    });
  });

  it("keeps `analytics`, which is a member of both enums, on either tab", () => {
    expect(
      normalizeHelpSearch({ tab: HelpTab.Glossary, category: "analytics" })
    ).toEqual({ tab: HelpTab.Glossary, category: GlossaryCategory.Analytics });

    expect(
      normalizeHelpSearch({ tab: HelpTab.Faq, category: "analytics" })
    ).toEqual({ tab: HelpTab.Faq, category: FAQCategory.Analytics });
  });

  it("drops a mismatched pair but keeps the tab", () => {
    // `data-modeling` is a GlossaryCategory only — meaningless on the FAQ tab.
    expect(
      normalizeHelpSearch({
        tab: HelpTab.Faq,
        category: GlossaryCategory.DataModeling,
      })
    ).toEqual({ tab: HelpTab.Faq, category: undefined });

    // `jobs` is an FAQCategory only.
    expect(
      normalizeHelpSearch({ tab: HelpTab.Glossary, category: FAQCategory.Jobs })
    ).toEqual({ tab: HelpTab.Glossary, category: undefined });
  });

  it("drops a category when the tab is absent", () => {
    expect(normalizeHelpSearch({ category: "analytics" })).toEqual({
      tab: undefined,
      category: undefined,
    });
  });

  it("drops a category on the Getting Started tab, which has none", () => {
    expect(
      normalizeHelpSearch({
        tab: HelpTab.GettingStarted,
        category: "analytics",
      })
    ).toEqual({ tab: HelpTab.GettingStarted, category: undefined });
  });

  it("drops non-string garbage in either param without throwing", () => {
    const garbage: Record<string, unknown>[] = [
      { tab: 42, category: 42 },
      { tab: ["faq"], category: ["analytics"] },
      { tab: { slug: "faq" }, category: null },
      { tab: true, category: undefined },
      {},
    ];

    for (const search of garbage) {
      expect(() => normalizeHelpSearch(search)).not.toThrow();
      expect(normalizeHelpSearch(search)).toEqual({
        tab: undefined,
        category: undefined,
      });
    }
  });
});

describe("helpTabIndexFromSearch", () => {
  it("resolves each tab to its rendered index", () => {
    expect(helpTabIndexFromSearch({ tab: HelpTab.GettingStarted })).toBe(
      HELP_TAB_INDEX[HelpTab.GettingStarted]
    );
    expect(helpTabIndexFromSearch({ tab: HelpTab.Glossary })).toBe(
      HELP_TAB_INDEX[HelpTab.Glossary]
    );
    expect(helpTabIndexFromSearch({ tab: HelpTab.Faq })).toBe(
      HELP_TAB_INDEX[HelpTab.Faq]
    );
  });

  it("falls back to the first tab for an empty search", () => {
    expect(helpTabIndexFromSearch({})).toBe(0);
  });

  it("orders the tabs as Help renders them", () => {
    expect(HELP_TAB_INDEX).toEqual({
      [HelpTab.GettingStarted]: 0,
      [HelpTab.Glossary]: 1,
      [HelpTab.Faq]: 2,
    });
  });
});

describe("parseHelpAnchor", () => {
  it("parses a glossary anchor with or without the leading hash", () => {
    const expected = { surface: HelpTab.Glossary, slug: "portal-result" };
    expect(parseHelpAnchor("#glossary-entry-portal-result")).toEqual(expected);
    expect(parseHelpAnchor("glossary-entry-portal-result")).toEqual(expected);
  });

  it("parses an FAQ anchor", () => {
    expect(parseHelpAnchor("#faq-entry-why-did-my-job-fail")).toEqual({
      surface: HelpTab.Faq,
      slug: "why-did-my-job-fail",
    });
  });

  it("rejects anything that is not a Help entry anchor", () => {
    expect(parseHelpAnchor("#faq-x")).toBeUndefined();
    expect(parseHelpAnchor("#getting-started-entry-x")).toBeUndefined();
    expect(parseHelpAnchor("#glossary-entry-")).toBeUndefined();
    expect(parseHelpAnchor("")).toBeUndefined();
    expect(parseHelpAnchor(undefined)).toBeUndefined();
  });
});

describe("helpAnchorHash", () => {
  it("round-trips with parseHelpAnchor", () => {
    const anchors = [
      { surface: HelpTab.Glossary as const, slug: "entity-record" },
      { surface: HelpTab.Faq as const, slug: "how-do-i-connect-a-source" },
    ];

    for (const anchor of anchors) {
      const hash = helpAnchorHash(anchor);
      expect(hash.startsWith("#")).toBe(false);
      expect(parseHelpAnchor(hash)).toEqual(anchor);
    }
  });
});
