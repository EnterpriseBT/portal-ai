import {
  HELP_TAB,
  buildHelpUrl,
  contentEntrySlug,
  GLOSSARY_ENTRIES,
} from "../../content/index.js";

/**
 * The Help URL grammar (#365) as a builder (#367).
 *
 * The web app owns the *reader* — `normalizeHelpSearch` and `parseHelpAnchor`
 * in `apps/web/src/utils/routes.util.ts`. `apps/api` cannot import that, and
 * the assistant tool has to emit the same grammar, so the writer lives here
 * beside `contentEntrySlug` rather than as a second hardcoded copy.
 */
describe("HELP_TAB", () => {
  it("carries the three tab slugs the /help route accepts", () => {
    expect(HELP_TAB).toEqual({
      gettingStarted: "getting-started",
      glossary: "glossary",
      faq: "faq",
    });
  });
});

describe("buildHelpUrl", () => {
  it("returns the bare route with no options", () => {
    expect(buildHelpUrl({})).toBe("/help");
  });

  it("builds a tab + category address", () => {
    expect(buildHelpUrl({ tab: HELP_TAB.faq, category: "analytics" })).toBe(
      "/help?tab=faq&category=analytics"
    );
    expect(
      buildHelpUrl({ tab: HELP_TAB.glossary, category: "analytics" })
    ).toBe("/help?tab=glossary&category=analytics");
  });

  it("builds a tab-only address", () => {
    expect(buildHelpUrl({ tab: HELP_TAB.glossary })).toBe("/help?tab=glossary");
  });

  it("drops a category that arrives without a tab", () => {
    // Mirrors the reader: a category is only meaningful relative to a tab, so
    // `normalizeHelpSearch` drops an orphan. Emitting one would produce a URL
    // whose category silently vanishes on arrival.
    expect(buildHelpUrl({ category: "analytics" })).toBe("/help");
  });

  it("appends an entry anchor", () => {
    expect(
      buildHelpUrl({
        tab: HELP_TAB.glossary,
        entry: { surface: "glossary", slug: "portal" },
      })
    ).toBe("/help?tab=glossary#glossary-entry-portal");

    expect(
      buildHelpUrl({
        tab: HELP_TAB.faq,
        entry: { surface: "faq", slug: "what-are-tool-packs" },
      })
    ).toBe("/help?tab=faq#faq-entry-what-are-tool-packs");
  });

  it("puts the fragment after the query, never before it", () => {
    // The premise correction the epic opened with: `#FAQ?tab=…` is not a URL.
    const url = buildHelpUrl({
      tab: HELP_TAB.faq,
      category: "analytics",
      entry: { surface: "faq", slug: "what-are-tool-packs" },
    });
    expect(url).toBe(
      "/help?tab=faq&category=analytics#faq-entry-what-are-tool-packs"
    );
    expect(url.indexOf("?")).toBeLessThan(url.indexOf("#"));
  });

  it("anchors a real glossary term end to end", () => {
    // The whole point: a slug produced by contentEntrySlug resolves as an
    // anchor the Help view can find.
    const term = GLOSSARY_ENTRIES.find((e) => e.term === "Portal Result")!;
    expect(
      buildHelpUrl({
        tab: HELP_TAB.glossary,
        entry: { surface: "glossary", slug: contentEntrySlug(term.term) },
      })
    ).toBe("/help?tab=glossary#glossary-entry-portal-result");
  });

  it("always produces a path starting at /help", () => {
    const urls = [
      buildHelpUrl({}),
      buildHelpUrl({ tab: HELP_TAB.faq }),
      buildHelpUrl({ tab: HELP_TAB.faq, category: "analytics" }),
      buildHelpUrl({ entry: { surface: "faq", slug: "x" } }),
    ];
    for (const url of urls) {
      expect(url.startsWith("/help")).toBe(true);
    }
  });
});
