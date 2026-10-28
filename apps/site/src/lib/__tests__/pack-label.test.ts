/**
 * Pricing-card labels (#615): registry pack names and the plan features the
 * public snapshot carries.
 */
import { describe, it, expect } from "@jest/globals";

import { PublicSiteConfigResponseSchema } from "@portalai/core/contracts";

import { packLabel, planFeatures } from "../pack-label.js";
import fixture from "../site-config.fixture.json" with { type: "json" };

describe("packLabel", () => {
  it("uses the registry's name, not a title-cased slug", () => {
    expect(packLabel("rbac_management")).toBe("Access & Roles");
    expect(packLabel("view_management")).toBe("Curated Views");
    expect(packLabel("gis")).toBe("GIS");
  });

  it("falls back to the slug for a pack the registry doesn't know", () => {
    expect(packLabel("not_a_pack")).toBe("not_a_pack");
  });
});

describe("planFeatures", () => {
  it("lists nothing for a tier with no extra features", () => {
    expect(
      planFeatures({
        customToolpacks: false,
        customRbac: false,
        advancedViewFilters: false,
      })
    ).toEqual([]);
  });

  it("lists custom roles and SQL filters on the fixture's Enterprise card", () => {
    const config = PublicSiteConfigResponseSchema.parse(fixture);
    const enterprise = config.tiers.find((t) => t.slug === "enterprise");
    expect(enterprise).toBeDefined();
    expect(planFeatures(enterprise!)).toEqual([
      "Your own webhook tools",
      "Advanced (SQL) view filters",
      "Custom roles & policies",
    ]);
  });
});
