import { describe, it, expect } from "@jest/globals";

import {
  RegionSchema,
  type Region,
  type Segment,
  type Terminator,
} from "@portalai/core/contracts";

import {
  addFieldSegment,
  addHeaderAxis,
  convertSegmentKind,
  removeHeaderAxis,
  removeSegment,
  setCellValueField,
  setRecordAxisTerminator,
  setSegmentDynamic,
  splitSegment,
} from "../segment-ops.util";

// ── Builders ─────────────────────────────────────────────────────────────

const SHEET = "Sheet1";

function drift(): Region["drift"] {
  return {
    headerShiftRows: 0,
    addedColumns: "halt",
    removedColumns: { max: 0, action: "halt" },
  };
}

function tidyFieldRegion(positionCount = 3): Region {
  return {
    id: "r1",
    sheet: SHEET,
    bounds: { startRow: 1, startCol: 1, endRow: 5, endCol: positionCount },
    targetEntityDefinitionId: "entity-1",
    headerAxes: ["row"],
    segmentsByAxis: {
      row: [{ kind: "field", positionCount }],
    },
    headerStrategyByAxis: {
      row: {
        kind: "row",
        locator: { kind: "row", sheet: SHEET, row: 1 },
        confidence: 1,
      },
    },
    identityStrategy: { kind: "rowPosition", confidence: 0.6 },
    columnBindings: Array.from({ length: positionCount }, (_, i) => ({
      sourceLocator: {
        kind: "byHeaderName" as const,
        axis: "row" as const,
        name: `col${i + 1}`,
      },
      columnDefinitionId: `coldef-${i + 1}`,
      confidence: 0.9,
    })),
    skipRules: [],
    drift: drift(),
    confidence: { region: 1, aggregate: 1 },
    warnings: [],
  };
}

function pivotRegion(): Region {
  return {
    id: "r2",
    sheet: SHEET,
    bounds: { startRow: 1, startCol: 1, endRow: 5, endCol: 4 },
    targetEntityDefinitionId: "entity-1",
    headerAxes: ["row"],
    segmentsByAxis: {
      row: [
        {
          kind: "pivot",
          id: "pivot-1",
          axisName: "Quarter",
          axisNameSource: "user",
          positionCount: 4,
        },
      ],
    },
    cellValueField: { name: "Revenue", nameSource: "user" },
    headerStrategyByAxis: {
      row: {
        kind: "row",
        locator: { kind: "row", sheet: SHEET, row: 1 },
        confidence: 1,
      },
    },
    identityStrategy: { kind: "rowPosition", confidence: 0.6 },
    columnBindings: [],
    skipRules: [],
    drift: drift(),
    confidence: { region: 1, aggregate: 1 },
    warnings: [],
  };
}

function crosstabRegion(): Region {
  return {
    id: "r3",
    sheet: SHEET,
    bounds: { startRow: 1, startCol: 1, endRow: 5, endCol: 5 },
    targetEntityDefinitionId: "entity-1",
    headerAxes: ["row", "column"],
    segmentsByAxis: {
      row: [
        { kind: "skip", positionCount: 1 },
        {
          kind: "pivot",
          id: "row-pivot",
          axisName: "Region",
          axisNameSource: "user",
          positionCount: 4,
        },
      ],
      column: [
        { kind: "skip", positionCount: 1 },
        {
          kind: "pivot",
          id: "col-pivot",
          axisName: "Quarter",
          axisNameSource: "user",
          positionCount: 4,
        },
      ],
    },
    cellValueField: { name: "Revenue", nameSource: "user" },
    axisAnchorCell: { row: 1, col: 1 },
    headerStrategyByAxis: {
      row: {
        kind: "row",
        locator: { kind: "row", sheet: SHEET, row: 1 },
        confidence: 1,
      },
      column: {
        kind: "column",
        locator: { kind: "column", sheet: SHEET, col: 1 },
        confidence: 1,
      },
    },
    identityStrategy: {
      kind: "composite",
      sourceLocators: [
        { kind: "column", sheet: SHEET, col: 1 },
        { kind: "row", sheet: SHEET, row: 1 },
      ],
      joiner: "|",
      confidence: 0.85,
    },
    columnBindings: [],
    skipRules: [],
    drift: drift(),
    confidence: { region: 1, aggregate: 1 },
    warnings: [],
  };
}

