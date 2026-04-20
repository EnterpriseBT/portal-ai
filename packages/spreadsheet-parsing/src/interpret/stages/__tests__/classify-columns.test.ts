import { describe, it, expect, jest } from "@jest/globals";

import type { InterpretInput } from "../../../plan/index.js";
import { createInitialState } from "../../state.js";
import { detectRegions } from "../detect-regions.js";
import { detectHeaders } from "../detect-headers.js";
import { classifyColumns } from "../classify-columns.js";
import type {
  ClassifierFn,
  ColumnClassification,
  ColumnDefinitionCatalogEntry,
} from "../../types.js";

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
        orientation: "rows-as-records",
        headerAxis: "row",
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

describe("classifyColumns — heuristic default", () => {
  it("matches on exact header equality (case-insensitive)", async () => {
    let state = detectRegions(createInitialState(simpleInput()));
    state = detectHeaders(state);
    state = await classifyColumns(state, {
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
    input.workbook.sheets[0].cells[0].value = "E-Mail"; // "e_mail" normalised
    let state = detectRegions(createInitialState(input));
    state = detectHeaders(state);
    state = await classifyColumns(state, {
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
    let state = detectRegions(createInitialState(simpleInput()));
    state = detectHeaders(state);
    state = await classifyColumns(state, {
      columnDefinitionCatalog: DEFAULT_CATALOG,
    });
    const regionId = state.detectedRegions[0].id;
    const classifications = state.columnClassifications.get(regionId)!;
    const ageEntry = classifications.find((c) => c.sourceHeader === "age");
    expect(ageEntry?.columnDefinitionId).toBeNull();
  });

  it("returns null columnDefinitionId for every header when no catalog is supplied", async () => {
    let state = detectRegions(createInitialState(simpleInput()));
    state = detectHeaders(state);
    state = await classifyColumns(state, {});
    const regionId = state.detectedRegions[0].id;
    const classifications = state.columnClassifications.get(regionId)!;
    expect(classifications.every((c) => c.columnDefinitionId === null)).toBe(
      true
    );
  });
});

describe("classifyColumns — injected classifier override", () => {
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
    let state = detectRegions(createInitialState(simpleInput()));
    state = detectHeaders(state);
    state = await classifyColumns(state, {
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

  it("skips classification entirely when headerAxis === 'none' (no headers to classify)", async () => {
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
          orientation: "rows-as-records",
          headerAxis: "none",
        },
      ],
    };
    const injected = jest.fn(async () => []);
    let state = detectRegions(createInitialState(input));
    state = detectHeaders(state);
    state = await classifyColumns(state, { classifier: injected });
    const regionId = state.detectedRegions[0].id;
    expect(state.columnClassifications.get(regionId)).toEqual([]);
    expect(injected).not.toHaveBeenCalled();
  });
});
