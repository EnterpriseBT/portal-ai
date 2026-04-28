import { describe, it, expect, jest } from "@jest/globals";

import type { InterpretInput, Segment } from "../../../plan/index.js";
import { createInitialState } from "../../state.js";
import type {
  ClassifierFn,
  ColumnClassification,
  ColumnDefinitionCatalogEntry,
  InterpretState,
} from "../../types.js";
import { classifyFieldSegments } from "../classify-field-segments.js";
import { classifyLogicalFields } from "../classify-logical-fields.js";
import { detectHeaders } from "../detect-headers.js";
import { detectIdentity } from "../detect-identity.js";
import { detectRegions } from "../detect-regions.js";
import { detectSegments } from "../detect-segments.js";
import { proposeBindings } from "../propose-bindings.js";
import { recommendSegmentAxisNames } from "../recommend-segment-axis-names.js";

async function runThroughProposeBindings(
  input: InterpretInput,
  classifier?: ClassifierFn
): Promise<InterpretState> {
  let state = createInitialState(input);
  state = detectRegions(state);
  state = detectHeaders(state);
  state = detectIdentity(state);
  state = detectSegments(state);
  state = await classifyFieldSegments(state, { classifier });
  state = await recommendSegmentAxisNames(state, {});
  state = proposeBindings(state);
  return state;
}

function pivotInput(): InterpretInput {
  // Single-axis pivot region: row 1 = six ISO datetimes the user has pinned
  // as a pivot segment (timestamp / amount) — the same shape as the bug
  // report. Identity sits in col 1.
  return {
    workbook: {
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 3, cols: 7 },
          cells: [
            { row: 1, col: 1, value: "id" },
            { row: 1, col: 2, value: "2026-01-01T00:00:00.000Z" },
            { row: 1, col: 3, value: "2026-02-01T00:00:00.000Z" },
            { row: 1, col: 4, value: "2026-03-01T00:00:00.000Z" },
            { row: 1, col: 5, value: "2026-04-01T00:00:00.000Z" },
            { row: 1, col: 6, value: "2026-05-01T00:00:00.000Z" },
            { row: 1, col: 7, value: "2026-06-01T00:00:00.000Z" },
            { row: 2, col: 1, value: "e1" },
            { row: 2, col: 2, value: 100 },
            { row: 2, col: 3, value: 200 },
            { row: 2, col: 4, value: 300 },
            { row: 2, col: 5, value: 400 },
            { row: 2, col: 6, value: 500 },
            { row: 2, col: 7, value: 600 },
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Sheet1",
        bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 7 },
        targetEntityDefinitionId: "events",
        headerAxes: ["row"],
        segmentsByAxis: {
          row: [
            { kind: "field", positionCount: 1 },
            {
              kind: "pivot",
              id: "pivot-1",
              axisName: "timestamp",
              axisNameSource: "user",
              positionCount: 6,
            },
          ],
        },
        cellValueField: { name: "amount", nameSource: "user" },
      },
    ],
  };
}

const CATALOG: ColumnDefinitionCatalogEntry[] = [
  { id: "col-timestamp", label: "Timestamp", normalizedKey: "timestamp" },
  { id: "col-amount", label: "Amount", normalizedKey: "amount" },
  { id: "col-id", label: "Id", normalizedKey: "id" },
];

