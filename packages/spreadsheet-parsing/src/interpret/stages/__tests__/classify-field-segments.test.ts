import { describe, it, expect, jest } from "@jest/globals";

import type { InterpretInput } from "../../../plan/index.js";
import { createInitialState } from "../../state.js";
import type { InterpretState } from "../../types.js";
import { classifyFieldSegments } from "../classify-field-segments.js";
import { detectHeaders } from "../detect-headers.js";
import { detectIdentity } from "../detect-identity.js";
import { detectRegions } from "../detect-regions.js";
import { detectSegments } from "../detect-segments.js";
import type {
  ClassifierFn,
  ColumnClassification,
  ColumnDefinitionCatalogEntry,
} from "../../types.js";

function runUpToDetectSegments(input: InterpretInput): InterpretState {
  let state = createInitialState(input);
  state = detectRegions(state);
  state = detectHeaders(state);
  state = detectIdentity(state);
  state = detectSegments(state);
  return state;
}

function simpleInput(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 3, cols: 3 },
          cells: [
            { row: 1, col: 1, value: "email" },
            { row: 1, col: 2, value: "First Name" },
            { row: 1, col: 3, value: "age" },
            { row: 2, col: 1, value: "a@x.com" },
            { row: 2, col: 2, value: "alice" },
            { row: 2, col: 3, value: 30 },
            { row: 3, col: 1, value: "b@x.com" },
            { row: 3, col: 2, value: "bob" },
            { row: 3, col: 3, value: 25 },
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Sheet1",
        bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
        targetEntityDefinitionId: "contacts",
        headerAxes: ["row"],
      },
    ],
  };
}

const DEFAULT_CATALOG: ColumnDefinitionCatalogEntry[] = [
  { id: "col-email", label: "Email", normalizedKey: "email" },
  {
    id: "col-first-name",
    label: "First Name",
    normalizedKey: "first_name",
  },
  { id: "col-phone", label: "Phone", normalizedKey: "phone" },
];

describe("classifyFieldSegments — heuristic default", () => {
  it("matches on exact header equality (case-insensitive)", async () => {
    const prepared = runUpToDetectSegments(simpleInput());
    const state = await classifyFieldSegments(prepared, {
      columnDefinitionCatalog: DEFAULT_CATALOG,
    });
    const regionId = state.detectedRegions[0].id;
    const classifications = state.columnClassifications.get(regionId)!;
    const byHeader = new Map(classifications.map((c) => [c.sourceHeader, c]));
    expect(byHeader.get("email")?.columnDefinitionId).toBe("col-email");
    expect(byHeader.get("First Name")?.columnDefinitionId).toBe(
      "col-first-name"
    );
  });

  it("matches on normalised key when the catalog specifies one", async () => {
    const input = simpleInput();
    input.workbook.sheets[0].cells[0].value = "E-Mail";
    const prepared = runUpToDetectSegments(input);
    const state = await classifyFieldSegments(prepared, {
      columnDefinitionCatalog: [
        { id: "col-email", label: "Email", normalizedKey: "e_mail" },
      ],
    });
    const regionId = state.detectedRegions[0].id;
    const classifications = state.columnClassifications.get(regionId)!;
    expect(
      classifications.find((c) => c.sourceHeader === "E-Mail")
        ?.columnDefinitionId
    ).toBe("col-email");
  });

  it("returns null columnDefinitionId when no catalog entry matches", async () => {
    const prepared = runUpToDetectSegments(simpleInput());
    const state = await classifyFieldSegments(prepared, {
      columnDefinitionCatalog: DEFAULT_CATALOG,
    });
    const regionId = state.detectedRegions[0].id;
    const classifications = state.columnClassifications.get(regionId)!;
    const ageEntry = classifications.find((c) => c.sourceHeader === "age");
    expect(ageEntry?.columnDefinitionId).toBeNull();
  });

  it("returns null columnDefinitionId for every header when no catalog is supplied", async () => {
    const prepared = runUpToDetectSegments(simpleInput());
    const state = await classifyFieldSegments(prepared, {});
    const regionId = state.detectedRegions[0].id;
    const classifications = state.columnClassifications.get(regionId)!;
    expect(classifications.every((c) => c.columnDefinitionId === null)).toBe(
      true
    );
  });

  it("rewrites null columnDefinitionId to defaultColumnDefinitionId when supplied, with rationale annotated", async () => {
    const prepared = runUpToDetectSegments(simpleInput());
    const state = await classifyFieldSegments(prepared, {
      columnDefinitionCatalog: DEFAULT_CATALOG,
      defaultColumnDefinitionId: "col-text",
    });
    const regionId = state.detectedRegions[0].id;
    const classifications = state.columnClassifications.get(regionId)!;
    // "age" has no catalog match but should now bind to the fallback.
    const ageEntry = classifications.find((c) => c.sourceHeader === "age");
    expect(ageEntry?.columnDefinitionId).toBe("col-text");
    expect(ageEntry?.confidence).toBe(0);
    expect(ageEntry?.rationale).toContain("default-text-fallback");
    // Real matches are untouched.
    const emailEntry = classifications.find((c) => c.sourceHeader === "email");
    expect(emailEntry?.columnDefinitionId).toBe("col-email");
  });
});

