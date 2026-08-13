import { jest, describe, it, expect, beforeEach } from "@jest/globals";

/**
 * The in-session help tool (#367).
 *
 * The tool composes the final prose itself and the agent relays it — platform
 * behavior is exactly what a model states confidently and wrongly, and a wrong
 * answer about the product is worse than no answer. So these tests assert the
 * *answer*, not a bag of findings for someone else to phrase.
 */

const mockCountByConnectorEntityIds = jest
  .fn<() => Promise<number>>()
  .mockResolvedValue(42);
const mockFindByStationId = jest
  .fn<() => Promise<unknown>>()
  .mockResolvedValue([
    { builtinSlug: "data_query", organizationToolpackId: null },
  ]);
const mockLoadStation = jest.fn<() => Promise<unknown>>().mockResolvedValue({
  entities: [
    {
      id: "ce-1",
      key: "orders",
      label: "Orders",
      connectorInstanceId: "ci-1",
      columns: [],
    },
  ],
});
const mockSplitBuiltinPacks = jest
  .fn<() => Promise<unknown>>()
  .mockResolvedValue({
    effective: ["data_query"],
    unentitled: [],
    tier: "standard",
  });

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      entityRecords: {
        countByConnectorEntityIds: mockCountByConnectorEntityIds,
      },
      stationToolpacks: { findByStationId: mockFindByStationId },
    },
  },
}));

jest.unstable_mockModule("../../services/analytics.service.js", () => ({
  AnalyticsService: { loadStation: mockLoadStation },
}));

jest.unstable_mockModule("../../services/entitlement.service.js", () => ({
  EntitlementService: { splitBuiltinPacks: mockSplitBuiltinPacks },
}));

const mockWarn = jest.fn();
jest.unstable_mockModule("../../utils/logger.util.js", () => ({
  createLogger: () => ({
    warn: mockWarn,
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

const { PlatformHelpTool } = await import("../../tools/platform-help.tool.js");

interface HelpResult {
  answer: string;
  links: { label: string; url: string }[];
}

const exec = async (question?: string): Promise<HelpResult> =>
  (await new PlatformHelpTool().build("station-1", "org-1").execute!(
    { question },
    {} as never
  )) as HelpResult;

/** A healthy station: packs enabled, entities present, records imported. */
const healthy = () => {
  mockFindByStationId.mockResolvedValue([
    { builtinSlug: "data_query", organizationToolpackId: null },
  ]);
  mockLoadStation.mockResolvedValue({
    entities: [
      {
        id: "ce-1",
        key: "orders",
        label: "Orders",
        connectorInstanceId: "ci-1",
        columns: [],
      },
    ],
  });
  mockSplitBuiltinPacks.mockResolvedValue({
    effective: ["data_query"],
    unentitled: [],
    tier: "standard",
  });
  mockCountByConnectorEntityIds.mockResolvedValue(42);
};

beforeEach(() => {
  jest.clearAllMocks();
  healthy();
});

describe("PlatformHelpTool — registration surface", () => {
  it("declares the slug the registry knows it by", () => {
    expect(new PlatformHelpTool().slug).toBe("platform_help");
  });

  it("describes itself as platform help and disclaims data querying", () => {
    // Under agent routing the description IS the routing mechanism: it is the
    // only thing separating "why are my answers empty?" from "how many orders
    // are empty?".
    const { description } = new PlatformHelpTool();
    expect(description).toMatch(/not a data-query tool/i);
    expect(description).toMatch(/portals ai/i);
  });
});

describe("PlatformHelpTool — orientation", () => {
  it("answers a bare call with orientation prose and a link", async () => {
    const result = await exec();
    expect(result.answer.length).toBeGreaterThan(80);
    expect(result.links.length).toBeGreaterThan(0);
  });

  it("returns links that are addressable Help URLs", async () => {
    const { links } = await exec("what are tool packs?");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.url.startsWith("/help")).toBe(true);
      expect(link.label.length).toBeGreaterThan(0);
    }
  });
});

describe("PlatformHelpTool — station situations", () => {
  it("names the no-records condition when entities exist but nothing is imported", async () => {
    mockCountByConnectorEntityIds.mockResolvedValue(0);

    const { answer } = await exec("why are my answers empty");

    // The flagship case: the answer must name THIS station's condition, not
    // recite a general definition.
    expect(answer).toMatch(
      /no records|nothing.*imported|haven't been imported/i
    );
    expect(answer).toMatch(/sync/i);
  });

  it("tells a station with no entities to connect a source first", async () => {
    mockLoadStation.mockResolvedValue({ entities: [] });

    const { answer } = await exec("why are my answers empty");

    expect(answer).toMatch(/connect/i);
    expect(answer).toMatch(/source|connector/i);
  });

  it("explains tool packs when the station has none attached", async () => {
    mockFindByStationId.mockResolvedValue([]);
    mockSplitBuiltinPacks.mockResolvedValue({
      effective: [],
      unentitled: [],
      tier: "standard",
    });

    const { answer } = await exec("what can I do here");

    expect(answer).toMatch(/tool pack/i);
    expect(answer).toMatch(/none|no tool packs|isn't attached|not attached/i);
  });

  it("says an unentitled pack is a plan limit, not a missing feature", async () => {
    mockSplitBuiltinPacks.mockResolvedValue({
      effective: ["data_query"],
      unentitled: ["gis"],
      tier: "standard",
    });

    const { answer } = await exec("why can't I make a map");

    expect(answer).toMatch(/plan/i);
    expect(answer).not.toMatch(/doesn't exist|not a feature/i);
  });
});

describe("PlatformHelpTool — content", () => {
  it("quotes matching FAQ material rather than paraphrasing it", async () => {
    const { FAQ_ENTRIES } = await import("@portalai/core/content");
    const entry = FAQ_ENTRIES.find(
      (e) => e.question === "What are tool packs?"
    )!;

    const { answer } = await exec("what are tool packs?");

    // A distinctive fragment of the real answer, quoted verbatim.
    const fragment = entry.answer.slice(0, 60);
    expect(answer).toContain(fragment);
  });

  it("caps how much material it pulls in", async () => {
    // A deliberately broad query matches far more than it should send.
    const { answer } = await exec("portal data station entity connector tool");
    const quoted = (answer.match(/\n- /g) ?? []).length;
    expect(quoted).toBeLessThanOrEqual(6);
  });
});

describe("PlatformHelpTool — resilience and boundaries", () => {
  it("still answers when the station read fails", async () => {
    mockLoadStation.mockRejectedValue(new Error("db down"));

    const result = await exec("what can I do here");

    // Fail soft: a degraded answer beats an error in the one surface a stuck
    // user reaches for. `execute` must not reject.
    expect(result.answer.length).toBeGreaterThan(80);
    expect(result.answer).toMatch(/couldn't|unavailable|could not/i);
    expect(mockWarn).toHaveBeenCalled();
  });

  it("counts records with one aggregate instead of reading rows", async () => {
    await exec("why are my answers empty");

    expect(mockCountByConnectorEntityIds).toHaveBeenCalledTimes(1);
    expect(mockCountByConnectorEntityIds).toHaveBeenCalledWith(["ce-1"]);
  });

  it("scopes the station read to the calling organization", async () => {
    await exec();
    expect(mockLoadStation).toHaveBeenCalledWith("station-1", "org-1");
  });
});
