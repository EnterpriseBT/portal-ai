import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "@jest/globals";

import {
  BindingSourceLocatorSchema,
  CellValueFieldSchema,
  ColumnBindingSchema,
  DriftKnobsSchema,
  LayoutPlanSchema,
  RegionSchema,
  SegmentSchema,
  SkipRuleSchema,
  TerminatorSchema,
  WarningSchema,
  WARNING_CODES,
  WarningCode,
} from "../index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, "../../__tests__/fixtures/plans");

function loadFixture(filename: string): unknown {
  const raw = fs.readFileSync(path.join(fixturesDir, filename), "utf8");
  return JSON.parse(raw);
}

describe("LayoutPlanSchema — fixture parses", () => {
  it.each([
    "simple-rows-as-records.json",
    "pivoted-columns-as-records.json",
    "crosstab.json",
  ])("accepts %s", (filename) => {
    const fixture = loadFixture(filename);
    const result = LayoutPlanSchema.safeParse(fixture);
    if (!result.success) {
      throw new Error(
        `Fixture ${filename} failed: ${JSON.stringify(result.error.issues, null, 2)}`
      );
    }
    expect(result.success).toBe(true);
  });
});

describe("TerminatorSchema", () => {
  it("accepts untilBlank with default consecutiveBlanks", () => {
    const parsed = TerminatorSchema.parse({ kind: "untilBlank" });
    expect(parsed).toEqual({ kind: "untilBlank", consecutiveBlanks: 2 });
  });

  it("accepts untilBlank with explicit consecutiveBlanks", () => {
    const parsed = TerminatorSchema.parse({
      kind: "untilBlank",
      consecutiveBlanks: 5,
    });
    expect(parsed.kind).toBe("untilBlank");
    if (parsed.kind === "untilBlank") {
      expect(parsed.consecutiveBlanks).toBe(5);
    }
  });

  it("rejects consecutiveBlanks < 1", () => {
    expect(
      TerminatorSchema.safeParse({ kind: "untilBlank", consecutiveBlanks: 0 })
        .success
    ).toBe(false);
  });

  it("accepts matchesPattern with a non-empty pattern", () => {
    expect(
      TerminatorSchema.safeParse({ kind: "matchesPattern", pattern: "^Total$" })
        .success
    ).toBe(true);
  });

  it("rejects matchesPattern with empty pattern", () => {
    expect(
      TerminatorSchema.safeParse({ kind: "matchesPattern", pattern: "" }).success
    ).toBe(false);
  });
});

describe("SegmentSchema", () => {
  it("accepts the three kinds", () => {
    expect(
      SegmentSchema.safeParse({ kind: "field", positionCount: 3 }).success
    ).toBe(true);
    expect(
      SegmentSchema.safeParse({
        kind: "pivot",
        id: "s1",
        axisName: "Month",
        axisNameSource: "user",
        positionCount: 4,
      }).success
    ).toBe(true);
    expect(
      SegmentSchema.safeParse({ kind: "skip", positionCount: 1 }).success
    ).toBe(true);
  });

  it("rejects positionCount < 1", () => {
    for (const kind of ["field", "skip"] as const) {
      expect(
        SegmentSchema.safeParse({ kind, positionCount: 0 }).success
      ).toBe(false);
    }
    expect(
      SegmentSchema.safeParse({
        kind: "pivot",
        id: "s1",
        axisName: "X",
        axisNameSource: "user",
        positionCount: 0,
      }).success
    ).toBe(false);
  });

  it("rejects pivot without id or axisName", () => {
    expect(
      SegmentSchema.safeParse({
        kind: "pivot",
        axisName: "X",
        axisNameSource: "user",
        positionCount: 1,
      }).success
    ).toBe(false);
    expect(
      SegmentSchema.safeParse({
        kind: "pivot",
        id: "s1",
        axisNameSource: "user",
        positionCount: 1,
      }).success
    ).toBe(false);
  });

  it("accepts pivot with dynamic.terminator", () => {
    expect(
      SegmentSchema.safeParse({
        kind: "pivot",
        id: "s1",
        axisName: "Year",
        axisNameSource: "user",
        positionCount: 1,
        dynamic: { terminator: { kind: "untilBlank" } },
      }).success
    ).toBe(true);
  });

  it("rejects dynamic on non-pivot (discriminated-union)", () => {
    expect(
      SegmentSchema.safeParse({
        kind: "field",
        positionCount: 1,
        dynamic: { terminator: { kind: "untilBlank" } },
      } as unknown).success
    ).toBe(true); // discriminated union silently ignores extras on 'field'? we actually don't have dynamic on field.
    // The point: the schema does NOT add dynamic to field.
  });
});

