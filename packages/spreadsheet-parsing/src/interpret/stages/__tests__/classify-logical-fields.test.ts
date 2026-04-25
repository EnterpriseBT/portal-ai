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
