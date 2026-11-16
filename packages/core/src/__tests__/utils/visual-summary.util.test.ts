import { describe, it, expect } from "@jest/globals";

import {
  deriveVisualSummary,
  visualSummary,
} from "../../utils/visual-summary.util.js";
import { deriveVisualSummary as barrelDerive } from "../../utils/index.js";

// #796: the fallback text alternative for a chart or map with no
// agent-written summary. It states only counts and names we hold.

describe("deriveVisualSummary — chart", () => {
  it("names the title, the row count and the fields", () => {
    expect(
      deriveVisualSummary({
        kind: "chart",
        title: "Revenue",
        fields: ["month", "revenue"],
        count: 1234,
        countExact: true,
      })
    ).toBe("Chart: Revenue. 1,234 rows; fields month, revenue.");
  });

  it("reads 'Chart.' without a title, and a single row in the singular", () => {
    expect(
      deriveVisualSummary({
        kind: "chart",
        fields: ["a"],
        count: 1,
        countExact: true,
      })
    ).toBe("Chart. 1 row; fields a.");
  });

  it("marks an inexact count with a plus", () => {
    expect(
      deriveVisualSummary({
        kind: "chart",
        title: "T",
        fields: ["a"],
        count: 100000,
        countExact: false,
      })
    ).toBe("Chart: T. 100,000+ rows; fields a.");
  });

  it("lists six fields and counts the rest", () => {
    expect(
      deriveVisualSummary({
        kind: "chart",
        title: "T",
        fields: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
        count: 2,
        countExact: true,
      })
    ).toBe("Chart: T. 2 rows; fields a, b, c, d, e, f and 3 more.");
  });

  it("says when there are no rows", () => {
    expect(
      deriveVisualSummary({
        kind: "chart",
        title: "T",
        fields: [],
        count: 0,
        countExact: true,
      })
    ).toBe("Chart: T. No rows.");
  });

  it("names only the chart while its data hasn't arrived", () => {
    expect(
      deriveVisualSummary({
        kind: "chart",
        title: "T",
        fields: [],
        countExact: true,
      })
    ).toBe("Chart: T.");
  });

  it("drops the field clause when no fields are known", () => {
    expect(
      deriveVisualSummary({
        kind: "chart",
        title: "T",
        fields: [],
        count: 3,
        countExact: true,
      })
    ).toBe("Chart: T. 3 rows.");
  });
});

describe("deriveVisualSummary — map", () => {
  it("names features, layers and what colours them", () => {
    expect(
      deriveVisualSummary({
        kind: "map",
        title: "Parcels",
        fields: ["geom", "zoning"],
        count: 1234,
        countExact: true,
        layers: [{ kind: "polygons", colorBy: "zoning" }, { kind: "points" }],
      })
    ).toBe(
      "Map: Parcels. 1,234 features in 2 layers (polygons, points); coloured by zoning."
    );
  });

  it("uses the singular for one layer and omits colour when none is set", () => {
    expect(
      deriveVisualSummary({
        kind: "map",
        fields: [],
        count: 1,
        countExact: true,
        layers: [{ kind: "points" }],
      })
    ).toBe("Map. 1 feature in 1 layer (points).");
  });

  it("says when there are no features", () => {
    expect(
      deriveVisualSummary({
        kind: "map",
        title: "Parcels",
        fields: [],
        count: 0,
        countExact: true,
        layers: [{ kind: "polygons" }],
      })
    ).toBe("Map: Parcels. No features.");
  });
});

describe("visualSummary", () => {
  const input = {
    kind: "chart" as const,
    title: "T",
    fields: ["a"],
    count: 2,
    countExact: true,
  };

  it("prefers the agent's summary, trimmed", () => {
    expect(visualSummary("  Sales double in June. ", input)).toBe(
      "Sales double in June."
    );
  });

  it("falls back to the derived one when the summary is missing or blank", () => {
    expect(visualSummary(undefined, input)).toBe("Chart: T. 2 rows; fields a.");
    expect(visualSummary("   ", input)).toBe("Chart: T. 2 rows; fields a.");
  });

  it("is exported from the utils barrel", () => {
    expect(barrelDerive).toBe(deriveVisualSummary);
  });
});