describe("classifyLogicalFields — built-in heuristic", () => {
  it("binds pivot segment axisName via name match", async () => {
    const state = await runThroughProposeBindings(pivotInput());
    const next = await classifyLogicalFields(state, {
      columnDefinitionCatalog: CATALOG,
    });
    const region = next.detectedRegions[0];
    const pivot = region.segmentsByAxis?.row?.find(
      (s): s is Extract<Segment, { kind: "pivot" }> => s.kind === "pivot"
    );
    expect(pivot?.columnDefinitionId).toBe("col-timestamp");
  });

  it("binds cellValueField.name via name match", async () => {
    const state = await runThroughProposeBindings(pivotInput());
    const next = await classifyLogicalFields(state, {
      columnDefinitionCatalog: CATALOG,
    });
    const region = next.detectedRegions[0];
    expect(region.cellValueField?.columnDefinitionId).toBe("col-amount");
  });

  it("leaves slots unset when the catalog has no match", async () => {
    const state = await runThroughProposeBindings(pivotInput());
    const next = await classifyLogicalFields(state, {
      columnDefinitionCatalog: [
        { id: "col-unrelated", label: "Something Else" },
      ],
    });
    const region = next.detectedRegions[0];
    const pivot = region.segmentsByAxis?.row?.find(
      (s): s is Extract<Segment, { kind: "pivot" }> => s.kind === "pivot"
    );
    expect(pivot?.columnDefinitionId).toBeUndefined();
    expect(region.cellValueField?.columnDefinitionId).toBeUndefined();
  });

  it("falls back to defaultColumnDefinitionId when the catalog has no match", async () => {
    const state = await runThroughProposeBindings(pivotInput());
    const next = await classifyLogicalFields(state, {
      columnDefinitionCatalog: [
        { id: "col-unrelated", label: "Something Else" },
      ],
      defaultColumnDefinitionId: "col-text",
    });
    const region = next.detectedRegions[0];
    const pivot = region.segmentsByAxis?.row?.find(
      (s): s is Extract<Segment, { kind: "pivot" }> => s.kind === "pivot"
    );
    // Both pivot axisName and cellValueField land on the fallback so the
    // review step never shows an unbound logical field.
    expect(pivot?.columnDefinitionId).toBe("col-text");
    expect(region.cellValueField?.columnDefinitionId).toBe("col-text");
  });

  it("is a no-op for regions with no pivot segment", async () => {
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 2, cols: 2 },
            cells: [
              { row: 1, col: 1, value: "email" },
              { row: 1, col: 2, value: "name" },
              { row: 2, col: 1, value: "a@x.com" },
              { row: 2, col: 2, value: "Alice" },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
          targetEntityDefinitionId: "contacts",
          headerAxes: ["row"],
        },
      ],
    };
    const spy: jest.MockedFunction<ClassifierFn> = jest.fn(async () => []);
    const state = await runThroughProposeBindings(input);
    await classifyLogicalFields(state, {
      classifier: spy,
      columnDefinitionCatalog: CATALOG,
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("classifyLogicalFields — injected classifier", () => {
  it("routes pivot-axis vs. cellValueField classifications by sourceHeader", async () => {
    const classifier: jest.MockedFunction<ClassifierFn> = jest.fn(async (cands) =>
      cands.map<ColumnClassification>((c) => ({
        sourceHeader: c.sourceHeader,
        sourceCol: c.sourceCol,
        columnDefinitionId: c.sourceHeader === "timestamp" ? "custom-ts" : "custom-amt",
        confidence: 0.99,
        rationale: "ai",
      }))
    );
    const state = await runThroughProposeBindings(pivotInput());
    const next = await classifyLogicalFields(state, {
      classifier,
      columnDefinitionCatalog: CATALOG,
    });

    // One call per region with both logical-field candidates.
    expect(classifier).toHaveBeenCalledTimes(1);
    const [cands] = classifier.mock.calls[0]!;
    expect(cands.map((c) => c.sourceHeader).sort()).toEqual([
      "amount",
      "timestamp",
    ]);

    const region = next.detectedRegions[0];
    const pivot = region.segmentsByAxis?.row?.find(
      (s): s is Extract<Segment, { kind: "pivot" }> => s.kind === "pivot"
    );
    expect(pivot?.columnDefinitionId).toBe("custom-ts");
    expect(region.cellValueField?.columnDefinitionId).toBe("custom-amt");
  });

  it("forwards a sample of header labels for pivot segments and data cells for cellValueField", async () => {
    const classifier: jest.MockedFunction<ClassifierFn> = jest.fn(async () => []);
    const state = await runThroughProposeBindings(pivotInput());
    await classifyLogicalFields(state, {
      classifier,
      columnDefinitionCatalog: CATALOG,
    });
    const [cands] = classifier.mock.calls[0]!;
    const ts = cands.find((c) => c.sourceHeader === "timestamp");
    const amt = cands.find((c) => c.sourceHeader === "amount");
    expect(ts?.samples[0]).toBe("2026-01-01T00:00:00.000Z");
    expect(ts?.samples.length).toBe(6);
    expect(amt?.samples).toEqual(expect.arrayContaining(["100", "200"]));
  });
});

// 2D crosstab with two pivot×pivot intersections, each carrying its own
// override cell-value field name. Each intersection's columnDefinitionId
// should be classified independently.
function crosstabWithTwoIntersectionsInput(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 4, cols: 5 },
          cells: [
            // Row 1 = column-axis labels for two pivot segments.
            { row: 1, col: 1, value: "Region" },
            { row: 1, col: 2, value: "Q1" },
            { row: 1, col: 3, value: "Q2" },
            { row: 1, col: 4, value: "Q3" },
            { row: 1, col: 5, value: "Q4" },
            // Col 1 (rows 2-4) = row-axis labels.
            { row: 2, col: 1, value: "North" },
            { row: 3, col: 1, value: "South" },
            { row: 4, col: 1, value: "East" },
            // Body cells (numeric).
            { row: 2, col: 2, value: 100 },
            { row: 2, col: 3, value: 110 },
            { row: 2, col: 4, value: 120 },
            { row: 2, col: 5, value: 130 },
            { row: 3, col: 2, value: 200 },
            { row: 3, col: 3, value: 210 },
            { row: 3, col: 4, value: 220 },
            { row: 3, col: 5, value: 230 },
            { row: 4, col: 2, value: 300 },
            { row: 4, col: 3, value: 310 },
            { row: 4, col: 4, value: 320 },
            { row: 4, col: 5, value: 330 },
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Sheet1",
        bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 5 },
        targetEntityDefinitionId: "metrics-by-region-quarter",
        headerAxes: ["row", "column"],
        segmentsByAxis: {
          row: [
            { kind: "skip", positionCount: 1 },
            {
              kind: "pivot",
              id: "rp1",
              axisName: "Region",
              axisNameSource: "user",
              positionCount: 4,
            },
          ],
          column: [
            { kind: "skip", positionCount: 1 },
            {
              kind: "pivot",
              id: "cp1",
              axisName: "Quarter",
              axisNameSource: "user",
              positionCount: 3,
            },
          ],
        },
        cellValueField: { name: "Revenue", nameSource: "user" },
      },
    ],
  };
}

