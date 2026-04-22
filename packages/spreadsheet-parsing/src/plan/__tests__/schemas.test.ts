import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "@jest/globals";

import {
  AxisPositionRoleSchema,
  ColumnBindingSchema,
  LayoutPlanSchema,
  PivotSegmentSchema,
  RegionSchema,
  SkipRuleSchema,
  DriftKnobsSchema,
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
      // Print the Zod issues for debugging — helps when a fixture or schema drift.
      throw new Error(
        `Fixture ${filename} failed: ${JSON.stringify(result.error.issues, null, 2)}`
      );
    }
    expect(result.success).toBe(true);
  });
});

describe("Discriminated unions reject invalid `kind` values", () => {
  it("rejects headerStrategy.kind === 'bogus'", () => {
    const fixture = loadFixture("simple-rows-as-records.json") as {
      regions: { headerStrategy: { kind: string } }[];
    };
    fixture.regions[0].headerStrategy.kind = "bogus";
    expect(LayoutPlanSchema.safeParse(fixture).success).toBe(false);
  });

  it("rejects identityStrategy.kind === 'derived' (deferred in v1)", () => {
    const fixture = loadFixture("simple-rows-as-records.json") as {
      regions: { identityStrategy: { kind: string } }[];
    };
    fixture.regions[0].identityStrategy.kind = "derived";
    expect(LayoutPlanSchema.safeParse(fixture).success).toBe(false);
  });

  it("rejects columnBinding.sourceLocator.kind === 'byHeaderMatch' (deferred in v1)", () => {
    const fixture = loadFixture("simple-rows-as-records.json") as {
      regions: { columnBindings: { sourceLocator: { kind: string } }[] }[];
    };
    fixture.regions[0].columnBindings[0].sourceLocator.kind = "byHeaderMatch";
    expect(LayoutPlanSchema.safeParse(fixture).success).toBe(false);
  });
});

