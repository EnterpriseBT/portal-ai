import { describe, it, expect } from "@jest/globals";

import type { DriftReport, LayoutPlan, Region } from "../../plan/index.js";
import type { WorkbookData } from "../../workbook/index.js";
import { replay } from "../index.js";
import {
  REPLAY_WARNINGS_MAX,
  ReplayWarningSchema,
  summarizeReplayWarnings,
} from "../../warnings/replay-warnings.js";

// #1009: the typed summary of a replay's bounds-overflow / sheet-missing
// drift, which commit and sync carry to the job result.
function region(id: string, sheet: string, endRow: number): Region {
  return {
    id,
    sheet,
    bounds: { startRow: 1, startCol: 1, endRow, endCol: 2 },
    targetEntityDefinitionId: `entity-${id}`,
    headerAxes: ["row"],
    segmentsByAxis: { row: [{ kind: "field", positionCount: 2 }] },
    headerStrategyByAxis: {
      row: {
        kind: "row",
        locator: { kind: "row", sheet, row: 1 },
        confidence: 0.9,
      },
    },
    identityStrategy: { kind: "rowPosition", confidence: 0.5 },
    columnBindings: [],
    skipRules: [],
    drift: {
      headerShiftRows: 0,
      addedColumns: "auto-apply",
      removedColumns: { max: 0, action: "halt" },
    },
    confidence: { region: 0.9, aggregate: 0.9 },
    warnings: [],
  };
}

function plan(regions: Region[]): LayoutPlan {
  return {
    planVersion: "1.0.0",
    workbookFingerprint: {
      sheetNames: ["Data"],
      dimensions: { Data: { rows: 3, cols: 2 } },
      anchorCells: [],
    },
    regions,
    confidence: {
      overall: 0.9,
      perRegion: Object.fromEntries(regions.map((r) => [r.id, 0.9])),
    },
  };
}

const workbook: WorkbookData = {
  sheets: [
    {
      name: "Data",
      dimensions: { rows: 3, cols: 2 },
      cells: [
        { row: 1, col: 1, value: "a" },
        { row: 1, col: 2, value: "b" },
        { row: 2, col: 1, value: "1" },
        { row: 2, col: 2, value: "2" },
        { row: 3, col: 1, value: "3" },
        { row: 3, col: 2, value: "4" },
      ],
    },
  ],
};

describe("summarizeReplayWarnings (#1009)", () => {
  it("maps bounds-overflow and sheet-missing, in plan order, skipping clean regions", async () => {
    const p = plan([
      region("over", "Data", 10),
      region("fine", "Data", 3),
      region("gone", "Q3", 5),
    ]);
    const { drift } = await replay(p, workbook);
    const { warnings, omitted } = summarizeReplayWarnings(p, drift);
    expect(omitted).toBe(0);
    expect(warnings).toEqual([
      {
        kind: "bounds-overflow",
        regionId: "over",
        sheet: "Data",
        targetEntityDefinitionId: "entity-over",
        bounds: { startRow: 1, startCol: 1, endRow: 10, endCol: 2 },
        sheetLastRow: 3,
        sheetLastCol: 2,
      },
      {
        kind: "sheet-missing",
        regionId: "gone",
        sheet: "Q3",
        targetEntityDefinitionId: "entity-gone",
        bounds: { startRow: 1, startCol: 1, endRow: 5, endCol: 2 },
      },
    ]);
  });

  it("is empty for a plan that fits its sheets", async () => {
    const p = plan([region("fine", "Data", 3)]);
    const { drift } = await replay(p, workbook);
    expect(summarizeReplayWarnings(p, drift)).toEqual({
      warnings: [],
      omitted: 0,
    });
  });

  it(`caps the list at ${REPLAY_WARNINGS_MAX} and counts the rest`, () => {
    const regions = Array.from({ length: 25 }, (_, i) =>
      region(`gone-${i}`, "Q3", 5)
    );
    const p = plan(regions);
    const drift: DriftReport = {
      regionDrifts: regions.map((r) => ({
        regionId: r.id,
        kinds: ["sheet-missing"],
        details: { sheetMissing: { sheet: r.sheet } },
        withinTolerance: true,
      })),
      severity: "info",
      identityChanging: false,
    };
    const { warnings, omitted } = summarizeReplayWarnings(p, drift);
    expect(warnings).toHaveLength(REPLAY_WARNINGS_MAX);
    expect(warnings[0].regionId).toBe("gone-0");
    expect(omitted).toBe(5);
  });

  it("validates each entry against ReplayWarningSchema", async () => {
    const p = plan([region("over", "Data", 10), region("gone", "Q3", 5)]);
    const { drift } = await replay(p, workbook);
    for (const w of summarizeReplayWarnings(p, drift).warnings) {
      expect(ReplayWarningSchema.parse(w)).toEqual(w);
    }
    expect(
      ReplayWarningSchema.safeParse({ kind: "bounds-overflow", regionId: "x" })
        .success
    ).toBe(false);
  });
});