function headerlessRegion(): Region {
  return {
    id: "r4",
    sheet: SHEET,
    bounds: { startRow: 1, startCol: 1, endRow: 5, endCol: 3 },
    targetEntityDefinitionId: "entity-1",
    headerAxes: [],
    recordsAxis: "row",
    identityStrategy: { kind: "rowPosition", confidence: 0.6 },
    columnBindings: [
      {
        sourceLocator: {
          kind: "byPositionIndex",
          axis: "column",
          index: 1,
        },
        columnDefinitionId: "coldef-1",
        confidence: 0.8,
      },
    ],
    skipRules: [],
    drift: drift(),
    confidence: { region: 1, aggregate: 1 },
    warnings: [],
  };
}

function assertValid(region: Region): void {
  const parsed = RegionSchema.safeParse(region);
  if (!parsed.success) {
    throw new Error(
      `Region schema validation failed:\n${JSON.stringify(parsed.error.issues, null, 2)}`
    );
  }
}

function rowSegs(region: Region): Segment[] {
  return region.segmentsByAxis?.row ?? [];
}

function colSegs(region: Region): Segment[] {
  return region.segmentsByAxis?.column ?? [];
}

// ── splitSegment ─────────────────────────────────────────────────────────

describe("splitSegment", () => {
  it("splits a field segment at an offset into two field segments", () => {
    const region = tidyFieldRegion(3);
    const next = splitSegment(region, "row", 0, 1);
    const expected: Segment[] = [
      { kind: "field", positionCount: 1 },
      { kind: "field", positionCount: 2 },
    ];
    expect(rowSegs(next)).toEqual(expected);
    assertValid(next);
  });

  it("rejects an offset outside the segment", () => {
    const region = tidyFieldRegion(3);
    expect(() => splitSegment(region, "row", 0, 0)).toThrow();
    expect(() => splitSegment(region, "row", 0, 3)).toThrow();
    expect(() => splitSegment(region, "row", 0, 4)).toThrow();
  });

  it("rejects splitting a dynamic segment (would create mid-axis dynamic)", () => {
    const region = pivotRegion();
    const withDynamic = setSegmentDynamic(region, "row", 0, {
      kind: "untilBlank",
      consecutiveBlanks: 2,
    });
    expect(() => splitSegment(withDynamic, "row", 0, 1)).toThrow(
      /dynamic/i
    );
  });
});

// ── convertSegmentKind ───────────────────────────────────────────────────

describe("convertSegmentKind", () => {
  it("field → pivot inserts an axisName with source 'user'", () => {
    const region = tidyFieldRegion(3);
    const next = convertSegmentKind(region, "row", 0, "pivot", {
      axisName: "Quarter",
    });
    const seg = rowSegs(next)[0];
    expect(seg.kind).toBe("pivot");
    if (seg.kind !== "pivot") throw new Error("unreachable");
    expect(seg.axisName).toBe("Quarter");
    expect(seg.axisNameSource).toBe("user");
    expect(seg.positionCount).toBe(3);
    expect(next.cellValueField).toBeDefined();
    assertValid(next);
  });

  it("pivot → field removes the pivot metadata (including dynamic)", () => {
    const region = pivotRegion();
    const withDynamic = setSegmentDynamic(region, "row", 0, {
      kind: "untilBlank",
      consecutiveBlanks: 2,
    });
    const next = convertSegmentKind(withDynamic, "row", 0, "field");
    const expected: Segment[] = [{ kind: "field", positionCount: 4 }];
    expect(rowSegs(next)).toEqual(expected);
    expect(next.cellValueField).toBeUndefined();
    assertValid(next);
  });

  it("any → skip preserves positionCount and drops dynamic/axisName", () => {
    const region = pivotRegion();
    const next = convertSegmentKind(region, "row", 0, "skip");
    const expected: Segment[] = [{ kind: "skip", positionCount: 4 }];
    expect(rowSegs(next)).toEqual(expected);
    expect(next.cellValueField).toBeUndefined();
    assertValid(next);
  });
});

