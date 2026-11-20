import { jest, describe, it, expect, beforeEach } from "@jest/globals";

/**
 * PlatformHelpTool (#367, #1050, #1049): the Help pack's tool. It ranks the
 * shipped help content (FAQ, glossary, troubleshooting) with help search and
 * returns a bounded, structured result that renders as a `help` block: the
 * best entries verbatim, the titles of the next ones, or `noMatch`. It never
 * reads the station or the user's data, and no sentence in its result is
 * anything but corpus text.
 */

// Any read of the station or its data would go through these; the tool must
// call none of them.
const mockDiagnostics = jest.fn<() => Promise<unknown>>();
jest.unstable_mockModule(
  "../../services/station-diagnostics.service.js",
  () => ({
    StationDiagnosticsService: {
      forStation: mockDiagnostics,
      situation: mockDiagnostics,
    },
  })
);
const mockDb = jest.fn<() => Promise<unknown>>();
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: new Proxy({}, { get: () => ({}) }),
    transaction: mockDb,
  },
}));

const { PlatformHelpTool } = await import("../../tools/platform-help.tool.js");
const { HELP_CORPUS, findHelpDocument, FAQ_ENTRIES, FAQCategory } =
  await import("@portalai/core/content");
const { HelpBlockContentSchema } = await import("@portalai/core/contracts");

type Result = import("@portalai/core/contracts").HelpBlockContent;

const exec = async (input: {
  question?: string;
  keywords?: string;
  entryIds?: string[];
}): Promise<Result> =>
  (await new PlatformHelpTool().build().execute!(input, {} as never)) as Result;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("PlatformHelpTool — registration surface", () => {
  it("declares the slug the registry knows it by", () => {
    expect(new PlatformHelpTool().slug).toBe("platform_help");
  });

  it("describes itself as general platform help, not data or station state", () => {
    const { description } = new PlatformHelpTool();
    expect(description).toMatch(/portals ai/i);
    expect(description).toMatch(/not a data-query tool/i);
    expect(description).toMatch(/help block/i);
    expect(description).not.toMatch(/this station/i);
  });
});

describe("PlatformHelpTool — ranked help content (#1049)", () => {
  it("finds the entry for a phrasing no entry contains", async () => {
    const r = await exec({ question: "How do I bring in a spreadsheet?" });
    expect(r.noMatch).toBe(false);
    expect(r.entries[0]?.slug).toBe("how-do-i-connect-my-first-data-source");
    expect(r.entries[0]?.url).toContain(
      "#faq-entry-how-do-i-connect-my-first-data-source"
    );
  });

  it("quotes every entry byte for byte, and its title is the corpus title", async () => {
    for (const question of [
      "How do I bring in a spreadsheet?",
      "What is a portal?",
      "my sync failed",
      "it says permission denied",
    ]) {
      const r = await exec({ question });
      for (const e of r.entries) {
        const doc = findHelpDocument(e.surface, e.slug)!;
        expect(e.body).toBe(doc.body);
        expect(e.title).toBe(doc.title);
      }
    }
  });

  it("returns titles only for the candidates beyond the top entries", async () => {
    const r = await exec({ question: "tool pack plan" });
    expect(r.entries.length).toBeLessThanOrEqual(3);
    expect(r.candidates.length).toBeLessThanOrEqual(5);
    for (const c of r.candidates) expect(c).not.toHaveProperty("body");
  });

  it("scores the agent's keywords with the question", async () => {
    const r = await exec({ question: "help me", keywords: "geocoding" });
    expect(r.entries.map((e) => e.slug)).toContain("geocoding");
  });

  it("takes keywords as one string of topic words, which models format reliably (#1049)", () => {
    const { schema } = new PlatformHelpTool();
    expect(
      schema.safeParse({ question: "q", keywords: "upload spreadsheet csv" })
        .success
    ).toBe(true);
    expect(
      schema.safeParse({ question: "q", keywords: ["upload", "csv"] }).success
    ).toBe(false);
  });

  it("ranks the user's question above the agent's keywords (#1049 smoke walk)", async () => {
    const r = await exec({
      question: "What is a portal?",
      keywords: "portal what is definition",
    });
    expect(r.entries[0]?.slug).toBe("portal");
  });

  it("fetches entries by id, ignoring ids that don't exist", async () => {
    const r = await exec({
      entryIds: ["glossary:portal", "faq:no-such-entry"],
    });
    expect(r.entries.map((e) => `${e.surface}:${e.slug}`)).toEqual([
      "glossary:portal",
    ]);
    expect(r.candidates).toEqual([]);
  });

  it("returns ids past the third as candidates, so nothing asked for vanishes", async () => {
    const ids = HELP_CORPUS.slice(0, 5).map((d) => `${d.surface}:${d.slug}`);
    const r = await exec({ entryIds: ids });
    expect(r.entries.map((e) => `${e.surface}:${e.slug}`)).toEqual(
      ids.slice(0, 3)
    );
    expect(r.candidates.map((c) => `${c.surface}:${c.slug}`)).toEqual(
      ids.slice(3)
    );
  });

  it("says no entry covers ids that no longer exist, rather than answering something else", async () => {
    const r = await exec({ entryIds: ["faq:a-question-since-removed"] });
    expect(r.noMatch).toBe(true);
    expect(r.entries).toEqual([]);
  });

  it("says no entry covers a question nothing matches, and describes nothing", async () => {
    const r = await exec({ question: "weather in paris" });
    expect(r).toEqual({
      type: "help",
      query: "weather in paris",
      entries: [],
      candidates: [],
      noMatch: true,
      helpUrl: "/help?tab=getting-started",
    });
  });

  it("answers a bare call with the Getting Started FAQ entries", async () => {
    const r = await exec({});
    const firstThree = FAQ_ENTRIES.filter(
      (e) => e.category === FAQCategory.GettingStarted
    )
      .slice(0, 3)
      .map((e) => e.question);
    expect(r.entries.map((e) => e.title)).toEqual(firstThree);
    expect(r.noMatch).toBe(false);
  });

  it("always returns a valid help block, within its bounds", async () => {
    for (const input of [
      {},
      { question: "portal station entity connector tool pack plan job" },
      { question: "zzzz" },
      {
        entryIds: HELP_CORPUS.slice(0, 5).map((d) => `${d.surface}:${d.slug}`),
      },
    ]) {
      expect(HelpBlockContentSchema.safeParse(await exec(input)).success).toBe(
        true
      );
    }
  });

  it("never reads the station or the user's data", async () => {
    await exec({ question: "why are my answers empty?" });
    await exec({});
    expect(mockDiagnostics).not.toHaveBeenCalled();
    expect(mockDb).not.toHaveBeenCalled();
  });
});
