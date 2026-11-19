import { jest, describe, it, expect, beforeEach } from "@jest/globals";

/**
 * PlatformHelpTool (#367, #1050): the Help pack's tool. It answers general
 * questions about how Portals works from the shipped help content (FAQ and
 * glossary), with links into Help. Since #1050 it never reads the station or
 * the user's data — why a station returns little is `station_context`'s
 * `status`, which every session has.
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

interface HelpResult {
  answer: string;
  links: { label: string; url: string }[];
}

const exec = async (question?: string): Promise<HelpResult> =>
  (await new PlatformHelpTool().build().execute!(
    { question },
    {} as never
  )) as HelpResult;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("PlatformHelpTool — registration surface", () => {
  it("declares the slug the registry knows it by", () => {
    expect(new PlatformHelpTool().slug).toBe("platform_help");
  });

  it("describes itself as general platform help, not data or station state", () => {
    // Under agent routing the description IS the routing mechanism.
    const { description } = new PlatformHelpTool();
    expect(description).toMatch(/portals ai/i);
    expect(description).toMatch(/not a data-query tool/i);
    expect(description).not.toMatch(/this station/i);
  });
});

describe("PlatformHelpTool — content (#1050: general questions only)", () => {
  it("answers a product question with the matching help content, first", async () => {
    const { FAQ_ENTRIES } = await import("@portalai/core/content");
    const entry = FAQ_ENTRIES.find(
      (e) => e.question === "What are tool packs?"
    )!;

    const { answer } = await exec("what are tool packs?");

    // Quoted verbatim, and it leads: no station situation ahead of it.
    expect(answer).toContain(entry.answer.slice(0, 60));
    expect(answer.trimStart().startsWith("- **")).toBe(true);
  });

  it("answers 'what is a portal?' from the content, not the station's setup", async () => {
    const { answer } = await exec("What is a portal?");
    expect(answer).toMatch(/portal/i);
    expect(answer).not.toMatch(/no views|not attached|no records|imported/i);
  });

  it("caps how much material it pulls in", async () => {
    const { answer } = await exec("portal data station entity connector tool");
    const quoted = (answer.match(/(^|\n)- /g) ?? []).length;
    expect(quoted).toBeLessThanOrEqual(6);
  });

  it("answers a bare call, or a question nothing matches, with general orientation", async () => {
    for (const q of [undefined, "zzzz qqqq"]) {
      const result = await exec(q);
      expect(result.answer.length).toBeGreaterThan(80);
      expect(result.answer).toMatch(/portal/i);
      expect(result.links.length).toBeGreaterThan(0);
    }
  });

  it("returns links that are addressable Help URLs", async () => {
    const { links } = await exec("what are tool packs?");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.url.startsWith("/help")).toBe(true);
      expect(link.label.length).toBeGreaterThan(0);
    }
  });

  it("never reads the station or the user's data", async () => {
    await exec("why are my answers empty?");
    await exec();
    expect(mockDiagnostics).not.toHaveBeenCalled();
    expect(mockDb).not.toHaveBeenCalled();
  });
});
