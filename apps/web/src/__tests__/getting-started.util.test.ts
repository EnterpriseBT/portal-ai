import {
  GETTING_STARTED_STEPS,
  type GettingStartedStep,
} from "../utils/getting-started.util";
import { ApplicationRoute } from "../utils/routes.util";

// ── 3.1 — Step data ─────────────────────────────────────────────────

describe("GETTING_STARTED_STEPS", () => {
  it("contains the four documented steps in order", () => {
    const expectedTitles = [
      "Connect a data source",
      "Map your fields",
      "Create a station",
      "Open a portal",
    ];
    expect(GETTING_STARTED_STEPS).toHaveLength(4);
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