describe("classifyFieldSegments — filters non-field positions", () => {
  it("passes only field-segment positions to the classifier", async () => {
    // Workbook: row 1 = "name, industry, Q1, Q2, Q3" — detect-segments
    // clusters this as field(2) + pivot(quarter, 3). Only name + industry
    // should reach the classifier.
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 2, cols: 5 },
            cells: [
              { row: 1, col: 1, value: "name" },
              { row: 1, col: 2, value: "industry" },
              { row: 1, col: 3, value: "Q1" },
              { row: 1, col: 4, value: "Q2" },
              { row: 1, col: 5, value: "Q3" },
              { row: 2, col: 1, value: "Apple" },
              { row: 2, col: 2, value: "Tech" },
              { row: 2, col: 3, value: 10 },
              { row: 2, col: 4, value: 20 },
              { row: 2, col: 5, value: 30 },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 5 },
          targetEntityDefinitionId: "companies",
          headerAxes: ["row"],
        },
      ],
    };
    const spy: jest.MockedFunction<ClassifierFn> = jest.fn(async () => []);
    const prepared = runUpToDetectSegments(input);
    await classifyFieldSegments(prepared, {
      classifier: spy,
      columnDefinitionCatalog: [],
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const [candidates] = spy.mock.calls[0]!;
    expect(candidates.map((c) => c.sourceHeader)).toEqual([
      "name",
      "industry",
    ]);
  });

  it("short-circuits the classifier when no field-segment positions exist", async () => {
    // Matrix id 1b: row 1 = "Q1, Q2, Q3" — detect-segments makes a single
    // pivot(quarter, 3) segment with no field positions, so the classifier
    // must not fire.
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 2, cols: 3 },
            cells: [
              { row: 1, col: 1, value: "Q1" },
              { row: 1, col: 2, value: "Q2" },
              { row: 1, col: 3, value: "Q3" },
              { row: 2, col: 1, value: 10 },
              { row: 2, col: 2, value: 20 },
              { row: 2, col: 3, value: 30 },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 3 },
          targetEntityDefinitionId: "revenue",
          headerAxes: ["row"],
        },
      ],
    };
    const spy: jest.MockedFunction<ClassifierFn> = jest.fn(async () => []);
    const prepared = runUpToDetectSegments(input);
    const state = await classifyFieldSegments(prepared, { classifier: spy });
    expect(spy).not.toHaveBeenCalled();
    const regionId = state.detectedRegions[0].id;
    expect(state.columnClassifications.get(regionId)).toEqual([]);
  });

  it("skips classification when the hint pins a user-sourced pivot over positions detect-segments would otherwise tag as field", async () => {
    // Regression for the pivot-binding bug: ISO-datetime header labels
    // (`2026-01-01T00:00:00.000Z`) don't match detect-segments' date regex,
    // so detect-segments clusters them as a `field` segment. When the hint
    // pins those positions as a user-sourced pivot, classify-field-segments
    // must honor the hint — otherwise the stage emits one bogus columnBinding
    // per datetime header.
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 2, cols: 3 },
            cells: [
              { row: 1, col: 1, value: "2026-01-01T00:00:00.000Z" },
              { row: 1, col: 2, value: "2026-02-01T00:00:00.000Z" },
              { row: 1, col: 3, value: "2026-03-01T00:00:00.000Z" },
              { row: 2, col: 1, value: 100 },
              { row: 2, col: 2, value: 200 },
              { row: 2, col: 3, value: 300 },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 3 },
          targetEntityDefinitionId: "revenue",
          headerAxes: ["row"],
          segmentsByAxis: {
            row: [
              {
                kind: "pivot",
                id: "pivot-1",
                axisName: "timestamp",
                axisNameSource: "user",
                positionCount: 3,
              },
            ],
          },
          cellValueField: { name: "amount", nameSource: "user" },
        },
      ],
    };
    const spy: jest.MockedFunction<ClassifierFn> = jest.fn(async () => []);
    const prepared = runUpToDetectSegments(input);
    const state = await classifyFieldSegments(prepared, { classifier: spy });
    expect(spy).not.toHaveBeenCalled();
    const regionId = state.detectedRegions[0].id;
    expect(state.columnClassifications.get(regionId)).toEqual([]);
  });

  it("iterates both axes on 2D regions and merges field candidates", async () => {
    // Crosstab with a one-position field segment on each axis (the anchor
    // position), plus a pivot. classify should pass the field positions
    // from both axes to the classifier in one merged call.
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 5, cols: 5 },
            cells: [
              { row: 1, col: 1, value: "Sales" },
              { row: 1, col: 2, value: "Jan" },
              { row: 1, col: 3, value: "Feb" },
              { row: 1, col: 4, value: "Mar" },
              { row: 1, col: 5, value: "Apr" },
              { row: 2, col: 1, value: "Q1" },
              { row: 3, col: 1, value: "Q2" },
              { row: 4, col: 1, value: "Q3" },
              { row: 5, col: 1, value: "Q4" },
              // body cells omitted — classifier only reads the header line.
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 5, endCol: 5 },
          targetEntityDefinitionId: "crosstab",
          headerAxes: ["row", "column"],
          axisAnchorCell: { row: 1, col: 1 },
        },
      ],
    };
    const spy: jest.MockedFunction<ClassifierFn> = jest.fn(async () => []);
    const prepared = runUpToDetectSegments(input);
    await classifyFieldSegments(prepared, { classifier: spy });
    expect(spy).toHaveBeenCalledTimes(1);
    const [candidates] = spy.mock.calls[0]!;
    // "Sales" shows up twice — once as the row-axis field at col 1 and once
    // as the column-axis field at row 1 — because both axes share the
    // anchor position and detect-segments clusters it into a field segment
    // on each axis.
    const headers = candidates.map((c) => c.sourceHeader).sort();
    expect(headers).toEqual(["Sales", "Sales"]);
  });
});

