import { toSummaryInput } from "../utils/visual-summary-input.util";

// #796: the summary's input comes from whatever data the widget holds.

describe("toSummaryInput", () => {
  it("reads fields and the exact count from inline rows", () => {
    expect(
      toSummaryInput({
        kind: "chart",
        title: "T",
        rows: [
          { month: "Jan", revenue: 1 },
          { month: "Feb", revenue: 2 },
        ],
      })
    ).toEqual({
      kind: "chart",
      title: "T",
      fields: ["month", "revenue"],
      count: 2,
      countExact: true,
    });
  });

  it("reads the schema and the matched count from a handle", () => {
    const input = toSummaryInput({
      kind: "chart",
      handle: {
        schema: [{ name: "a", type: "text" }],
        rowCount: 100_000,
        truncated: true,
        matchedCount: 250_000,
        matchedCountExact: false,
      },
    });
    expect(input).toMatchObject({
      fields: ["a"],
      count: 250_000,
      countExact: false,
    });
  });

  it("falls back to rowCount and truncated on a pre-#340 handle", () => {
    const input = toSummaryInput({
      kind: "chart",
      handle: { schema: [], rowCount: 100_000, truncated: true },
    });
    expect(input).toMatchObject({ count: 100_000, countExact: false });
  });

  it("leaves the count unknown with no data yet", () => {
    expect(toSummaryInput({ kind: "chart" }).count).toBeUndefined();
  });

  it("names a map's layers and what colours them", () => {
    const input = toSummaryInput({
      kind: "map",
      rows: [],
      spec: {
        layers: [
          {
            kind: "polygons",
            source: { geometryColumn: "geom" },
            style: { colorBy: { column: "zoning" } },
          },
          { kind: "points", source: { latColumn: "lat", lngColumn: "lng" } },
        ],
      } as never,
    });
    expect(input.layers).toEqual([
      { kind: "polygons", colorBy: "zoning" },
      { kind: "points", colorBy: undefined },
    ]);
  });
});