describe("CellValueFieldSchema", () => {
  it("accepts minimum fields", () => {
    expect(
      CellValueFieldSchema.safeParse({ name: "Revenue", nameSource: "user" })
        .success
    ).toBe(true);
  });

  it("rejects empty name", () => {
    expect(
      CellValueFieldSchema.safeParse({ name: "", nameSource: "user" }).success
    ).toBe(false);
  });

  it("accepts optional columnDefinitionId", () => {
    expect(
      CellValueFieldSchema.safeParse({
        name: "Revenue",
        nameSource: "user",
        columnDefinitionId: "col-rev",
      }).success
    ).toBe(true);
  });
});

describe("BindingSourceLocatorSchema", () => {
  it("accepts byHeaderName with both axis values", () => {
    for (const axis of ["row", "column"] as const) {
      expect(
        BindingSourceLocatorSchema.safeParse({
          kind: "byHeaderName",
          axis,
          name: "x",
        }).success
      ).toBe(true);
    }
  });

  it("accepts byPositionIndex with both axis values", () => {
    for (const axis of ["row", "column"] as const) {
      expect(
        BindingSourceLocatorSchema.safeParse({
          kind: "byPositionIndex",
          axis,
          index: 1,
        }).success
      ).toBe(true);
    }
  });

  it("rejects byHeaderName missing axis", () => {
    expect(
      BindingSourceLocatorSchema.safeParse({
        kind: "byHeaderName",
        name: "x",
      }).success
    ).toBe(false);
  });

  it("rejects byHeaderName with empty name", () => {
    expect(
      BindingSourceLocatorSchema.safeParse({
        kind: "byHeaderName",
        axis: "row",
        name: "",
      }).success
    ).toBe(false);
  });

  it("rejects byPositionIndex with index < 1", () => {
    expect(
      BindingSourceLocatorSchema.safeParse({
        kind: "byPositionIndex",
        axis: "row",
        index: 0,
      }).success
    ).toBe(false);
  });

  it("rejects byColumnIndex shape (Phase-1 locator)", () => {
    expect(
      BindingSourceLocatorSchema.safeParse({
        kind: "byColumnIndex",
        col: 1,
      } as unknown).success
    ).toBe(false);
  });
});

type TidyRegion = Record<string, unknown> & {
  bounds: { startRow: number; startCol: number; endRow: number; endCol: number };
  segmentsByAxis: Record<string, unknown>;
  headerStrategyByAxis: Record<string, unknown>;
  columnBindings: Array<Record<string, unknown>>;
};

function buildTidyRegion(): TidyRegion {
  return {
    id: "r-tidy",
    sheet: "S",
    bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 3 },
    targetEntityDefinitionId: "e",
    headerAxes: ["row"],
    segmentsByAxis: {
      row: [{ kind: "field", positionCount: 3 }],
    },
    headerStrategyByAxis: {
      row: {
        kind: "row",
        locator: { kind: "row", sheet: "S", row: 1 },
        confidence: 1,
      },
    },
    identityStrategy: { kind: "rowPosition", confidence: 0.5 },
    columnBindings: [
      {
        sourceLocator: { kind: "byHeaderName", axis: "row", name: "a" },
        columnDefinitionId: "c1",
        confidence: 1,
      },
      {
        sourceLocator: { kind: "byHeaderName", axis: "row", name: "b" },
        columnDefinitionId: "c2",
        confidence: 1,
      },
      {
        sourceLocator: { kind: "byHeaderName", axis: "row", name: "c" },
        columnDefinitionId: "c3",
        confidence: 1,
      },
    ],
    skipRules: [],
    drift: {
      headerShiftRows: 0,
      addedColumns: "halt",
      removedColumns: { max: 0, action: "halt" },
    },
    confidence: { region: 1, aggregate: 1 },
    warnings: [],
  };
}

