import {
  ToolPackUtil,
  ALL_BUILTIN_SLUGS,
  isBuiltinPackEntitled,
  stationDataSetupFor,
  unentitledBuiltins,
} from "../utils/tool-packs.util";

describe("ToolPackUtil.getLabel", () => {
  it("returns the human-readable label for known packs", () => {
    expect(ToolPackUtil.getLabel("data_query")).toBe("Data Query");
    expect(ToolPackUtil.getLabel("statistics")).toBe("Statistics");
    expect(ToolPackUtil.getLabel("regression")).toBe("Regression");
    expect(ToolPackUtil.getLabel("financial")).toBe("Financial");
    expect(ToolPackUtil.getLabel("web_search")).toBe("Web Search");
    expect(ToolPackUtil.getLabel("entity_management")).toBe(
      "Entity Management"
    );
  });

  it("falls back to the raw key for unknown packs", () => {
    expect(ToolPackUtil.getLabel("unknown_pack")).toBe("unknown_pack");
  });
});

// ── Built-in entitlement predicate (#284) ────────────────────────────
//
// Governs the BUILT-IN axis only. The custom axis is #214's
// `customToolpacks` boolean and is deliberately not this predicate's
// business — an `org:<uuid>` ref always reads as entitled here.

describe("isBuiltinPackEntitled", () => {
  const entitled = new Set(["data_query", "web_search"]);

  it("returns true for a built-in slug in the entitled set", () => {
    expect(isBuiltinPackEntitled("data_query", entitled)).toBe(true);
    expect(isBuiltinPackEntitled("web_search", entitled)).toBe(true);
  });

  it("returns false for a built-in slug outside the entitled set", () => {
    expect(isBuiltinPackEntitled("entity_management", entitled)).toBe(false);
    expect(isBuiltinPackEntitled("visualize", entitled)).toBe(false);
  });

  it("returns true for a custom `org:<uuid>` ref regardless of the set", () => {
    expect(
      isBuiltinPackEntitled(
        "org:3f1c9b8e-0000-4000-8000-000000000001",
        entitled
      )
    ).toBe(true);
    expect(isBuiltinPackEntitled("org:anything", new Set())).toBe(true);
  });

  it("returns true for an unrecognized reference", () => {
    expect(isBuiltinPackEntitled("not_a_pack", entitled)).toBe(true);
    expect(isBuiltinPackEntitled("", entitled)).toBe(true);
  });

  it("treats ALL_BUILTIN_SLUGS as entitling every built-in pack", () => {
    for (const slug of ALL_BUILTIN_SLUGS) {
      expect(isBuiltinPackEntitled(slug, ALL_BUILTIN_SLUGS)).toBe(true);
    }
  });
});

describe("unentitledBuiltins", () => {
  it("returns only unentitled built-ins, preserving input order", () => {
    const entitled = new Set(["data_query"]);
    expect(
      unentitledBuiltins(
        ["visualize", "data_query", "org:abc", "entity_management", "bogus"],
        entitled
      )
    ).toEqual(["visualize", "entity_management"]);
  });

  it("returns an empty array when everything is entitled", () => {
    expect(
      unentitledBuiltins(["data_query", "visualize"], ALL_BUILTIN_SLUGS)
    ).toEqual([]);
    expect(unentitledBuiltins([], ALL_BUILTIN_SLUGS)).toEqual([]);
  });
});

// #1055: the station notice's state, computed from what the page already
// holds, the same way the API classifies a station for the assistant.
describe("stationDataSetupFor", () => {
  const without =
    (...excluded: string[]) =>
    (pack: string) =>
      !excluded.includes(pack);

  it("is usable when a pack that reads data is on the plan", () => {
    expect(
      stationDataSetupFor(["data_query", "gis"], without("gis"), true)
    ).toEqual({ dataSetup: "usable", excludedPackNames: [] });
  });

  it("is plan-excluded and names the pack when the plan excludes it", () => {
    expect(
      stationDataSetupFor(["view_management", "gis"], without("gis"), true)
    ).toEqual({ dataSetup: "plan-excluded", excludedPackNames: ["GIS"] });
  });

  it("is none when no pack on the station reads data", () => {
    expect(
      stationDataSetupFor(["web_search"], without("web_search"), true)
    ).toEqual({ dataSetup: "none", excludedPackNames: [] });
  });

  it("names the organization's packs when the plan excludes custom packs", () => {
    expect(
      stationDataSetupFor(["org:abc", "view_management"], () => true, false)
    ).toEqual({
      dataSetup: "plan-excluded",
      excludedPackNames: ["Your organization's tool packs"],
    });
  });

  // Only `org:` refs are custom packs. A retired or unknown built-in slug is
  // neither, as the API reads it.
  it("doesn't count an unknown ref as a custom pack", () => {
    expect(
      stationDataSetupFor(
        ["retired_pack", "view_management"],
        () => true,
        false
      )
    ).toEqual({ dataSetup: "none", excludedPackNames: [] });
    expect(
      stationDataSetupFor(["retired_pack", "view_management"], () => true, true)
    ).toEqual({ dataSetup: "none", excludedPackNames: [] });
  });

  it("counts a custom pack the plan includes as usable", () => {
    expect(stationDataSetupFor(["org:abc"], () => true, true)).toEqual({
      dataSetup: "usable",
      excludedPackNames: [],
    });
  });

  // The order of the station's own chips, so the notice reads like the list
  // beside it.
  it("names excluded packs in the station's order", () => {
    const { excludedPackNames } = stationDataSetupFor(
      ["gis", "web_search", "statistics", "data_query"],
      () => false,
      true
    );
    expect(excludedPackNames).toEqual(["GIS", "Statistics", "Data Query"]);
  });
});