describe("classifyFieldSegments — injected classifier override", () => {
  it("delegates entirely to the injected ClassifierFn when one is provided", async () => {
    const injected: jest.MockedFunction<ClassifierFn> = jest.fn(
      async (cands) => {
        return cands.map<ColumnClassification>((c) => ({
          sourceHeader: c.sourceHeader,
          sourceCol: c.sourceCol,
          columnDefinitionId: `semantic-${c.sourceHeader}`,
          confidence: 0.91,
          rationale: "ai",
        }));
      }
    );
    const prepared = runUpToDetectSegments(simpleInput());
    const state = await classifyFieldSegments(prepared, {
      classifier: injected,
      columnDefinitionCatalog: DEFAULT_CATALOG,
    });
    expect(injected).toHaveBeenCalledTimes(1);
    const regionId = state.detectedRegions[0].id;
    const classifications = state.columnClassifications.get(regionId)!;
    expect(classifications.map((c) => c.columnDefinitionId)).toEqual(
      expect.arrayContaining([
        "semantic-email",
        "semantic-First Name",
        "semantic-age",
      ])
    );
    expect(classifications[0].confidence).toBe(0.91);
  });

  it("runs the classifier for multiple regions concurrently, bounded by the concurrency cap", async () => {
    const input: InterpretInput = {
      workbook: {
        sheets: ["A", "B", "C"].map((name) => ({
          name,
          dimensions: { rows: 2, cols: 2 },
          cells: [
            { row: 1, col: 1, value: "h1" },
            { row: 1, col: 2, value: "h2" },
            { row: 2, col: 1, value: "v1" },
            { row: 2, col: 2, value: "v2" },
          ],
        })),
      },
      regionHints: ["A", "B", "C"].map((sheet) => ({
        sheet,
        bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
        targetEntityDefinitionId: `ent-${sheet}`,
        headerAxes: ["row"],
      })),
    };

    let active = 0;
    let peak = 0;
    const injected: jest.MockedFunction<ClassifierFn> = jest.fn(
      async (cands) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
        return cands.map<ColumnClassification>((c) => ({
          sourceHeader: c.sourceHeader,
          sourceCol: c.sourceCol,
          columnDefinitionId: `cd-${c.sourceHeader}`,
          confidence: 0.9,
          rationale: "ai",
        }));
      }
    );
    const prepared = runUpToDetectSegments(input);
    const state = await classifyFieldSegments(prepared, {
      classifier: injected,
      columnDefinitionCatalog: DEFAULT_CATALOG,
      concurrency: 3,
    });
    expect(injected).toHaveBeenCalledTimes(3);
    expect(peak).toBeGreaterThanOrEqual(2);
    expect(peak).toBeLessThanOrEqual(3);
    for (const region of state.detectedRegions) {
      expect(state.columnClassifications.get(region.id)).toBeTruthy();
    }
  });

  it("respects the concurrency cap when it is lower than the region count", async () => {
    const input: InterpretInput = {
      workbook: {
        sheets: Array.from({ length: 6 }, (_, i) => ({
          name: `S${i}`,
          dimensions: { rows: 2, cols: 2 },
          cells: [
            { row: 1, col: 1, value: "h1" },
            { row: 1, col: 2, value: "h2" },
            { row: 2, col: 1, value: "v1" },
            { row: 2, col: 2, value: "v2" },
          ],
        })),
      },
      regionHints: Array.from({ length: 6 }, (_, i) => ({
        sheet: `S${i}`,
        bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
        targetEntityDefinitionId: `ent-${i}`,
        headerAxes: ["row" as const],
      })),
    };

    let active = 0;
    let peak = 0;
    const injected: jest.MockedFunction<ClassifierFn> = jest.fn(
      async (cands) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
        return cands.map<ColumnClassification>((c) => ({
          sourceHeader: c.sourceHeader,
          sourceCol: c.sourceCol,
          columnDefinitionId: null,
          confidence: 0,
          rationale: "test",
        }));
      }
    );
    const prepared = runUpToDetectSegments(input);
    await classifyFieldSegments(prepared, {
      classifier: injected,
      concurrency: 2,
    });
    expect(injected).toHaveBeenCalledTimes(6);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("drops positions where the field segment marks skipped[i] === true", async () => {
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 2, cols: 3 },
            cells: [
              { row: 1, col: 1, value: "email" },
              { row: 1, col: 2, value: "First Name" },
              { row: 1, col: 3, value: "age" },
              { row: 2, col: 1, value: "a@x.com" },
              { row: 2, col: 2, value: "alice" },
              { row: 2, col: 3, value: 30 },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 3 },
          targetEntityDefinitionId: "contacts",
          headerAxes: ["row"],
          segmentsByAxis: {
            row: [
              {
                kind: "field",
                positionCount: 3,
                skipped: [false, true, false],
              },
            ],
          },
        },
      ],
    };
    const spy: jest.MockedFunction<ClassifierFn> = jest.fn(async () => []);
    const prepared = runUpToDetectSegments(input);
    await classifyFieldSegments(prepared, {
      classifier: spy,
      columnDefinitionCatalog: [],
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const [candidates] = spy.mock.calls[0]!;
    expect(candidates.map((c) => c.sourceHeader)).toEqual(["email", "age"]);
  });

  it("uses headers[i] as sourceHeader when set, regardless of cell contents — the override always wins and is flagged fromHeaderOverride", async () => {
    // Spy on the classifier so we can inspect the candidate stream directly
    // (the heuristic default would round-trip the same data and add catalog-
    // matching noise that obscures the test's intent).
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 4, cols: 3 },
            // Row 1 is the chosen header line. Col 1's header is blank so the
            // override on `headers[0]` is what gives that position a label.
            cells: [
              // Row 1 is the header — col 1 deliberately blank. Data rows
              // are all numeric so detect-headers' string-heavy scoring
              // unambiguously prefers row 1.
              { row: 1, col: 1, value: "" },
              { row: 1, col: 2, value: "name" },
              { row: 1, col: 3, value: "desc" },
              { row: 2, col: 1, value: 1 },
              { row: 2, col: 2, value: 2 },
              { row: 2, col: 3, value: 3 },
              { row: 3, col: 1, value: 4 },
              { row: 3, col: 2, value: 5 },
              { row: 3, col: 3, value: 6 },
              { row: 4, col: 1, value: 7 },
              { row: 4, col: 2, value: 8 },
              { row: 4, col: 3, value: 9 },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 3 },
          targetEntityDefinitionId: "rows",
          headerAxes: ["row"],
          segmentsByAxis: {
            row: [
              {
                kind: "field",
                positionCount: 3,
                headers: ["year", "", ""],
              },
            ],
          },
        },
      ],
    };
    const spy: jest.MockedFunction<ClassifierFn> = jest.fn(
      async (candidates) =>
        candidates.map((c) => ({
          sourceHeader: c.sourceHeader,
          sourceCol: c.sourceCol,
          columnDefinitionId: null,
          confidence: 0,
        }))
    );
    const prepared = runUpToDetectSegments(input);
    const state = await classifyFieldSegments(prepared, {
      classifier: spy,
      columnDefinitionCatalog: [],
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const [candidates] = spy.mock.calls[0]!;
    expect(candidates.map((c) => c.sourceHeader)).toEqual([
      "year",
      "name",
      "desc",
    ]);
    const regionId = state.detectedRegions[0].id;
    const classifications = state.columnClassifications.get(regionId)!;
    const yearClassification = classifications.find(
      (c) => c.sourceHeader === "year"
    );
    expect(yearClassification?.fromHeaderOverride).toBe(true);
    const nameClassification = classifications.find(
      (c) => c.sourceHeader === "name"
    );
    expect(nameClassification?.fromHeaderOverride).toBeUndefined();
  });

  it("override beats a non-empty cell — the user's typed name wins over whatever the cell says", async () => {
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 4, cols: 3 },
            // Row 1 col 1 contains a label the user wants to rename
            // ("YR" → "year"). The override should still win.
            cells: [
              { row: 1, col: 1, value: "YR" },
              { row: 1, col: 2, value: "name" },
              { row: 1, col: 3, value: "desc" },
              { row: 2, col: 1, value: 1 },
              { row: 2, col: 2, value: 2 },
              { row: 2, col: 3, value: 3 },
              { row: 3, col: 1, value: 4 },
              { row: 3, col: 2, value: 5 },
              { row: 3, col: 3, value: 6 },
              { row: 4, col: 1, value: 7 },
              { row: 4, col: 2, value: 8 },
              { row: 4, col: 3, value: 9 },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 3 },
          targetEntityDefinitionId: "rows",
          headerAxes: ["row"],
          segmentsByAxis: {
            row: [
              {
                kind: "field",
                positionCount: 3,
                headers: ["year", "", ""],
              },
            ],
          },
        },
      ],
    };
    const spy: jest.MockedFunction<ClassifierFn> = jest.fn(
      async (candidates) =>
        candidates.map((c) => ({
          sourceHeader: c.sourceHeader,
          sourceCol: c.sourceCol,
          columnDefinitionId: null,
          confidence: 0,
        }))
    );
    const prepared = runUpToDetectSegments(input);
    await classifyFieldSegments(prepared, {
      classifier: spy,
      columnDefinitionCatalog: [],
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const [candidates] = spy.mock.calls[0]!;
    // Position 0 yields the override "year", not the cell value "YR".
    expect(candidates.map((c) => c.sourceHeader)).toEqual([
      "year",
      "name",
      "desc",
    ]);
  });

  it("skips classification entirely for headerless regions", async () => {
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 2, cols: 2 },
            cells: [
              { row: 1, col: 1, value: "a" },
              { row: 1, col: 2, value: "b" },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
          targetEntityDefinitionId: "h",
          headerAxes: [],
          recordsAxis: "row",
        },
      ],
    };
    const injected = jest.fn(async () => []);
    const prepared = runUpToDetectSegments(input);
    const state = await classifyFieldSegments(prepared, {
      classifier: injected,
    });
    const regionId = state.detectedRegions[0].id;
    expect(state.columnClassifications.get(regionId)).toEqual([]);
    expect(injected).not.toHaveBeenCalled();
  });
});