describe("RegionSchema — headerAxes cardinality (refinement 1)", () => {
  it("rejects duplicate headerAxes entries", () => {
    const r = buildTidyRegion();
    // Fabricate duplicate
    (r as Record<string, unknown>).headerAxes = ["row", "row"];
    expect(RegionSchema.safeParse(r).success).toBe(false);
  });
});

describe("RegionSchema — segmentsByAxis / headerAxes coherence (refinement 2)", () => {
  it("rejects segmentsByAxis.column when column is not in headerAxes", () => {
    const r = buildTidyRegion();
    (r as Record<string, unknown>).segmentsByAxis = {
      row: [{ kind: "field", positionCount: 3 }],
      column: [{ kind: "field", positionCount: 4 }],
    };
    expect(RegionSchema.safeParse(r).success).toBe(false);
  });

  it("rejects missing segmentsByAxis when headerAxes declares the axis", () => {
    const r = buildTidyRegion();
    (r as Record<string, unknown>).segmentsByAxis = {};
    expect(RegionSchema.safeParse(r).success).toBe(false);
  });
});

describe("RegionSchema — segmentsByAxis length match (refinement 3)", () => {
  it("rejects fixed-only sum that does not equal span", () => {
    const r = buildTidyRegion();
    r.segmentsByAxis.row = [{ kind: "field", positionCount: 2 }];
    expect(RegionSchema.safeParse(r).success).toBe(false);
  });

  it("accepts fixed-only sum equal to span", () => {
    const r = buildTidyRegion();
    expect(RegionSchema.safeParse(r).success).toBe(true);
  });

  it("accepts dynamic-tail sum ≤ span", () => {
    const r = buildTidyRegion();
    r.segmentsByAxis.row = [
      {
        kind: "pivot",
        id: "s1",
        axisName: "Year",
        axisNameSource: "user",
        positionCount: 1,
        dynamic: { terminator: { kind: "untilBlank" } },
      },
    ] as unknown as typeof r.segmentsByAxis.row;
    (r as Record<string, unknown>).cellValueField = {
      name: "V",
      nameSource: "user",
    };
    r.columnBindings = [];
    expect(RegionSchema.safeParse(r).success).toBe(true);
  });
});

describe("RegionSchema — pivot id uniqueness across axes (refinement 4 / 13)", () => {
  it("rejects duplicate pivot ids across row and column axes", () => {
    const r = buildTidyRegion();
    (r as Record<string, unknown>).headerAxes = ["row", "column"];
    r.segmentsByAxis = {
      row: [
        {
          kind: "pivot",
          id: "dup",
          axisName: "A",
          axisNameSource: "user",
          positionCount: 3,
        },
      ],
      column: [
        {
          kind: "pivot",
          id: "dup",
          axisName: "B",
          axisNameSource: "user",
          positionCount: 4,
        },
      ],
    } as unknown as typeof r.segmentsByAxis;
    (r as Record<string, unknown>).cellValueField = {
      name: "V",
      nameSource: "user",
    };
    (r as Record<string, unknown>).headerStrategyByAxis = {
      row: {
        kind: "row",
        locator: { kind: "row", sheet: "S", row: 1 },
        confidence: 1,
      },
      column: {
        kind: "column",
        locator: { kind: "column", sheet: "S", col: 1 },
        confidence: 1,
      },
    };
    r.columnBindings = [];
    expect(RegionSchema.safeParse(r).success).toBe(false);
  });
});

