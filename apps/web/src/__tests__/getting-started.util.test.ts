import {
  GETTING_STARTED_STEPS,
  type GettingStartedStep,
} from "../utils/getting-started.util";
import { ApplicationRoute } from "../utils/routes.util";

// ── 3.1 — Step data ─────────────────────────────────────────────────

describe("GETTING_STARTED_STEPS", () => {
  it("contains the documented steps in order", () => {
    const expectedTitles = [
      "Connect a data source",
      "Map your fields",
      "Create a station",
      "Register custom toolpacks (optional)",
      "Open a portal",
    ];
    expect(GETTING_STARTED_STEPS).toHaveLength(5);
    expect(GETTING_STARTED_STEPS.map((s) => s.title)).toEqual(expectedTitles);
  });

  it("every step has title, description, ctaLabel, and ctaRoute", () => {
    for (const step of GETTING_STARTED_STEPS) {
      const s: GettingStartedStep = step;
      expect(s.title).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(s.ctaLabel).toBeTruthy();
      expect(s.ctaRoute).toBeTruthy();
    }
  });

  it("each ctaRoute is a known ApplicationRoute value", () => {
    const validRoutes = new Set<string>(Object.values(ApplicationRoute));
    for (const step of GETTING_STARTED_STEPS) {
      expect(validRoutes.has(step.ctaRoute)).toBe(true);
    }
  });
});

describe("Create a station step (#674)", () => {
  it("names views beside connector instances and tool packs", () => {
    const step = GETTING_STARTED_STEPS.find(
      (s) => s.title === "Create a station"
    )!;
    expect(step.description).toMatch(/connector instances, views/i);
  });

  // #848: a station is scoped to one kind of work, with the two a new
  // organization starts with as the examples.
  it("says to keep unrelated work in separate stations and names both provisioned ones (#848)", () => {
    const step = GETTING_STARTED_STEPS.find(
      (s) => s.title === "Create a station"
    )!;
    expect(step.description).toBe(
      "Bundle the connector instances, views and tool packs one kind of work needs — for example data query and statistics for analysis. Keep unrelated work in separate stations: a new organization starts with Administrate (access) and Playground (the Sandbox data) as examples. A station is the workspace a portal runs against."
    );
  });
});
