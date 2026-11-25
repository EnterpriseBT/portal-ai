import { describe, it, expect } from "@jest/globals";

import { isBuiltinToolpackSlug } from "@portalai/core/registries";

import { PROVISIONED_STATIONS } from "../../constants/provisioned-stations.constants.js";

// #848: the stations every new or reset org gets. Provisioning loops over
// this list, so its shape is the contract: real pack slugs, and the two
// stations the help content names. #1114: there's no default station.
describe("PROVISIONED_STATIONS (#848)", () => {
  it("marks no station as a default (#1114)", () => {
    for (const station of PROVISIONED_STATIONS) {
      expect(station).not.toHaveProperty("isDefault");
    }
  });

  it("lists Administrate first, the station `org create` reports (#1114)", () => {
    expect(PROVISIONED_STATIONS[0]!.name).toBe("Administrate");
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

  it("keeps Administrate free of data", () => {
    const administrate = PROVISIONED_STATIONS.find(
      (s) => s.name === "Administrate"
    )!;
    expect(administrate.attachSandbox).toBe(false);
  });

  it("Administrate's description covers members and tags, and doesn't promise custom access on every plan (#847, #1071)", () => {
    // Authoring roles, policies and groups needs the plan's custom access
    // (`customRbac`), which the self-serve tiers lack; shares work on all.
    const administrate = PROVISIONED_STATIONS.find(
      (s) => s.name === "Administrate"
    )!;
    expect(administrate.description).toBe(
      "Manage members, access and tags through the assistant: invitations, members, shares and tags on any plan, and custom roles, policies and groups where your plan includes them. No data is attached here. You can also ask how Portals works."
    );
  });

  it("Playground's description says what it's for, and that product questions work there (#1044)", () => {
    const playground = PROVISIONED_STATIONS.find(
      (s) => s.name === "Playground"
    )!;
    expect(playground.description).toBe(
      "Build and share entities and views with the assistant, attach views to this or other stations, and query the data in the same session. You can also ask how Portals works."
    );
  });

  it("is Administrate and Playground", () => {
    expect(
      PROVISIONED_STATIONS.map((s) => ({
        name: s.name,
        builtinSlugs: [...s.builtinSlugs],
        attachSandbox: s.attachSandbox,
      }))
    ).toEqual([
      {
        name: "Administrate",
        builtinSlugs: [
          "rbac_management",
          "member_management",
          "tag_management",
          "help",
        ],
        attachSandbox: false,
      },
      {
        name: "Playground",
        builtinSlugs: [
          "data_query",
          "entity_management",
          "view_management",
          "help",
        ],
        attachSandbox: true,
      },
    ]);
  });
});