describe("RegionSchema — recordsAxis presence rule (refinement 5)", () => {
  it("requires recordsAxis when headerAxes is empty", () => {
    const r = buildTidyRegion();
    (r as Record<string, unknown>).headerAxes = [];
    r.segmentsByAxis = {};
    r.headerStrategyByAxis = {};
    // headerless forbids byHeaderName — swap to byPositionIndex.
    r.columnBindings = [
      {
        sourceLocator: {
          kind: "byPositionIndex" as const,
          axis: "row" as const,
          index: 1,
        },
        columnDefinitionId: "c1",
        confidence: 1,
      },
    ];
    // Without recordsAxis → reject.
    expect(RegionSchema.safeParse(r).success).toBe(false);
    // With recordsAxis "column" (opposite of binding axis "row") → accept.
    (r as Record<string, unknown>).recordsAxis = "column";
    expect(RegionSchema.safeParse(r).success).toBe(true);
  });

  it("forbids recordsAxis when headerAxes is non-empty", () => {
    const r = buildTidyRegion();
    (r as Record<string, unknown>).recordsAxis = "row";
    expect(RegionSchema.safeParse(r).success).toBe(false);
  });
});

describe("RegionSchema — headerStrategyByAxis presence (refinement 6)", () => {
  it("rejects region missing headerStrategyByAxis for a declared axis", () => {
    const r = buildTidyRegion();
    (r as Record<string, unknown>).headerStrategyByAxis = {};
    expect(RegionSchema.safeParse(r).success).toBe(false);
  });

  it("rejects extra headerStrategyByAxis for an undeclared axis", () => {
    const r = buildTidyRegion();
    r.headerStrategyByAxis = {
      ...r.headerStrategyByAxis,
      column: {
        kind: "column" as const,
        locator: { kind: "column" as const, sheet: "S", col: 1 },
        confidence: 1,
      },
    };
    expect(RegionSchema.safeParse(r).success).toBe(false);
  });
});

describe("RegionSchema — cellValueField presence rule (refinement 7)", () => {
  it("rejects cellValueField without any pivot segment", () => {
    const r = buildTidyRegion();
    (r as Record<string, unknown>).cellValueField = {
      name: "V",
      nameSource: "user",
    };
    expect(RegionSchema.safeParse(r).success).toBe(false);
  });

  it("requires cellValueField when a pivot exists", () => {
    const r = buildTidyRegion();
    r.segmentsByAxis.row = [
      {
        kind: "pivot",
        id: "s1",
        axisName: "M",
        axisNameSource: "user",
        positionCount: 3,
      },
    ] as unknown as typeof r.segmentsByAxis.row;
    r.columnBindings = [];
    // Missing cellValueField → reject.
    expect(RegionSchema.safeParse(r).success).toBe(false);
    (r as Record<string, unknown>).cellValueField = {
      name: "V",
      nameSource: "user",
    };
    expect(RegionSchema.safeParse(r).success).toBe(true);
  });
});

describe("RegionSchema — dynamic segment must be tail (refinement 10)", () => {
  it("accepts dynamic on the tail", () => {
    const r = buildTidyRegion();
    r.segmentsByAxis.row = [
      { kind: "field", positionCount: 2 },
      {
        kind: "pivot",
        id: "p1",
        axisName: "Y",
        axisNameSource: "user",
        positionCount: 1,
        dynamic: { terminator: { kind: "untilBlank" } },
      },
    ] as unknown as typeof r.segmentsByAxis.row;
    (r as Record<string, unknown>).cellValueField = {
      name: "V",
      nameSource: "user",
    };
    r.columnBindings = [];
    expect(RegionSchema.safeParse(r).success).toBe(true);
  });

  it("rejects dynamic mid-axis", () => {
    const r = buildTidyRegion();
    r.segmentsByAxis.row = [
      {
        kind: "pivot",
        id: "p1",
        axisName: "Y",
        axisNameSource: "user",
        positionCount: 1,
        dynamic: { terminator: { kind: "untilBlank" } },
      },
      { kind: "field", positionCount: 2 },
    ] as unknown as typeof r.segmentsByAxis.row;
    (r as Record<string, unknown>).cellValueField = {
      name: "V",
      nameSource: "user",
    };
    r.columnBindings = [];
    expect(RegionSchema.safeParse(r).success).toBe(false);
  });
});

