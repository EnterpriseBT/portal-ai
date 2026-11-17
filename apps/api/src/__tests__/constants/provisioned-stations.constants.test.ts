import { describe, it, expect } from "@jest/globals";

import { isBuiltinToolpackSlug } from "@portalai/core/registries";

import { PROVISIONED_STATIONS } from "../../constants/provisioned-stations.constants.js";

// #848: the stations every new or reset org gets. Provisioning loops over
// this list, so its shape is the contract: one default, real pack slugs, and
// the two stations the help content names.
describe("PROVISIONED_STATIONS (#848)", () => {
  it("has exactly one default station", () => {
    expect(PROVISIONED_STATIONS.filter((s) => s.isDefault)).toHaveLength(1);
  });

  it("gives every station a unique name within the limit and a description", () => {
    const names = PROVISIONED_STATIONS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const station of PROVISIONED_STATIONS) {
      expect(station.name.length).toBeGreaterThan(0);
      expect(station.name.length).toBeLessThanOrEqual(120);
      expect(station.description.length).toBeGreaterThan(0);
      expect(station.description.length).toBeLessThanOrEqual(2000);
    }
  });

  it("attaches only built-in packs, each once, and at least one per station", () => {
    for (const station of PROVISIONED_STATIONS) {
      expect(station.builtinSlugs.length).toBeGreaterThan(0);
      expect(new Set(station.builtinSlugs).size).toBe(
        station.builtinSlugs.length
      );
      for (const slug of station.builtinSlugs) {
        expect(isBuiltinToolpackSlug(slug)).toBe(true);
      }
    }
  });

  it("keeps the default station free of data", () => {
    const [defaultStation] = PROVISIONED_STATIONS.filter((s) => s.isDefault);
    expect(defaultStation.attachSandbox).toBe(false);
  });

  it("is Administrate (the default) and Playground", () => {
    expect(
      PROVISIONED_STATIONS.map((s) => ({
        name: s.name,
        builtinSlugs: [...s.builtinSlugs],
        attachSandbox: s.attachSandbox,
        isDefault: s.isDefault,
      }))
    ).toEqual([
      {
        name: "Administrate",
        builtinSlugs: ["rbac_management"],
        attachSandbox: false,
        isDefault: true,
      },
      {
        name: "Playground",
        builtinSlugs: ["data_query", "entity_management", "view_management"],
        attachSandbox: true,
        isDefault: false,
      },
    ]);
  });
});