describe("classifyLogicalFields — per-intersection cellValueField", () => {
  it("emits one classifier candidate per intersectionCellValueField in addition to the region-level one", async () => {
    const classifier: jest.MockedFunction<ClassifierFn> = jest.fn(
      async (cands) =>
        cands.map<ColumnClassification>((c) => ({
          sourceHeader: c.sourceHeader,
          sourceCol: c.sourceCol,
          columnDefinitionId: null,
          confidence: 0,
          rationale: "ai",
        }))
    );
    const state = await runThroughProposeBindings(
      crosstabWithTwoIntersectionsInput()
    );
    // Inject the per-intersection overrides AFTER propose-bindings so the
    // runner-stage helpers see a region with both axes populated and the
    // override map present.
    const region = state.detectedRegions[0];
    const augmentedRegion = {
      ...region,
      intersectionCellValueFields: {
        rp1__cp1: { name: "Headcount", nameSource: "user" as const },
      },
    };
    const augmentedState: InterpretState = {
      ...state,
      detectedRegions: [augmentedRegion],
    };
    await classifyLogicalFields(augmentedState, {
      classifier,
      columnDefinitionCatalog: CATALOG,
    });
    const [cands] = classifier.mock.calls[0]!;
    expect(cands.map((c) => c.sourceHeader).sort()).toEqual([
      "Headcount",
      "Quarter",
      "Region",
      "Revenue",
    ]);
  });

  it("writes the matched columnDefinitionId back onto each intersection entry independently", async () => {
    const classifier: jest.MockedFunction<ClassifierFn> = jest.fn(
      async (cands) =>
        cands.map<ColumnClassification>((c) => ({
          sourceHeader: c.sourceHeader,
          sourceCol: c.sourceCol,
          columnDefinitionId:
            c.sourceHeader === "Headcount"
              ? "col-headcount"
              : c.sourceHeader === "Margin"
                ? "col-margin"
                : c.sourceHeader === "Revenue"
                  ? "col-revenue"
                  : null,
          confidence: 0.9,
          rationale: "ai",
        }))
    );
    const state = await runThroughProposeBindings(
      crosstabWithTwoIntersectionsInput()
    );
    const region = state.detectedRegions[0];
    const augmentedRegion = {
      ...region,
      intersectionCellValueFields: {
        rp1__cp1: { name: "Headcount", nameSource: "user" as const },
        // A second override with a different name so each entry's
        // columnDefinitionId can be verified independently.
        "rp1__cp1-clone": { name: "Margin", nameSource: "user" as const },
      },
    };
    const augmentedState: InterpretState = {
      ...state,
      detectedRegions: [augmentedRegion],
    };
    const next = await classifyLogicalFields(augmentedState, {
      classifier,
      columnDefinitionCatalog: CATALOG,
    });
    const out = next.detectedRegions[0];
    expect(
      out.intersectionCellValueFields?.["rp1__cp1"]?.columnDefinitionId
    ).toBe("col-headcount");
    expect(
      out.intersectionCellValueFields?.["rp1__cp1-clone"]?.columnDefinitionId
    ).toBe("col-margin");
    // Region-level cellValueField also gets its own classification — it
    // shares the candidate stream but is keyed by a different name.
    expect(out.cellValueField?.columnDefinitionId).toBe("col-revenue");
  });
});