// ── addHeaderAxis ────────────────────────────────────────────────────────

describe("addHeaderAxis", () => {
  it("promotes a 1D region to crosstab with a default skip segment at the intersection", () => {
    const region = tidyFieldRegion(3);
    const next = addHeaderAxis(region, "column");
    expect(next.headerAxes).toEqual(["row", "column"]);
    const columnSpan = region.bounds.endRow - region.bounds.startRow + 1;
    const expected: Segment[] = [{ kind: "skip", positionCount: columnSpan }];
    expect(colSegs(next)).toEqual(expected);
    expect(next.headerStrategyByAxis?.column).toBeDefined();
    assertValid(next);
  });

  it("is a no-op when the axis is already present", () => {
    const region = tidyFieldRegion(3);
    const next = addHeaderAxis(region, "row");
    expect(next).toEqual(region);
  });

  it("leaves existing byHeaderName bindings (axis:'row') untouched when promoting to 2D", () => {
    const region = tidyFieldRegion(3);
    const next = addHeaderAxis(region, "column");
    expect(next.columnBindings).toEqual(region.columnBindings);
    assertValid(next);
  });
});

// ── removeHeaderAxis ─────────────────────────────────────────────────────

describe("removeHeaderAxis", () => {
  it("collapses a crosstab to 1D and drops that axis's segments", () => {
    const region = crosstabRegion();
    const next = removeHeaderAxis(region, "column");
    expect(next.headerAxes).toEqual(["row"]);
    expect(next.segmentsByAxis?.column).toBeUndefined();
    expect(next.headerStrategyByAxis?.column).toBeUndefined();
    assertValid(next);
  });

  it("removes pivot segments on the removed axis from cellValueField scope", () => {
    const region: Region = {
      ...crosstabRegion(),
      segmentsByAxis: {
        row: [
          { kind: "skip", positionCount: 1 },
          { kind: "field", positionCount: 4 },
        ],
        column: [
          { kind: "skip", positionCount: 1 },
          {
            kind: "pivot",
            id: "col-only-pivot",
            axisName: "Quarter",
            axisNameSource: "user",
            positionCount: 4,
          },
        ],
      },
    };
    const next = removeHeaderAxis(region, "column");
    expect(next.cellValueField).toBeUndefined();
    expect(next.headerAxes).toEqual(["row"]);
    assertValid(next);
  });

  it("drops any columnBinding whose sourceLocator.axis matches the removed axis", () => {
    const region: Region = {
      ...crosstabRegion(),
      columnBindings: [
        {
          sourceLocator: {
            kind: "byHeaderName",
            axis: "row",
            name: "row-binding",
          },
          columnDefinitionId: "coldef-row",
          confidence: 0.9,
        },
        {
          sourceLocator: {
            kind: "byHeaderName",
            axis: "column",
            name: "col-binding",
          },
          columnDefinitionId: "coldef-col",
          confidence: 0.9,
        },
      ],
    };
    const next = removeHeaderAxis(region, "column");
    expect(next.columnBindings).toHaveLength(1);
    expect(next.columnBindings[0].sourceLocator.axis).toBe("row");
    assertValid(next);
  });
});

// ── addFieldSegment / removeSegment ──────────────────────────────────────

