import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "@jest/globals";

import {
  LayoutPlanSchema,
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
