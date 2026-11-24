import { describe, it, expect } from "@jest/globals";

import { BuiltinToolpackSlugSchema } from "../../registries/builtin-toolpacks.js";

import {
  PACK_USES_STATION_DATA,
  stationDataSetup,
  usesStationData,
  type StationDataSetup,
} from "../../registries/station-data-packs.js";
import type { StationAttachmentGapsOptions } from "../../content/station-attachments.util.js";

// #848: whether a station's packs work on its attached data. platform_help
// and the system prompt both read it, so a station set up for access work
// isn't described as missing data.
describe("station data packs (#848)", () => {
  it("classifies every built-in pack", () => {
    expect(Object.keys(PACK_USES_STATION_DATA).sort()).toEqual(
      [...BuiltinToolpackSlugSchema.options].sort()
    );
  });

  it("treats the access, views and web-search packs as not using station data", () => {
    expect(usesStationData(["rbac_management"], false)).toBe(false);
    expect(usesStationData(["rbac_management", "view_management"], false)).toBe(
      false
    );
    expect(usesStationData(["web_search"], false)).toBe(false);
    // #1071: tags are org metadata, not station data.
    expect(usesStationData(["tag_management"], false)).toBe(false);
    expect(usesStationData([], false)).toBe(false);
  });

  it("is true as soon as one pack reads or writes entity data", () => {
    for (const slug of [
      "data_query",
      "entity_management",
      "statistics",
      "regression",
      "financial",
      "visualize",
      "gis",
    ]) {
      expect(usesStationData(["rbac_management", slug], false)).toBe(true);
    }
  });

  it("ignores a slug the registry doesn't know", () => {
    expect(usesStationData(["not_a_pack"], false)).toBe(false);
  });

  // A custom tool can take the station's records as input (`consumption` in
  // docs/CUSTOM_TOOLPACK_INTEGRATION.md) and nothing here can classify one,
  // so an attached custom pack counts.
  it("counts an attached custom pack as working on station data", () => {
    expect(usesStationData([], true)).toBe(true);
    expect(usesStationData(["rbac_management"], true)).toBe(true);
  });
});

// #1045: two states weren't enough. A station whose only data-capable packs
// are excluded by the plan is neither "set up for data" (attaching a view
// would do nothing) nor "not set up for data" (it was, and the plan is why
// it can't). The prompt and platform_help both read this.
describe("stationDataSetup (#1045)", () => {
  const setup = (over: Partial<Parameters<typeof stationDataSetup>[0]>) =>
    stationDataSetup({
      effective: [],
      unentitled: [],
      hasUsableCustomPack: false,
      hasExcludedCustomPack: false,
      ...over,
    });

  it("is usable when a pack with tools in the session works on data", () => {
    expect(setup({ effective: ["data_query"] })).toBe("usable");
    expect(setup({ hasUsableCustomPack: true })).toBe("usable");
    // A usable data pack outranks an excluded one.
    expect(
      setup({ effective: ["visualize"], unentitled: ["data_query"] })
    ).toBe("usable");
    expect(
      setup({ effective: ["data_query"], hasExcludedCustomPack: true })
    ).toBe("usable");
  });

  it("is plan-excluded when every data-capable pack is excluded by the plan", () => {
    expect(
      setup({ effective: ["rbac_management"], unentitled: ["data_query"] })
    ).toBe("plan-excluded");
    expect(
      setup({ effective: ["rbac_management"], hasExcludedCustomPack: true })
    ).toBe("plan-excluded");
  });

  it("is none when no pack on the station works on data", () => {
    expect(setup({ effective: ["rbac_management"] })).toBe("none");
    expect(setup({})).toBe("none");
    // An excluded pack that doesn't work on data doesn't change that.
    expect(
      setup({ effective: ["view_management"], unentitled: ["web_search"] })
    ).toBe("none");
  });
});

// #1055: the content module can't import this type, so it repeats the three
// states. This holds the two in step: a new state fails to compile here.
describe("StationAttachmentGapsOptions['dataSetup'] (#1055)", () => {
  it("is exactly StationDataSetup", () => {
    type Repeated = NonNullable<StationAttachmentGapsOptions["dataSetup"]>;
    const forward: Repeated = "usable" as StationDataSetup;
    const back: StationDataSetup = "usable" as Repeated;
    type Equal<A, B> = [A] extends [B]
      ? [B] extends [A]
        ? true
        : false
      : false;
    const same: Equal<Repeated, StationDataSetup> = true;
    expect([forward, back, same]).toEqual(["usable", "usable", true]);
  });
});