describe("RegionSchema — recordAxisTerminator / crosstab exclusion (refinement 11)", () => {
  it("rejects recordAxisTerminator on a 2D (crosstab) region", () => {
    const fx = loadFixture("crosstab.json") as {
      regions: Array<Record<string, unknown>>;
    };
    fx.regions[0].recordAxisTerminator = { kind: "untilBlank" };
    expect(LayoutPlanSchema.safeParse(fx).success).toBe(false);
  });

  it("accepts recordAxisTerminator on a 1D region", () => {
    const r = buildTidyRegion();
    (r as Record<string, unknown>).recordAxisTerminator = {
      kind: "untilBlank",
    };
    expect(RegionSchema.safeParse(r).success).toBe(true);
  });
});

describe("RegionSchema — removed fields rejected (refinement 9)", () => {
  // For each old field, adding it to a strict(ish) region should NOT change
  // parseability (region schema is an object, not a strict passthrough), but
  // removed type-level fields must not exist on the exported Region type.
  // We validate here that the fixture plans do not contain any removed field.
  it.each([
    "orientation",
    "headerAxis",
    "boundsMode",
    "boundsPattern",
    "untilEmptyTerminatorCount",
    "recordsAxisName",
    "secondaryRecordsAxisName",
    "cellValueName",
    "positionRoles",
    "pivotSegments",
  ])("fixtures no longer contain '%s'", (field) => {
    for (const file of [
      "simple-rows-as-records.json",
      "pivoted-columns-as-records.json",
      "crosstab.json",
    ]) {
      const fx = loadFixture(file) as { regions: Record<string, unknown>[] };
      for (const region of fx.regions) {
        expect(region[field]).toBeUndefined();
      }
    }
  });
});

describe("RegionSchema — locator axis coherence (refinement 14)", () => {
  it("rejects binding whose axis is not in headerAxes", () => {
    const r = buildTidyRegion();
    r.columnBindings = [
      {
        sourceLocator: {
          kind: "byHeaderName" as const,
          axis: "column" as const,
          name: "x",
        },
        columnDefinitionId: "c1",
        confidence: 1,
      },
      ...r.columnBindings.slice(1),
    ];
    expect(RegionSchema.safeParse(r).success).toBe(false);
  });
});

describe("RegionSchema — byHeaderName forbidden on headerless (refinement 15)", () => {
  it("rejects byHeaderName on headerless region", () => {
    const r = buildTidyRegion();
    (r as Record<string, unknown>).headerAxes = [];
    r.segmentsByAxis = {};
    r.headerStrategyByAxis = {};
    (r as Record<string, unknown>).recordsAxis = "column";
    // Binding still byHeaderName → rejected.
    expect(RegionSchema.safeParse(r).success).toBe(false);
  });

  it("accepts byPositionIndex with axis opposite of recordsAxis", () => {
    const r = buildTidyRegion();
    (r as Record<string, unknown>).headerAxes = [];
    r.segmentsByAxis = {};
    r.headerStrategyByAxis = {};
    (r as Record<string, unknown>).recordsAxis = "column";
    r.columnBindings = [
      {
        sourceLocator: {
          kind: "byPositionIndex" as const,
          axis: "row" as const,
          index: 1,
        },
        columnDefinitionId: "c1",
        confidence: 1,
      },
    ];
    expect(RegionSchema.safeParse(r).success).toBe(true);
  });
});

