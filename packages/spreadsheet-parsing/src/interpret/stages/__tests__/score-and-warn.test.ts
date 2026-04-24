import { describe, it, expect } from "@jest/globals";

import type { InterpretInput, Region, Segment } from "../../../plan/index.js";
import { makeWorkbook } from "../../../workbook/helpers.js";
import { createInitialState } from "../../state.js";
import type { InterpretState } from "../../types.js";
import { detectRegions } from "../detect-regions.js";
import { detectHeaders } from "../detect-headers.js";
import { detectIdentity } from "../detect-identity.js";
import { detectSegments } from "../detect-segments.js";
import { classifyFieldSegments } from "../classify-field-segments.js";
import { recommendSegmentAxisNames } from "../recommend-segment-axis-names.js";
import { proposeBindings } from "../propose-bindings.js";
import { scoreAndWarn } from "../score-and-warn.js";

async function run(input: InterpretInput) {
  let state = detectRegions(createInitialState(input));
  state = detectHeaders(state);
  state = detectIdentity(state);
  state = detectSegments(state);
  state = await classifyFieldSegments(state, {});
  state = await recommendSegmentAxisNames(state, {});
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
        headerAxes: ["row"],
      },
    ],
  };
}

describe("scoreAndWarn", () => {
  it("emits ROW_POSITION_IDENTITY at 'warn' when the region's identity falls back to rowPosition", async () => {
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
          headerAxes: ["row"],
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

  it("emits SEGMENT_MISSING_AXIS_NAME as a blocker per pivot segment with an empty axisName", async () => {
    // Hint pins a user-sourced pivot (so proposeBindings preserves it) with
    // an empty axisName. score-and-warn should fire the new segment-level
    // blocker.
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 2, cols: 3 },
            cells: [
              { row: 1, col: 2, value: "Jan" },
              { row: 1, col: 3, value: "Feb" },
              { row: 2, col: 1, value: "Revenue" },
              { row: 2, col: 2, value: 100 },
              { row: 2, col: 3, value: 200 },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 3 },
          targetEntityDefinitionId: "monthly",
          headerAxes: ["row"],
          segmentsByAxis: {
            row: [
              { kind: "skip", positionCount: 1 },
              {
                kind: "pivot",
                id: "month-seg",
                axisName: "unnamed",
                axisNameSource: "user",
                positionCount: 2,
              },
            ],
          },
          cellValueField: { name: "revenue", nameSource: "user" },
        },
      ],
    };
    // Overwrite the user hint's axisName post-schema to simulate "empty"
    // (schema min(1) forbids it at construction time; scoring guards
    // against stale data regardless).
    const state = await run(input);
    const region = state.detectedRegions[0];
    // Simulate the post-user edit that clears axisName — the emission path
    // must treat an empty string as unresolved regardless of how it got
    // there, so we assert via a direct call to scoreAndWarn on a mutated
    // region.
    const badRegion: Region = {
      ...region,
      segmentsByAxis: {
        row: region.segmentsByAxis?.row?.map((s) =>
          s.kind === "pivot" ? { ...s, axisName: "unnamed" } : s
        ),
      },
    };
    // Sanity: user-pinned pivot landed on the region with its ID preserved.
    expect(
      badRegion.segmentsByAxis?.row?.some(
        (s) => s.kind === "pivot" && s.id === "month-seg"
      )
    ).toBe(true);
    // Now flip axisName to "" via the ignored type narrowing (score-and-warn
    // treats empty as missing).
    const segs = badRegion.segmentsByAxis!.row!;
    segs[1] = { ...(segs[1] as Extract<Segment, { kind: "pivot" }>), axisName: "" } as Segment;
    // Drive scoreAndWarn directly with the mutated region.
    const mutated: InterpretState = {
      ...state,
      detectedRegions: [badRegion],
    };
    const after = scoreAndWarn(mutated);
    const warn = after.detectedRegions[0].warnings.find(
      (w) => w.code === "SEGMENT_MISSING_AXIS_NAME"
    );
    expect(warn).toBeDefined();
    expect(warn?.severity).toBe("blocker");
  });

  it("emits CELL_VALUE_FIELD_NOT_BOUND as a warn when a pivoted region's cellValueField has no columnDefinitionId", async () => {
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 2, cols: 4 },
            cells: [
              { row: 1, col: 1, value: "name" },
              { row: 1, col: 2, value: "Jan" },
              { row: 1, col: 3, value: "Feb" },
              { row: 1, col: 4, value: "Mar" },
              { row: 2, col: 1, value: "Apple" },
              { row: 2, col: 2, value: 100 },
              { row: 2, col: 3, value: 200 },
              { row: 2, col: 4, value: 300 },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 4 },
          targetEntityDefinitionId: "monthly",
          headerAxes: ["row"],
          // No cellValueField on hint → heuristic seeds `{ name: "value",
          // nameSource: "ai" }` without a columnDefinitionId → warn fires.
        },
      ],
    };
    const state = await run(input);
    const region = state.detectedRegions[0];
    const warn = region.warnings.find(
      (w) => w.code === "CELL_VALUE_FIELD_NOT_BOUND"
    );
    expect(warn).toBeDefined();
    expect(warn?.severity).toBe("warn");
  });

  it("emits UNRECOGNIZED_COLUMN for each unmatched classification", async () => {
    const input = wellFormed();
    const state = await run(input);
    const region = state.detectedRegions[0];
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

describe("scoreAndWarn — DUPLICATE_ENTITY_TARGET", () => {
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
          headerAxes: ["row"],
        },
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 3, endRow: 3, endCol: 4 },
          targetEntityDefinitionId: "contacts",
          headerAxes: ["row"],
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

  it("does not emit the blocker for regions with targetEntityDefinitionId === null", () => {
    const baseRegion: Region = {
      id: "r1",
      sheet: "Sheet1",
      bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
      targetEntityDefinitionId: null as unknown as string,
      headerAxes: ["row"],
      segmentsByAxis: { row: [{ kind: "field", positionCount: 2 }] },
      headerStrategyByAxis: {
        row: {
          kind: "row",
          locator: { kind: "row", sheet: "Sheet1", row: 1 },
          confidence: 0.5,
        },
      },
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
      input: {
        regionHints: undefined,
        priorPlan: undefined,
        userHints: undefined,
      },
      workbook: makeWorkbook({
        sheets: [
          { name: "Sheet1", dimensions: { rows: 2, cols: 2 }, cells: [] },
        ],
      }),
      detectedRegions: [
        { ...baseRegion, id: "r1" },
        { ...baseRegion, id: "r2" },
      ],
      headerCandidates: new Map(),
      identityCandidates: new Map(),
      columnClassifications: new Map(),
      segmentAxisNameSuggestions: new Map(),
      segmentsByRegion: new Map(),
      cellValueFieldByRegion: new Map(),
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