describe("RegionSchema cross-field invariants", () => {
  const baseCrosstab = () =>
    loadFixture("crosstab.json") as {
      regions: Array<Record<string, unknown>>;
    };

  // NOTE: pivoted / crosstab axis-name requirements are enforced as
  // `PIVOTED_REGION_MISSING_AXIS_NAME` blocker warnings (see `score-and-warn`
  // stage tests) rather than Zod errors — the schema must admit the plan so
  // interpret() can persist it for UI review.
  it("accepts (with warnings expected elsewhere) a crosstab region missing secondaryRecordsAxisName", () => {
    const fx = baseCrosstab();
    delete fx.regions[0].secondaryRecordsAxisName;
    const result = LayoutPlanSchema.safeParse(fx);
    expect(result.success).toBe(true);
  });

  it("accepts (with warnings expected elsewhere) a crosstab region missing cellValueName", () => {
    const fx = baseCrosstab();
    delete fx.regions[0].cellValueName;
    const result = LayoutPlanSchema.safeParse(fx);
    expect(result.success).toBe(true);
  });

  it("rejects boundsMode === 'matchesPattern' without boundsPattern", () => {
    const fx = loadFixture("simple-rows-as-records.json") as {
      regions: Array<Record<string, unknown>>;
    };
    fx.regions[0].boundsMode = "matchesPattern";
    // no boundsPattern set
    expect(LayoutPlanSchema.safeParse(fx).success).toBe(false);
  });

  it("rejects axisAnchorCell outside bounds", () => {
    const fx = loadFixture("crosstab.json") as {
      regions: Array<{
        bounds: {
          startRow: number;
          endRow: number;
          startCol: number;
          endCol: number;
        };
        axisAnchorCell?: { row: number; col: number };
      }>;
    };
    fx.regions[0].axisAnchorCell = {
      row: fx.regions[0].bounds.endRow + 1,
      col: fx.regions[0].bounds.startCol,
    };
    expect(LayoutPlanSchema.safeParse(fx).success).toBe(false);
  });

  it("rejects headerAxis 'none' with columnBindings referencing byHeaderName", () => {
    const fx = loadFixture("simple-rows-as-records.json") as {
      regions: Array<Record<string, unknown>>;
    };
    fx.regions[0].headerAxis = "none";
    // columnBindings in the fixture already use byHeaderName — must be rejected.
    expect(LayoutPlanSchema.safeParse(fx).success).toBe(false);
  });

  it("accepts headerAxis 'none' with columnBindings using byColumnIndex", () => {
    const fx = loadFixture("simple-rows-as-records.json") as {
      regions: Array<{
        headerAxis: string;
        headerStrategy?: unknown;
        columnBindings: Array<{
          sourceLocator: { kind: string; col?: number; name?: string };
        }>;
      }>;
    };
    fx.regions[0].headerAxis = "none";
    // When headerAxis is "none", headerStrategy does not apply.
    delete fx.regions[0].headerStrategy;
    fx.regions[0].columnBindings = fx.regions[0].columnBindings.map((b, i) => ({
      ...b,
      sourceLocator: { kind: "byColumnIndex", col: i + 1 },
    }));
    const result = LayoutPlanSchema.safeParse(fx);
    if (!result.success) {
      throw new Error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
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
    sourceLocator: { kind: "byHeaderName" as const, name: "Email" },
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
    for (const nk of ["Email", "1_bar", "foo-bar", "_leading", "has space", ""]) {
      expect(
        ColumnBindingSchema.safeParse({ ...baseBinding, normalizedKey: nk })
          .success
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
      normalizedKey: "email_override",
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

describe("AxisPositionRoleSchema", () => {
  it("parses the field / pivotLabel / skip variants", () => {
    expect(AxisPositionRoleSchema.safeParse({ kind: "field" }).success).toBe(true);
    expect(
      AxisPositionRoleSchema.safeParse({ kind: "pivotLabel", segmentId: "s1" })
        .success
    ).toBe(true);
    expect(AxisPositionRoleSchema.safeParse({ kind: "skip" }).success).toBe(true);
  });

  it("rejects pivotLabel without segmentId", () => {
    expect(
      AxisPositionRoleSchema.safeParse({ kind: "pivotLabel" }).success
    ).toBe(false);
  });

  it("rejects pivotLabel with empty segmentId", () => {
    expect(
      AxisPositionRoleSchema.safeParse({ kind: "pivotLabel", segmentId: "" })
        .success
    ).toBe(false);
  });

  it("rejects unknown kinds", () => {
    expect(
      AxisPositionRoleSchema.safeParse({ kind: "bogus" } as unknown).success
    ).toBe(false);
  });
});

describe("PivotSegmentSchema", () => {
  const baseSegment = {
    id: "s1",
    axisName: "quarter",
    axisNameSource: "user" as const,
    valueFieldName: "revenue",
    valueFieldNameSource: "user" as const,
  };

  it("accepts a minimal segment with required fields", () => {
    expect(PivotSegmentSchema.safeParse(baseSegment).success).toBe(true);
  });

  it("accepts the optional valueColumnDefinitionId", () => {
    expect(
      PivotSegmentSchema.safeParse({
        ...baseSegment,
        valueColumnDefinitionId: "coldef_revenue",
      }).success
    ).toBe(true);
  });

  it("accepts every declared *Source value", () => {
    for (const source of ["user", "ai", "anchor-cell"] as const) {
      expect(
        PivotSegmentSchema.safeParse({
          ...baseSegment,
          axisNameSource: source,
          valueFieldNameSource: source,
        }).success
      ).toBe(true);
    }
  });

  it("rejects empty id / axisName / valueFieldName", () => {
    expect(PivotSegmentSchema.safeParse({ ...baseSegment, id: "" }).success).toBe(
      false
    );
    expect(
      PivotSegmentSchema.safeParse({ ...baseSegment, axisName: "" }).success
    ).toBe(false);
    expect(
      PivotSegmentSchema.safeParse({ ...baseSegment, valueFieldName: "" }).success
    ).toBe(false);
  });

  it("rejects an unknown axisNameSource", () => {
    expect(
      PivotSegmentSchema.safeParse({
        ...baseSegment,
        axisNameSource: "bogus",
      } as unknown).success
    ).toBe(false);
  });
});

describe("RegionSchema — segmented crosstab refinement", () => {
  const baseCrosstab = () =>
    loadFixture("crosstab.json") as {
      regions: Array<Record<string, unknown>>;
    };

  it("rejects a cells-as-records region that carries positionRoles", () => {
    const fx = baseCrosstab();
    fx.regions[0].positionRoles = [{ kind: "field" }];
    const r = LayoutPlanSchema.safeParse(fx);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error)).toMatch(/SEGMENTED_CROSSTAB_NOT_SUPPORTED/);
  });

  it("rejects a cells-as-records region that carries pivotSegments", () => {
    const fx = baseCrosstab();
    fx.regions[0].pivotSegments = [
      {
        id: "s1",
        axisName: "quarter",
        axisNameSource: "user",
        valueFieldName: "revenue",
        valueFieldNameSource: "user",
      },
    ];
    const r = LayoutPlanSchema.safeParse(fx);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error)).toMatch(/SEGMENTED_CROSSTAB_NOT_SUPPORTED/);
  });

  it("still accepts a cells-as-records region without either field", () => {
    const fx = baseCrosstab();
    expect(LayoutPlanSchema.safeParse(fx).success).toBe(true);
  });
});

describe("RegionSchema — positionRoles length must match header-line length", () => {
  it("rejects when positionRoles length differs from header-row width", () => {
    const fx = loadFixture("simple-rows-as-records.json") as {
      regions: Array<Record<string, unknown> & {
        bounds: { startCol: number; endCol: number };
      }>;
    };
    const r = fx.regions[0];
    const width = r.bounds.endCol - r.bounds.startCol + 1;
    r.positionRoles = Array.from({ length: width - 1 }, () => ({
      kind: "field",
    }));
    const parsed = LayoutPlanSchema.safeParse(fx);
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error)).toMatch(/positionRoles/);
  });

  it("accepts when length matches header-row width", () => {
    const fx = loadFixture("simple-rows-as-records.json") as {
      regions: Array<Record<string, unknown> & {
        bounds: { startCol: number; endCol: number };
      }>;
    };
    const r = fx.regions[0];
    const width = r.bounds.endCol - r.bounds.startCol + 1;
    r.positionRoles = Array.from({ length: width }, () => ({ kind: "field" }));
    const parsed = LayoutPlanSchema.safeParse(fx);
    if (!parsed.success) {
      throw new Error(JSON.stringify(parsed.error.issues, null, 2));
    }
    expect(parsed.success).toBe(true);
  });

  it("uses row span when headerAxis === 'column'", () => {
    const headerColumnRegion = {
      id: "r1",
      sheet: "S",
      bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 3 },
      boundsMode: "absolute" as const,
      targetEntityDefinitionId: "e1",
      orientation: "rows-as-records" as const,
      headerAxis: "column" as const,
      headerStrategy: {
        kind: "column" as const,
        locator: { kind: "column" as const, sheet: "S", col: 1 },
        confidence: 1,
      },
      identityStrategy: { kind: "rowPosition" as const, confidence: 1 },
      columnBindings: [],
      skipRules: [],
      drift: {
        addedColumns: "halt" as const,
        removedColumns: { max: 0, action: "halt" as const },
      },
      confidence: { region: 1, aggregate: 1 },
      warnings: [],
      positionRoles: [] as Array<{ kind: "field" | "skip" | "pivotLabel"; segmentId?: string }>,
    };
    // headerAxis: "column" → length must match row span (endRow - startRow + 1 = 4).
    headerColumnRegion.positionRoles = Array.from({ length: 4 }, () => ({
      kind: "field",
    }));
    expect(RegionSchema.safeParse(headerColumnRegion).success).toBe(true);

    headerColumnRegion.positionRoles = Array.from({ length: 3 }, () => ({
      kind: "field",
    }));
    expect(RegionSchema.safeParse(headerColumnRegion).success).toBe(false);
  });
});

