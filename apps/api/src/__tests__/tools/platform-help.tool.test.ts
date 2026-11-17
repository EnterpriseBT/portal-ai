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
/** What `EntitlementService.resolveStationPackSplit` returns: the one
 *  derivation of a station's packs, which the tool reads instead of the join
 *  table. */
const stationPacks = (
  over: Partial<{
    effective: string[];
    unentitled: string[];
    configuredCustomPackCount: number;
    customPacksEntitled: boolean;
    tier: string;
  }> = {}
) => ({
  effective: ["data_query"],
  unentitled: [],
  otherPlanPacks: [],
  configuredCustomPackCount: 0,
  customPacksEntitled: false,
  tier: "standard",
  ...over,
});
const mockResolveStationPackSplit = jest
  .fn<() => Promise<unknown>>()
  .mockResolvedValue(stationPacks());

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      entityRecords: {
        countByConnectorEntityIds: mockCountByConnectorEntityIds,
      },
    },
  },
}));

jest.unstable_mockModule("../../services/analytics.service.js", () => ({
  AnalyticsService: { loadStation: mockLoadStation },
}));

// #674: the attachment counts for the caller.
const mockCountsForCaller = jest.fn<() => Promise<unknown>>();
jest.unstable_mockModule(
  "../../services/station-attachment.service.js",
  () => ({
    StationAttachmentService: { countsForCaller: mockCountsForCaller },
  })
);
const counts = (views: [number, number], connectors: [number, number]) => ({
  views: { attached: views[0], readable: views[1] },
  connectors: { attached: connectors[0], readable: connectors[1] },
});

