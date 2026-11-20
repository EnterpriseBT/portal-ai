import { describe, it, expect } from "@jest/globals";

import {
  HELP_CORPUS,
  findHelpDocument,
  helpDocumentUrl,
  searchHelp,
  tokenizeHelp,
  type HelpDocument,
} from "../../content/help-search.util";
import { FAQ_ENTRIES } from "../../content/faq.util";
import {
  GLOSSARY_ENTRIES,
  contentEntrySlug,
} from "../../content/glossary.util";
import { buildHelpUrl, HELP_TAB } from "../../content/help-url.util";

const doc = (
  over: Partial<HelpDocument> & { title: string }
): HelpDocument => ({
  surface: "faq",
  slug: contentEntrySlug(over.title),
  body: "",
  aliases: [],
  related: [],
  ...over,
});

describe("tokenizeHelp (#1049)", () => {
  it("lowercases and splits on anything not a letter or digit", () => {
    expect(tokenizeHelp("Tool-Pack, SQL!")).toEqual(["tool", "pack", "sql"]);
  });
  it("drops stopwords", () => {
    expect(tokenizeHelp("How do I create a station?")).toEqual([
      "create",
      "station",
    ]);
  });
  it("stems plurals and common suffixes", () => {
    expect(tokenizeHelp("stations importing synced queries boxes")).toEqual([
      "station",
      "import",
      "sync",
      "query",
      "box",
    ]);
  });
  it("returns nothing for an empty or stopword-only string", () => {
    expect(tokenizeHelp("")).toEqual([]);
    expect(tokenizeHelp("what is it?")).toEqual([]);
  });
});

describe("searchHelp (#1049)", () => {
  const corpus = [
    doc({ title: "Connecting a spreadsheet", body: "Use File Upload." }),
    doc({
      title: "Billing",
      body: "A spreadsheet of invoices is not how billing works.",
    }),
    doc({ title: "Imports", body: "Bring data in.", aliases: ["spreadsheet"] }),
    doc({
      surface: "glossary",
      title: "Portal",
      body: "A chat session.",
      category: "analytics",
    }),
    doc({
      surface: "glossary",
      title: "Station",
      body: "A workspace.",
      category: "analytics",
    }),
  ];

  it("ranks a title hit above a body-only hit", () => {
    const ids = searchHelp("spreadsheet", { corpus, floor: 0 }).map(
      (m) => m.doc.title
    );
    expect(ids.indexOf("Connecting a spreadsheet")).toBeLessThan(
      ids.indexOf("Billing")
    );
  });

  it("weighs an alias like the title", () => {
    const ids = searchHelp("spreadsheet", { corpus, floor: 0 }).map(
      (m) => m.doc.title
    );
    expect(ids.indexOf("Imports")).toBeLessThan(ids.indexOf("Billing"));
  });

  it("adds the keywords to the question's terms", () => {
    const plain = searchHelp("help", { corpus, floor: 0 });
    const withKeywords = searchHelp("help", {
      corpus,
      keywords: ["portal"],
      floor: 0,
    });
    expect(plain).toEqual([]);
    expect(withKeywords[0]?.doc.title).toBe("Portal");
  });

  it("filters by surface and by category", () => {
    expect(
      searchHelp("spreadsheet portal", {
        corpus,
        surfaces: ["glossary"],
        floor: 0,
      }).every((m) => m.doc.surface === "glossary")
    ).toBe(true);
    expect(
      searchHelp("portal station", { corpus, category: "analytics", floor: 0 })
        .map((m) => m.doc.title)
        .sort()
    ).toEqual(["Portal", "Station"]);
  });

  it("orders deterministically, whatever order the corpus arrives in", () => {
    const a = searchHelp("spreadsheet", { corpus, floor: 0 }).map(
      (m) => m.doc.title
    );
    const b = searchHelp("spreadsheet", {
      corpus: [...corpus].reverse(),
      floor: 0,
    }).map((m) => m.doc.title);
    expect(a).toEqual(b);
  });

  it("returns nothing for an empty or stopword-only query", () => {
    expect(searchHelp("", { corpus })).toEqual([]);
    expect(searchHelp("how do I?", { corpus })).toEqual([]);
  });

  it("drops matches below the floor", () => {
    expect(searchHelp("spreadsheet", { corpus, floor: 100 })).toEqual([]);
  });

  it("puts the entry whose title is the query first, though other titles share its terms", () => {
    const tie = [
      doc({ title: "What are tool packs?", body: "Tool packs bundle tools." }),
      doc({
        surface: "glossary",
        title: "Tool Pack",
        body: "A bundle of tools.",
      }),
    ];
    expect(
      searchHelp("Tool Pack", { corpus: tie, floor: 0 })[0]?.doc.title
    ).toBe("Tool Pack");
    expect(
      searchHelp("What are tool packs?", { corpus: tie, floor: 0 })[0]?.doc
        .title
    ).toBe("What are tool packs?");
  });

  it("respects the limit", () => {
    expect(
      searchHelp("spreadsheet", { corpus, limit: 1, floor: 0 })
    ).toHaveLength(1);
  });
});

describe("HELP_CORPUS (#1049)", () => {
  it("holds every FAQ and glossary entry exactly once, slugs unique per surface", () => {
    const faq = HELP_CORPUS.filter((d) => d.surface === "faq");
    const glossary = HELP_CORPUS.filter((d) => d.surface === "glossary");
    expect(faq.map((d) => d.title)).toEqual(FAQ_ENTRIES.map((e) => e.question));
    expect(glossary.map((d) => d.title)).toEqual(
      GLOSSARY_ENTRIES.map((e) => e.term)
    );
    for (const surface of ["faq", "glossary", "troubleshooting"] as const) {
      const slugs = HELP_CORPUS.filter((d) => d.surface === surface).map(
        (d) => d.slug
      );
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });

  it("quotes each entry's body verbatim", () => {
    const faq = HELP_CORPUS.filter((d) => d.surface === "faq");
    expect(faq.map((d) => d.body)).toEqual(FAQ_ENTRIES.map((e) => e.answer));
    const glossary = HELP_CORPUS.filter((d) => d.surface === "glossary");
    expect(glossary.map((d) => d.body)).toEqual(
      GLOSSARY_ENTRIES.map((e) => e.definition)
    );
  });

  it("finds a document by surface and slug, and links it into Help", () => {
    const portal = findHelpDocument("glossary", "portal");
    expect(portal?.title).toBe("Portal");
    expect(findHelpDocument("glossary", "nope")).toBeUndefined();
    expect(helpDocumentUrl(portal!)).toBe(
      buildHelpUrl({
        tab: HELP_TAB.glossary,
        entry: { surface: "glossary", slug: "portal" },
      })
    );
  });
});