describe("RegionSchema — positionRoles / pivotSegments consistency", () => {
  const buildSegmentedRegion = () => {
    const fx = loadFixture("simple-rows-as-records.json") as {
      regions: Array<Record<string, unknown> & {
        bounds: { startCol: number; endCol: number };
      }>;
    };
    const r = fx.regions[0];
    const width = r.bounds.endCol - r.bounds.startCol + 1;
    // width-1 field positions + 1 pivotLabel referencing "s1"
    r.positionRoles = [
      ...Array.from({ length: width - 1 }, () => ({ kind: "field" })),
      { kind: "pivotLabel", segmentId: "s1" },
    ];
    r.pivotSegments = [
      {
        id: "s1",
        axisName: "quarter",
        axisNameSource: "user",
        valueFieldName: "revenue",
        valueFieldNameSource: "user",
      },
    ];
    return { fx, region: r };
  };

  it("accepts when every pivotLabel.segmentId maps to a segment and every segment is referenced", () => {
    const { fx } = buildSegmentedRegion();
    const parsed = LayoutPlanSchema.safeParse(fx);
    if (!parsed.success) {
      throw new Error(JSON.stringify(parsed.error.issues, null, 2));
    }
    expect(parsed.success).toBe(true);
  });

  it("rejects when a pivotLabel role references an unknown segmentId", () => {
    const { fx, region } = buildSegmentedRegion();
    const roles = region.positionRoles as Array<{ kind: string; segmentId?: string }>;
    roles[roles.length - 1] = { kind: "pivotLabel", segmentId: "ghost" };
    const parsed = LayoutPlanSchema.safeParse(fx);
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error)).toMatch(/ghost/);
  });

  it("rejects when pivotSegments contains a segment no position references", () => {
    const { fx, region } = buildSegmentedRegion();
    (region.pivotSegments as Array<Record<string, unknown>>).push({
      id: "orphan",
      axisName: "month",
      axisNameSource: "user",
      valueFieldName: "count",
      valueFieldNameSource: "user",
    });
    const parsed = LayoutPlanSchema.safeParse(fx);
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error)).toMatch(/orphan/);
  });
});

describe("RegionSchema — positionRoles + pivotSegments are optional passthrough", () => {
  it("accepts a region that declares neither field (existing behavior)", () => {
    const fx = loadFixture("simple-rows-as-records.json") as {
      regions: unknown[];
    };
    expect(RegionSchema.safeParse(fx.regions[0]).success).toBe(true);
  });

  it("passes the fields through when present and well-formed", () => {
    const fx = loadFixture("simple-rows-as-records.json") as {
      regions: Array<Record<string, unknown> & {
        bounds: { startCol: number; endCol: number };
      }>;
    };
    const r = fx.regions[0];
    const headerWidth = r.bounds.endCol - r.bounds.startCol + 1;
    r.positionRoles = Array.from({ length: headerWidth }, () => ({
      kind: "field",
    }));
    r.pivotSegments = [];
    const result = RegionSchema.safeParse(r);
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