jest.unstable_mockModule("../../services/entitlement.service.js", () => ({
  EntitlementService: { resolveStationPackSplit: mockResolveStationPackSplit },
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
  (await new PlatformHelpTool().build("station-1", "org-1", "user-1").execute!(
    { question },
    {} as never
  )) as HelpResult;

/** A healthy station: packs enabled, entities present, records imported. */
const healthy = () => {
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
  mockResolveStationPackSplit.mockResolvedValue(stationPacks());
  mockCountByConnectorEntityIds.mockResolvedValue(42);
  mockCountsForCaller.mockResolvedValue(counts([1, 1], [1, 1]));
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

  it("#674: says both kinds are missing, and who can fix it, when nothing is attached", async () => {
    mockCountsForCaller.mockResolvedValue(counts([0, 0], [0, 0]));
    mockLoadStation.mockResolvedValue({ entities: [] });

    const { answer } = await exec("why are my answers empty");

    expect(answer).toBe(
      "No views or connectors are attached to this station. It works " +
        "without them. Attach a view to query entity data here, or a " +
        "connector to create and edit entities. " +
        "Anyone who can edit the station can attach them."
    );
  });

  it("#674: names only the missing kind", async () => {
    mockCountsForCaller.mockResolvedValue(counts([0, 0], [1, 1]));
    const { answer } = await exec();
    expect(answer).toMatch(
      /^No views are attached to this station\. Attach a view to query entity data here\./
    );
  });

  it("#674: reports no access when attached views are all unreadable", async () => {
    mockCountsForCaller.mockResolvedValue(counts([2, 0], [1, 1]));
    const { answer } = await exec();
    // #676: the no-access answer says the views ARE attached, so it can't be
    // relayed as "nothing attached".
    expect(answer).toBe(
      "You don't have access to any views on this station. " +
        "They're attached, but they haven't been shared with your account. " +
        "Ask someone who can share them to give you access."
    );
  });

  it("#674: missing outranks no-access, and both outrank no-records", async () => {
    mockCountsForCaller.mockResolvedValue(counts([0, 0], [1, 0]));
    mockCountByConnectorEntityIds.mockResolvedValue(0);
    const { answer } = await exec();
    expect(answer).toMatch(/^No views are attached/);
  });

  // #848: a station with no views or connectors is only "why answers are
  // empty" when it carries a pack that works on station data.
  describe("a station set up without data packs (#848)", () => {
    const accessOnly = () => {
      mockResolveStationPackSplit.mockResolvedValue(
        stationPacks({ effective: ["rbac_management"] })
      );
      mockLoadStation.mockResolvedValue({ entities: [] });
      mockCountsForCaller.mockResolvedValue(counts([0, 0], [0, 0]));
    };

    it("doesn't lead with the missing-attachments sentence", async () => {
      accessOnly();
      const { answer } = await exec("what can I do here");
      expect(answer).not.toMatch(/are attached to this station/);
      expect(answer).not.toMatch(/It works without them/);
    });

    it("doesn't claim entities are set up when the station has none", async () => {
      accessOnly();
      const { answer } = await exec("why are my answers empty");
      expect(answer).not.toMatch(/has entities set up/);
    });

    it("still reaches the plan-limit answer for an unentitled pack", async () => {
      accessOnly();
      mockResolveStationPackSplit.mockResolvedValue(
        stationPacks({
          effective: [],
          unentitled: ["rbac_management"],
          tier: "custom",
        })
      );
      const { answer } = await exec("why can't the assistant manage access");
      expect(answer).toMatch(/not included in your current plan/);
      expect(answer).toContain("rbac_management");
    });

    // A custom tool can read the station's records, so a custom pack the
    // plan includes makes missing data a real cause again.
    it("names the missing attachments when a custom pack is attached", async () => {
      accessOnly();
      mockResolveStationPackSplit.mockResolvedValue(
        stationPacks({
          effective: [],
          configuredCustomPackCount: 1,
          customPacksEntitled: true,
        })
      );
      const { answer } = await exec();
      expect(answer).toMatch(/^No views or connectors are attached/);
    });

    // Code review: a custom pack the plan excludes builds no tools. Attaching
    // a view wouldn't help, so missing data isn't given as the cause. It is
    // still a pack on the station, so the answer isn't "no tool packs".
    it("doesn't name missing attachments for a custom pack the plan excludes", async () => {
      accessOnly();
      mockResolveStationPackSplit.mockResolvedValue(
        stationPacks({
          effective: [],
          configuredCustomPackCount: 1,
          customPacksEntitled: false,
        })
      );
      const { answer } = await exec();
      expect(answer).not.toMatch(/are attached to this station/);
      expect(answer).not.toMatch(/attach the packs for what you want/);
    });

    // One derivation with the prompt, through the split-only read: the
    // custom-pack rows it doesn't use decrypt stored pack credentials.
    it("reads the station's packs from the shared derivation, without pack details", async () => {
      accessOnly();
      await exec();
      expect(mockResolveStationPackSplit).toHaveBeenCalledWith(
        "station-1",
        "org-1"
      );
    });
  });

  it("a data station with nothing attached and no entities never says entities are set up (#848)", async () => {
    // Everything attached, but no entity resolves: "no records" would be false.
    mockLoadStation.mockResolvedValue({ entities: [] });
    const { answer } = await exec("why are my answers empty");
    expect(answer).not.toMatch(/has entities set up/);
  });

  it("#674: reads the counts for the calling user", async () => {
    await exec();
    expect(mockCountsForCaller).toHaveBeenCalledWith(
      "station-1",
      "org-1",
      "user-1"
    );
  });

  it("explains tool packs when the station has none attached", async () => {
    mockResolveStationPackSplit.mockResolvedValue(
      stationPacks({ effective: [] })
    );

    const { answer } = await exec("what can I do here");

    expect(answer).toMatch(/tool pack/i);
    expect(answer).toMatch(/none|no tool packs|isn't attached|not attached/i);
  });

  it("#848: a station with no packs is told to attach the packs for its work, not one fixed pack", async () => {
    mockResolveStationPackSplit.mockResolvedValue(
      stationPacks({ effective: [] })
    );

    const { answer } = await exec("what can I do here");

    // A station is set up for one kind of work, and data querying is only
    // one of them (Administrate carries the access pack alone).
    expect(answer).toContain(
      "Open the station and attach the packs for what you want to do here, " +
        "such as the data-query pack for questions about your data, then ask " +
        "again."
    );
    expect(answer).not.toContain("at least the data-query pack");
  });

  it("says an unentitled pack is a plan limit, not a missing feature", async () => {
    mockResolveStationPackSplit.mockResolvedValue(
      stationPacks({ unentitled: ["gis"] })
    );

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
