import { describe, it, expect } from "@jest/globals";

import { BuiltinToolpackSlugSchema } from "@portalai/core/registries";

import {
  PACK_USES_STATION_DATA,
  usesStationData,
} from "../../utils/station-data-packs.util.js";

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
    expect(usesStationData(["rbac_management"])).toBe(false);
    expect(usesStationData(["rbac_management", "view_management"])).toBe(false);
    expect(usesStationData(["web_search"])).toBe(false);
    expect(usesStationData([])).toBe(false);
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
      expect(usesStationData(["rbac_management", slug])).toBe(true);
    }
  });

  it("ignores a slug the registry doesn't know", () => {
    expect(usesStationData(["not_a_pack"])).toBe(false);
  });
});