describe("addFieldSegment / removeSegment", () => {
  it("merges adjacent same-kind segments after removal", () => {
    const region: Region = {
      ...tidyFieldRegion(3),
      bounds: { startRow: 1, startCol: 1, endRow: 5, endCol: 5 },
      segmentsByAxis: {
        row: [
          { kind: "field", positionCount: 2 },
          { kind: "skip", positionCount: 1 },
          { kind: "field", positionCount: 2 },
        ],
      },
      columnBindings: [],
    };
    const next = removeSegment(region, "row", 1);
    const expected: Segment[] = [{ kind: "field", positionCount: 4 }];
    expect(rowSegs(next)).toEqual(expected);
    // Bounds shrink to keep sum-of-positions === span.
    expect(next.bounds.endCol - next.bounds.startCol + 1).toBe(4);
    assertValid(next);
  });

  it("rejects removing the only segment on an axis without headerAxes collapse", () => {
    const region = tidyFieldRegion(3);
    expect(() => removeSegment(region, "row", 0)).toThrow();
  });

  it("addFieldSegment inserts a field segment and expands the axis span", () => {
    const region = tidyFieldRegion(3);
    const next = addFieldSegment(region, "row", 1, 2);
    // Adjacent same-kind field segments coalesce into one.
    const expected: Segment[] = [{ kind: "field", positionCount: 5 }];
    expect(rowSegs(next)).toEqual(expected);
    expect(next.bounds.endCol - next.bounds.startCol + 1).toBe(5);
    assertValid(next);
  });
});

// ── setCellValueField ────────────────────────────────────────────────────

describe("setCellValueField", () => {
  it("creates cellValueField when the first pivot segment appears", () => {
    const region = tidyFieldRegion(3);
    expect(region.cellValueField).toBeUndefined();
    const next = convertSegmentKind(region, "row", 0, "pivot", {
      axisName: "Quarter",
    });
    expect(next.cellValueField).toBeDefined();
    assertValid(next);
  });

  it("removes cellValueField when the last pivot segment disappears", () => {
    const region = pivotRegion();
    expect(region.cellValueField).toBeDefined();
    const next = convertSegmentKind(region, "row", 0, "field");
    expect(next.cellValueField).toBeUndefined();
    assertValid(next);
  });

  it("explicit setter is dropped when no pivot exists (auto-drop invariant)", () => {
    const region = tidyFieldRegion(3);
    const next = setCellValueField(region, {
      name: "Revenue",
      nameSource: "user",
    });
    expect(next.cellValueField).toBeUndefined();
    assertValid(next);
  });

  it("explicit setter updates the cellValueField when a pivot exists", () => {
    const region = pivotRegion();
    const next = setCellValueField(region, {
      name: "Profit",
      nameSource: "user",
    });
    expect(next.cellValueField?.name).toBe("Profit");
    assertValid(next);
  });
});

// ── setSegmentDynamic ────────────────────────────────────────────────────

