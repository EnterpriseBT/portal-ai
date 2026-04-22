import { describe, it, expect } from "@jest/globals";

import type { InterpretInput, Region } from "../../../plan/index.js";
import { makeWorkbook } from "../../../workbook/helpers.js";
import { createInitialState } from "../../state.js";
import type { InterpretState } from "../../types.js";
import { detectRegions } from "../detect-regions.js";
import { detectHeaders } from "../detect-headers.js";
import { detectIdentity } from "../detect-identity.js";
import { classifyColumns } from "../classify-columns.js";
import { recommendRecordsAxisName } from "../recommend-records-axis-name.js";
import { proposeBindings } from "../propose-bindings.js";
import { scoreAndWarn } from "../score-and-warn.js";

async function run(input: InterpretInput) {
  let state = detectRegions(createInitialState(input));
  state = detectHeaders(state);
  state = detectIdentity(state);
  state = await classifyColumns(state, {});
  state = await recommendRecordsAxisName(state, {});
  state = proposeBindings(state);
  return scoreAndWarn(state);
}

function wellFormed(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 3, cols: 2 },
          cells: [
            { row: 1, col: 1, value: "id" },
            { row: 1, col: 2, value: "name" },
            { row: 2, col: 1, value: "a-1" },
            { row: 2, col: 2, value: "alice" },
            { row: 3, col: 1, value: "a-2" },
            { row: 3, col: 2, value: "bob" },
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Sheet1",
        bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 2 },
        targetEntityDefinitionId: "contacts",
        orientation: "rows-as-records",
        headerAxis: "row",
      },
    ],
  };
}

describe("scoreAndWarn", () => {
  it("emits ROW_POSITION_IDENTITY at 'warn' when the region's identity falls back to rowPosition", async () => {
    // A sheet where no column is unique and no composite is unique either.
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 4, cols: 2 },
            cells: [
              { row: 1, col: 1, value: "team" },
              { row: 1, col: 2, value: "member" },
              { row: 2, col: 1, value: "a" },
              { row: 2, col: 2, value: "alice" },
              { row: 3, col: 1, value: "a" },
              { row: 3, col: 2, value: "alice" },
              { row: 4, col: 1, value: "b" },
              { row: 4, col: 2, value: "bob" },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 2 },
          targetEntityDefinitionId: "team-members",
          orientation: "rows-as-records",
          headerAxis: "row",
        },
      ],
    };
    const state = await run(input);
    const region = state.detectedRegions[0];
    const warn = region.warnings.find(
      (w) => w.code === "ROW_POSITION_IDENTITY"
    );
    expect(warn).toBeDefined();
    expect(warn?.severity).toBe("warn");
  });

  it("emits PIVOTED_REGION_MISSING_AXIS_NAME as a blocker when a pivoted region has no axis name", async () => {
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 3, cols: 3 },
            cells: [
              { row: 1, col: 1, value: "" },
              { row: 1, col: 2, value: "Jan" },
              { row: 1, col: 3, value: "Feb" },
              { row: 2, col: 1, value: "Revenue" },
              { row: 3, col: 1, value: "Cost" },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
          targetEntityDefinitionId: "monthly",
          orientation: "columns-as-records",
          headerAxis: "row",
        },
      ],
    };
    const state = await run(input);
    const region = state.detectedRegions[0];
    const warn = region.warnings.find(
      (w) => w.code === "PIVOTED_REGION_MISSING_AXIS_NAME"
    );
    expect(warn).toBeDefined();
    expect(warn?.severity).toBe("blocker");
  });

  it("emits UNRECOGNIZED_COLUMN for each unmatched classification", async () => {
    const input = wellFormed();
    const state = await run(input);
    const region = state.detectedRegions[0];
    // "id" and "name" are classified with null columnDefinitionId because no catalog was supplied.
    const unrecognized = region.warnings.filter(
      (w) => w.code === "UNRECOGNIZED_COLUMN"
    );
    expect(unrecognized.length).toBeGreaterThanOrEqual(1);
  });

  it("populates region.confidence with aggregate ≤ 1 and region ≤ 1", async () => {
    const state = await run(wellFormed());
    const region = state.detectedRegions[0];
    expect(region.confidence.region).toBeGreaterThanOrEqual(0);
    expect(region.confidence.region).toBeLessThanOrEqual(1);
    expect(region.confidence.aggregate).toBeGreaterThanOrEqual(0);
    expect(region.confidence.aggregate).toBeLessThanOrEqual(1);
  });

  it("does not emit ROW_POSITION_IDENTITY for regions with a column identity", async () => {
    const state = await run(wellFormed());
    const region = state.detectedRegions[0];
    const warn = region.warnings.find(
      (w) => w.code === "ROW_POSITION_IDENTITY"
    );
    expect(warn).toBeUndefined();
  });
});