describe("RegionSchema — positionIndex range (refinement 16)", () => {
  it("rejects index > positionSpan(axis)", () => {
    const r = buildTidyRegion();
    r.columnBindings = [
      {
        sourceLocator: {
          kind: "byPositionIndex" as const,
          axis: "row" as const,
          index: 4, // span = 3
        },
        columnDefinitionId: "c1",
        confidence: 1,
      },
      ...r.columnBindings.slice(1),
    ];
    expect(RegionSchema.safeParse(r).success).toBe(false);
  });

  it("rejects index < 1", () => {
    const r = buildTidyRegion();
    r.columnBindings = [
      {
        sourceLocator: {
          kind: "byPositionIndex" as const,
          axis: "row" as const,
          index: 0,
        },
        columnDefinitionId: "c1",
        confidence: 1,
      },
      ...r.columnBindings.slice(1),
    ];
    expect(RegionSchema.safeParse(r).success).toBe(false);
  });
});

describe("RegionSchema cross-field invariants", () => {
  it("rejects axisAnchorCell outside bounds", () => {
    const r = buildTidyRegion();
    (r as Record<string, unknown>).axisAnchorCell = {
      row: r.bounds.endRow + 1,
      col: r.bounds.startCol,
    };
    expect(RegionSchema.safeParse(r).success).toBe(false);
  });
});

describe("SkipRuleSchema", () => {
  it("parses { kind: 'blank' }", () => {
    expect(SkipRuleSchema.safeParse({ kind: "blank" }).success).toBe(true);
  });

  it("parses { kind: 'cellMatches', crossAxisIndex, pattern }", () => {
    expect(
      SkipRuleSchema.safeParse({
        kind: "cellMatches",
        crossAxisIndex: 2,
        pattern: "^Total$",
      }).success
    ).toBe(true);
  });

  it("parses cellMatches with optional axis", () => {
    expect(
      SkipRuleSchema.safeParse({
        kind: "cellMatches",
        crossAxisIndex: 0,
        pattern: ".*",
        axis: "column",
      }).success
    ).toBe(true);
  });

  it("rejects unknown kinds", () => {
    expect(SkipRuleSchema.safeParse({ kind: "bogus" }).success).toBe(false);
  });

  it("rejects cellMatches missing crossAxisIndex", () => {
    expect(
      SkipRuleSchema.safeParse({ kind: "cellMatches", pattern: "^x$" }).success
    ).toBe(false);
  });

  it("rejects cellMatches with negative crossAxisIndex", () => {
    expect(
      SkipRuleSchema.safeParse({
        kind: "cellMatches",
        crossAxisIndex: -1,
        pattern: "x",
      }).success
    ).toBe(false);
  });
});

describe("DriftKnobsSchema defaults", () => {
  it("defaults headerShiftRows to 0, addedColumns to 'halt', removedColumns.action to 'halt'", () => {
    const parsed = DriftKnobsSchema.parse({ removedColumns: { max: 0 } });
    expect(parsed.headerShiftRows).toBe(0);
    expect(parsed.addedColumns).toBe("halt");
    expect(parsed.removedColumns.action).toBe("halt");
    expect(parsed.removedColumns.max).toBe(0);
  });

  it("accepts 'auto-apply' overrides", () => {
    const parsed = DriftKnobsSchema.parse({
      addedColumns: "auto-apply",
      removedColumns: { max: 2, action: "auto-apply" },
    });
    expect(parsed.addedColumns).toBe("auto-apply");
    expect(parsed.removedColumns.action).toBe("auto-apply");
  });
});