describe("setSegmentDynamic", () => {
  it("attaches dynamic { terminator: untilBlank } to a tail pivot segment", () => {
    const region = pivotRegion();
    const terminator: Terminator = {
      kind: "untilBlank",
      consecutiveBlanks: 2,
    };
    const next = setSegmentDynamic(region, "row", 0, terminator);
    const seg = rowSegs(next)[0];
    if (seg.kind !== "pivot") throw new Error("expected pivot");
    expect(seg.dynamic).toEqual({ terminator });
    assertValid(next);
  });

  it("removes dynamic when the terminator argument is null", () => {
    const region = pivotRegion();
    const withDynamic = setSegmentDynamic(region, "row", 0, {
      kind: "untilBlank",
      consecutiveBlanks: 2,
    });
    const next = setSegmentDynamic(withDynamic, "row", 0, null);
    const seg = rowSegs(next)[0];
    if (seg.kind !== "pivot") throw new Error("expected pivot");
    expect(seg.dynamic).toBeUndefined();
    assertValid(next);
  });

  it("rejects enabling dynamic on a non-tail segment (refinement 10)", () => {
    const region = crosstabRegion();
    // On the column axis: [skip(1), pivot(4)] — index 0 is a non-tail skip,
    // but even if it were a pivot the rule is "tail only". Use a multi-pivot
    // axis to exercise the non-tail pivot case.
    const multiPivotRow: Region = {
      ...region,
      segmentsByAxis: {
        ...region.segmentsByAxis,
        row: [
          {
            kind: "pivot",
            id: "p1",
            axisName: "A",
            axisNameSource: "user",
            positionCount: 2,
          },
          {
            kind: "pivot",
            id: "p2",
            axisName: "B",
            axisNameSource: "user",
            positionCount: 2,
          },
          { kind: "skip", positionCount: 1 },
        ],
      },
    };
    expect(() =>
      setSegmentDynamic(multiPivotRow, "row", 0, {
        kind: "untilBlank",
        consecutiveBlanks: 2,
      })
    ).toThrow(/tail/i);
  });

  it("rejects enabling dynamic on a field or skip segment", () => {
    const region = tidyFieldRegion(3);
    expect(() =>
      setSegmentDynamic(region, "row", 0, {
        kind: "untilBlank",
        consecutiveBlanks: 2,
      })
    ).toThrow(/pivot/i);

    const skipTail: Region = {
      ...region,
      segmentsByAxis: {
        row: [
          { kind: "field", positionCount: 2 },
          { kind: "skip", positionCount: 1 },
        ],
      },
    };
    expect(() =>
      setSegmentDynamic(skipTail, "row", 1, {
        kind: "untilBlank",
        consecutiveBlanks: 2,
      })
    ).toThrow(/pivot/i);
  });

  it("rejects a second dynamic segment on the same axis", () => {
    const region = pivotRegion();
    const withDynamic = setSegmentDynamic(region, "row", 0, {
      kind: "untilBlank",
      consecutiveBlanks: 2,
    });
    // Force an additional pivot after the dynamic tail so setSegmentDynamic
    // can be invoked on a second target; the invariant rejects it.
    const forcedTwoPivots: Region = {
      ...withDynamic,
      bounds: {
        ...withDynamic.bounds,
        endCol: withDynamic.bounds.endCol + 2,
      },
      segmentsByAxis: {
        row: [
          {
            kind: "pivot",
            id: "p-extra",
            axisName: "Extra",
            axisNameSource: "user",
            positionCount: 2,
          },
          ...(withDynamic.segmentsByAxis?.row ?? []),
        ],
      },
    };
    expect(() =>
      setSegmentDynamic(forcedTwoPivots, "row", 0, {
        kind: "untilBlank",
        consecutiveBlanks: 2,
      })
    ).toThrow();
  });
});

// ── setRecordAxisTerminator ──────────────────────────────────────────────

describe("setRecordAxisTerminator", () => {
  it("attaches recordAxisTerminator on a 1D region", () => {
    const region = tidyFieldRegion(3);
    const terminator: Terminator = {
      kind: "untilBlank",
      consecutiveBlanks: 2,
    };
    const next = setRecordAxisTerminator(region, terminator);
    expect(next.recordAxisTerminator).toEqual(terminator);
    assertValid(next);
  });

  it("attaches recordAxisTerminator on a headerless region with recordsAxis set", () => {
    const region = headerlessRegion();
    const terminator: Terminator = { kind: "matchesPattern", pattern: "^END$" };
    const next = setRecordAxisTerminator(region, terminator);
    expect(next.recordAxisTerminator).toEqual(terminator);
    assertValid(next);
  });

  it("rejects on a 2D region (refinement 11)", () => {
    const region = crosstabRegion();
    expect(() =>
      setRecordAxisTerminator(region, {
        kind: "untilBlank",
        consecutiveBlanks: 2,
      })
    ).toThrow(/crosstab|2d/i);
  });

  it("removes recordAxisTerminator when terminator is null", () => {
    const region = tidyFieldRegion(3);
    const withTerm = setRecordAxisTerminator(region, {
      kind: "untilBlank",
      consecutiveBlanks: 2,
    });
    const next = setRecordAxisTerminator(withTerm, null);
    expect(next.recordAxisTerminator).toBeUndefined();
    assertValid(next);
  });
});