describe("scoreAndWarn — DUPLICATE_ENTITY_TARGET (C1)", () => {
  it("emits a blocker on the second region when two hints share a target", async () => {
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 3, cols: 4 },
            cells: [
              { row: 1, col: 1, value: "id" },
              { row: 1, col: 2, value: "name" },
              { row: 1, col: 3, value: "id" },
              { row: 1, col: 4, value: "name" },
              { row: 2, col: 1, value: "a-1" },
              { row: 2, col: 2, value: "alice" },
              { row: 2, col: 3, value: "b-1" },
              { row: 2, col: 4, value: "bob" },
              { row: 3, col: 1, value: "a-2" },
              { row: 3, col: 2, value: "amy" },
              { row: 3, col: 3, value: "b-2" },
              { row: 3, col: 4, value: "bill" },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 2 },
          targetEntityDefinitionId: "contacts",
          orientation: "rows-as-records",
          headerAxis: "row",
        },
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 3, endRow: 3, endCol: 4 },
          targetEntityDefinitionId: "contacts",
          orientation: "rows-as-records",
          headerAxis: "row",
        },
      ],
    };
    const state = await run(input);
    const first = state.detectedRegions[0];
    const second = state.detectedRegions[1];
    const firstDupe = first.warnings.find(
      (w) => w.code === "DUPLICATE_ENTITY_TARGET"
    );
    const secondDupe = second.warnings.find(
      (w) => w.code === "DUPLICATE_ENTITY_TARGET"
    );
    expect(firstDupe).toBeUndefined();
    expect(secondDupe).toBeDefined();
    expect(secondDupe?.severity).toBe("blocker");
  });

  it("emits the blocker when two same-target regions sit on different sheets", async () => {
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 2, cols: 2 },
            cells: [
              { row: 1, col: 1, value: "id" },
              { row: 1, col: 2, value: "name" },
              { row: 2, col: 1, value: "a-1" },
              { row: 2, col: 2, value: "alice" },
            ],
          },
          {
            name: "Sheet2",
            dimensions: { rows: 2, cols: 2 },
            cells: [
              { row: 1, col: 1, value: "id" },
              { row: 1, col: 2, value: "name" },
              { row: 2, col: 1, value: "b-1" },
              { row: 2, col: 2, value: "bob" },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
          targetEntityDefinitionId: "contacts",
          orientation: "rows-as-records",
          headerAxis: "row",
        },
        {
          sheet: "Sheet2",
          bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
          targetEntityDefinitionId: "contacts",
          orientation: "rows-as-records",
          headerAxis: "row",
        },
      ],
    };
    const state = await run(input);
    const second = state.detectedRegions[1];
    const dupe = second.warnings.find(
      (w) => w.code === "DUPLICATE_ENTITY_TARGET"
    );
    expect(dupe).toBeDefined();
    expect(dupe?.severity).toBe("blocker");
  });

  it("does not emit the blocker for regions with targetEntityDefinitionId === null", () => {
    // RegionHintSchema requires a non-null target, so construct state directly
    // to exercise the defensive null guard in the duplicate-target pass.
    const baseRegion: Region = {
      id: "r1",
      sheet: "Sheet1",
      bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
      boundsMode: "absolute",
      targetEntityDefinitionId: null as unknown as string,
      orientation: "rows-as-records",
      headerAxis: "row",
      identityStrategy: { kind: "rowPosition", confidence: 0 },
      columnBindings: [],
      skipRules: [],
      drift: {
        headerShiftRows: 0,
        addedColumns: "halt",
        removedColumns: { max: 0, action: "halt" },
      },
      confidence: { region: 0, aggregate: 0 },
      warnings: [],
    };
    const state: InterpretState = {
      input: { regionHints: undefined, priorPlan: undefined, userHints: undefined },
      workbook: makeWorkbook({
        sheets: [{ name: "Sheet1", dimensions: { rows: 2, cols: 2 }, cells: [] }],
      }),
      detectedRegions: [
        { ...baseRegion, id: "r1" },
        { ...baseRegion, id: "r2" },
      ],
      headerCandidates: new Map(),
      identityCandidates: new Map(),
      columnClassifications: new Map(),
      recordsAxisNameSuggestions: new Map(),
      confidence: new Map(),
      warnings: [],
    };
    const out = scoreAndWarn(state);
    for (const region of out.detectedRegions) {
      const dupe = region.warnings.find(
        (w) => w.code === "DUPLICATE_ENTITY_TARGET"
      );
      expect(dupe).toBeUndefined();
    }
  });
});
