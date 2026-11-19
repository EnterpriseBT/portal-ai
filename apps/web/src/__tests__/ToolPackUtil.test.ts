import {
  ToolPackUtil,
  ALL_BUILTIN_SLUGS,
  isBuiltinPackEntitled,
  isPackEntitled,
  stationDataSetupFor,
  stationToolpackLabels,
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

describe("stationToolpackLabels (#1063)", () => {
  it("maps each custom pack's id to its name, for getLabel", () => {
    const labels = stationToolpackLabels([
      { ref: "data_query", kind: "builtin", name: "Data Query" },
      { ref: "org:tp-1", kind: "custom", name: "Acme CRM" },
    ]);
    expect([...labels]).toEqual([["tp-1", "Acme CRM"]]);
    expect(ToolPackUtil.getLabel("org:tp-1", labels)).toBe("Acme CRM");
    expect(ToolPackUtil.getLabel("org:tp-2", labels)).toBe("org:tp-2");
  });

  it("is empty for a station without named packs", () => {
    expect(stationToolpackLabels(undefined).size).toBe(0);
  });
});

describe("isPackEntitled (#1063)", () => {
  const entitled = new Set(["data_query"]);

  it("holds a built-in to the entitled set", () => {
    expect(isPackEntitled("data_query", entitled, false)).toBe(true);
    expect(isPackEntitled("statistics", entitled, true)).toBe(false);
  });

  it("holds a custom pack to the plan's custom packs", () => {
    expect(isPackEntitled("org:tp-1", entitled, true)).toBe(true);
    expect(isPackEntitled("org:tp-1", entitled, false)).toBe(false);
  });

  it("reads an unknown ref as entitled", () => {
    expect(isPackEntitled("retired_pack", entitled, false)).toBe(true);
  });
});

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

  // #1063: by their own names, from the station read.
  it("names the excluded custom packs, after the built-ins, in the station's order", () => {
    expect(
      stationDataSetupFor(
        ["org:b", "view_management", "org:a", "gis"],
        without("gis"),
        false,
        new Map([
          ["a", "Acme CRM"],
          ["b", "Beta Tools"],
        ])
      )
    ).toEqual({
      dataSetup: "plan-excluded",
      excludedPackNames: ["GIS", "Beta Tools", "Acme CRM"],
    });
  });

  it("leaves out an excluded custom pack it has no name for", () => {
    expect(
      stationDataSetupFor(["org:abc", "view_management"], () => true, false)
    ).toEqual({ dataSetup: "plan-excluded", excludedPackNames: [] });
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
