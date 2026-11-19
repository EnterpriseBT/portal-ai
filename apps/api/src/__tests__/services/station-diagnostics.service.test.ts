import { jest, describe, it, expect, beforeEach } from "@jest/globals";

/**
 * StationDiagnosticsService (#1050): what a station can be said about, read
 * once for both `platform_help` (the help pack) and `station_context` (always
 * available). Moved out of `platform-help.tool.ts` unchanged; `unknown` is the
 * new name for "the read failed", which the help tool renders as before.
 */

const mockCountByConnectorEntityIds = jest
  .fn<() => Promise<number>>()
  .mockResolvedValue(42);
const mockLoadStation = jest.fn<() => Promise<unknown>>();
const mockResolveStationPackSplit = jest.fn<() => Promise<unknown>>();
const mockCountsForCaller = jest.fn<() => Promise<unknown>>();

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
jest.unstable_mockModule("../../services/entitlement.service.js", () => ({
  EntitlementService: {
    resolveStationPackSplit: mockResolveStationPackSplit,
  },
}));
jest.unstable_mockModule(
  "../../services/station-attachment.service.js",
  () => ({
    StationAttachmentService: { countsForCaller: mockCountsForCaller },
  })
);

const { StationDiagnosticsService } =
  await import("../../services/station-diagnostics.service.js");
type Findings = Awaited<
  ReturnType<typeof StationDiagnosticsService.forStation>
>;

const split = (over: Record<string, unknown> = {}) => ({
  effective: ["data_query"],
  unentitled: [],
  otherPlanPacks: [],
  configuredCustomPackCount: 0,
  customPacksEntitled: false,
  excludedCustomPacks: [],
  tier: "standard",
  ...over,
});
const counts = (views: [number, number], connectors: [number, number]) => ({
  views: { attached: views[0], readable: views[1] },
  connectors: { attached: connectors[0], readable: connectors[1] },
});

const base: Findings = {
  available: true,
  hasPacks: true,
  packsEffective: ["data_query"],
  dataSetup: "usable",
  excludedPacks: null,
  entityCount: 1,
  recordCount: 5,
  attachmentsMissing: null,
  attachmentsNoAccess: null,
};

describe("StationDiagnosticsService.situation", () => {
  it.each<[string, Partial<Findings>, string]>([
    ["unreadable", { available: false }, "unknown"],
    ["no packs", { hasPacks: false }, "no_packs"],
    [
      "every data pack excluded",
      { dataSetup: "plan-excluded" },
      "unentitled_packs",
    ],
    [
      "attachments missing",
      { attachmentsMissing: "views" },
      "attachments_missing",
    ],
    [
      "caller can't read them",
      { attachmentsNoAccess: "views" },
      "attachments_inaccessible",
    ],
    ["entities but no records", { recordCount: 0 }, "no_records"],
    ["some pack excluded", { excludedPacks: "gis" }, "unentitled_packs"],
    ["everything works", {}, "default"],
  ])("%s → %s", (_label, over, expected) => {
    expect(StationDiagnosticsService.situation({ ...base, ...over })).toBe(
      expected
    );
  });

  it("orders 'nothing works' before 'everything works': no packs beats every other finding", () => {
    expect(
      StationDiagnosticsService.situation({
        ...base,
        hasPacks: false,
        attachmentsMissing: "views",
        recordCount: 0,
        excludedPacks: "gis",
      })
    ).toBe("no_packs");
  });

  it("only blames missing attachments on a station with a usable data pack", () => {
    expect(
      StationDiagnosticsService.situation({
        ...base,
        dataSetup: "none",
        attachmentsMissing: "views",
      })
    ).toBe("default");
  });
});

describe("StationDiagnosticsService.forStation", () => {
  beforeEach(() => {
    mockResolveStationPackSplit.mockResolvedValue(split());
    mockLoadStation.mockResolvedValue({ entities: [{ id: "ce-1" }] });
    mockCountsForCaller.mockResolvedValue(counts([1, 1], [1, 1]));
    mockCountByConnectorEntityIds.mockResolvedValue(42);
  });

  it("reads the station's packs, entities, records and attachments", async () => {
    const f = await StationDiagnosticsService.forStation(
      "st-1",
      "org-1",
      "u-1"
    );
    expect(f).toEqual({
      available: true,
      hasPacks: true,
      packsEffective: ["data_query"],
      dataSetup: "usable",
      excludedPacks: null,
      entityCount: 1,
      recordCount: 42,
      attachmentsMissing: null,
      attachmentsNoAccess: null,
    });
  });

  it("is fail-soft: a failed read returns unavailable findings, never throws", async () => {
    mockLoadStation.mockRejectedValue(new Error("db down"));
    const f = await StationDiagnosticsService.forStation(
      "st-1",
      "org-1",
      "u-1"
    );
    expect(f.available).toBe(false);
    expect(StationDiagnosticsService.situation(f)).toBe("unknown");
  });

  it("doesn't count records when the station has no entities", async () => {
    mockLoadStation.mockResolvedValue({ entities: [] });
    mockCountByConnectorEntityIds.mockClear();
    const f = await StationDiagnosticsService.forStation(
      "st-1",
      "org-1",
      "u-1"
    );
    expect(f.recordCount).toBe(0);
    expect(mockCountByConnectorEntityIds).not.toHaveBeenCalled();
  });
});