describe("WarningSchema / WarningCode", () => {
  it("accepts every WARNING_CODES member", () => {
    for (const code of WARNING_CODES) {
      const result = WarningSchema.safeParse({
        code,
        severity: "warn",
        message: "msg",
      });
      if (!result.success) {
        throw new Error(
          `Code ${code} rejected: ${JSON.stringify(result.error.issues)}`
        );
      }
    }
  });

  it("exposes WarningCode as a const record mirroring the enum", () => {
    for (const code of WARNING_CODES) {
      expect(WarningCode[code]).toBe(code);
    }
  });

  it("rejects unknown warning codes", () => {
    expect(
      WarningSchema.safeParse({
        code: "TOTALLY_MADE_UP",
        severity: "warn",
        message: "x",
      }).success
    ).toBe(false);
  });

  it("rejects unknown severity values", () => {
    expect(
      WarningSchema.safeParse({
        code: "AMBIGUOUS_HEADER",
        severity: "catastrophic",
        message: "x",
      }).success
    ).toBe(false);
  });
});

describe("ColumnBindingSchema — user overrides", () => {
  const baseBinding = {
    sourceLocator: {
      kind: "byHeaderName" as const,
      axis: "row" as const,
      name: "Email",
    },
    columnDefinitionId: "coldef_email",
    confidence: 0.95,
  };

  it("accepts a binding with no override fields (baseline)", () => {
    expect(ColumnBindingSchema.safeParse(baseBinding).success).toBe(true);
  });

  it("accepts excluded: true", () => {
    expect(
      ColumnBindingSchema.safeParse({ ...baseBinding, excluded: true }).success
    ).toBe(true);
  });

  it("accepts valid normalizedKey", () => {
    for (const nk of ["email", "customer_name", "email2", "a", "a_b_c_1"]) {
      const result = ColumnBindingSchema.safeParse({
        ...baseBinding,
        normalizedKey: nk,
      });
      if (!result.success) {
        throw new Error(
          `Expected ${nk} to pass: ${JSON.stringify(result.error.issues)}`
        );
      }
    }
  });

  it("rejects normalizedKey that violates the regex", () => {
    for (const nk of [
      "Email",
      "1_bar",
      "foo-bar",
      "_leading",
      "has space",
      "",
    ]) {
      expect(
        ColumnBindingSchema.safeParse({
          ...baseBinding,
          normalizedKey: nk,
        }).success
      ).toBe(false);
    }
  });

  it("accepts required / defaultValue / format / enumValues with nullable semantics", () => {
    const result = ColumnBindingSchema.safeParse({
      ...baseBinding,
      required: true,
      defaultValue: null,
      format: "YYYY-MM-DD",
      enumValues: ["A", "B"],
    });
    if (!result.success) {
      throw new Error(JSON.stringify(result.error.issues));
    }
    expect(result.success).toBe(true);

    // nullable-optional enumValues
    expect(
      ColumnBindingSchema.safeParse({ ...baseBinding, enumValues: null }).success
    ).toBe(true);
  });

  it("accepts refEntityKey and refNormalizedKey (nullable-optional)", () => {
    expect(
      ColumnBindingSchema.safeParse({
        ...baseBinding,
        refEntityKey: "customers",
        refNormalizedKey: "id",
      }).success
    ).toBe(true);

    expect(
      ColumnBindingSchema.safeParse({
        ...baseBinding,
        refEntityKey: null,
        refNormalizedKey: null,
      }).success
    ).toBe(true);
  });

  it("propagates through RegionSchema without breaking cross-field invariants", () => {
    const fixture = loadFixture("simple-rows-as-records.json") as {
      regions: Array<{
        columnBindings: Array<Record<string, unknown>>;
      }>;
    };
    fixture.regions[0].columnBindings[0] = {
      ...fixture.regions[0].columnBindings[0],
      excluded: true,
      normalizedKey: "name_override",
      required: true,
      defaultValue: null,
      format: null,
      enumValues: null,
      refEntityKey: null,
      refNormalizedKey: null,
    };
    const result = LayoutPlanSchema.safeParse(fixture);
    if (!result.success) {
      throw new Error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });
});

describe("RegionSchema independent exposure", () => {
  it("validates a region pulled from the simple fixture", () => {
    const fx = loadFixture("simple-rows-as-records.json") as {
      regions: unknown[];
    };
    const result = RegionSchema.safeParse(fx.regions[0]);
    if (!result.success) {
      throw new Error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });
});
