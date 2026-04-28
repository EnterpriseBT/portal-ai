import { describe, it, expect } from "@jest/globals";

import type { InterpretInput } from "../../../plan/index.js";
import { createInitialState } from "../../state.js";
import { detectRegions } from "../detect-regions.js";
import { detectHeaders } from "../detect-headers.js";
import { detectIdentity } from "../detect-identity.js";

function runPipeline(input: InterpretInput) {
  return detectIdentity(
    detectHeaders(detectRegions(createInitialState(input)))
  );
}

function uniqueColumnInput(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 4, cols: 3 },
          cells: [
            { row: 1, col: 1, value: "id" },
            { row: 1, col: 2, value: "name" },
            { row: 1, col: 3, value: "age" },
            { row: 2, col: 1, value: "a-1" },
            { row: 2, col: 2, value: "alice" },
            { row: 2, col: 3, value: 30 },
            { row: 3, col: 1, value: "a-2" },
            { row: 3, col: 2, value: "bob" },
            { row: 3, col: 3, value: 25 },
            { row: 4, col: 1, value: "a-3" },
            { row: 4, col: 2, value: "carol" },
            { row: 4, col: 3, value: 40 },
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Sheet1",
        bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 3 },
        targetEntityDefinitionId: "contacts",
        headerAxes: ["row"],
      },
    ],
  };
}

describe("detectIdentity", () => {
  it("prefers a single unique column when one exists (highest score wins)", () => {
    const state = runPipeline(uniqueColumnInput());
    const regionId = state.detectedRegions[0].id;
    const candidates = state.identityCandidates.get(regionId);
    expect(candidates).toBeDefined();
    expect(candidates!.length).toBeGreaterThanOrEqual(1);
    const best = candidates![0];
    expect(best.strategy.kind).toBe("column");
    expect(best.score).toBeGreaterThan(0.5);
    if (best.strategy.kind === "column") {
      expect(best.strategy.sourceLocator.kind).toBe("column");
    }
  });

  it("falls back to rowPosition when no single column AND no pair of columns produce unique keys", () => {
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 5, cols: 2 },
            cells: [
              { row: 1, col: 1, value: "team" },
              { row: 1, col: 2, value: "member" },
              { row: 2, col: 1, value: "alpha" },
              { row: 2, col: 2, value: "alice" },
              { row: 3, col: 1, value: "alpha" },
              { row: 3, col: 2, value: "alice" },
              { row: 4, col: 1, value: "beta" },
              { row: 4, col: 2, value: "bob" },
              { row: 5, col: 1, value: "beta" },
              { row: 5, col: 2, value: "bob" },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 5, endCol: 2 },
          targetEntityDefinitionId: "team-members",
          headerAxes: ["row"],
        },
      ],
    };
    const state = runPipeline(input);
    const regionId = state.detectedRegions[0].id;
    const candidates = state.identityCandidates.get(regionId)!;
    expect(candidates[0].strategy.kind).toBe("rowPosition");
  });

  it("proposes a composite strategy when two columns together are unique but neither is alone", () => {
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 4, cols: 3 },
            cells: [
              { row: 1, col: 1, value: "team" },
              { row: 1, col: 2, value: "member" },
              { row: 1, col: 3, value: "note" },
              { row: 2, col: 1, value: "alpha" },
              { row: 2, col: 2, value: "alice" },
              { row: 3, col: 1, value: "alpha" },
              { row: 3, col: 2, value: "bob" },
              { row: 4, col: 1, value: "beta" },
              { row: 4, col: 2, value: "alice" },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 3 },
          targetEntityDefinitionId: "team-members",
          headerAxes: ["row"],
        },
      ],
    };
    const state = runPipeline(input);
    const regionId = state.detectedRegions[0].id;
    const candidates = state.identityCandidates.get(regionId)!;
    const topKind = candidates[0].strategy.kind;
    expect(candidates.some((c) => c.strategy.kind === "composite")).toBe(true);
    expect(["composite", "rowPosition"]).toContain(topKind);
  });

  it("emits only rowPosition for a 2D crosstab — each body cell is a record, so a column-unique candidate would dedupe pivot×pivot records to K rows", () => {
    // Without this, detect-identity would propose `column at col 1`
    // (companies are unique per row), and at commit every (company,
    // quarter) record would share sourceId = company → upsert collapses
    // K × L records to K. rowPosition produces cell-coord sourceIds so
    // every body cell stays distinct.
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 4, cols: 4 },
            cells: [
              { row: 1, col: 1, value: "" },
              { row: 1, col: 2, value: "Q1" },
              { row: 1, col: 3, value: "Q2" },
              { row: 1, col: 4, value: "Q3" },
              { row: 2, col: 1, value: "Apple" },
              { row: 2, col: 2, value: 100 },
              { row: 2, col: 3, value: 110 },
              { row: 2, col: 4, value: 120 },
              { row: 3, col: 1, value: "Microsoft" },
              { row: 3, col: 2, value: 200 },
              { row: 3, col: 3, value: 210 },
              { row: 3, col: 4, value: 220 },
              { row: 4, col: 1, value: "Shell" },
              { row: 4, col: 2, value: 300 },
              { row: 4, col: 3, value: 310 },
              { row: 4, col: 4, value: 320 },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 4 },
          targetEntityDefinitionId: "metrics",
          headerAxes: ["row", "column"],
        },
      ],
    };
    const state = runPipeline(input);
    const regionId = state.detectedRegions[0].id;
    const candidates = state.identityCandidates.get(regionId)!;
    expect(candidates).toHaveLength(1);
    expect(candidates[0].strategy.kind).toBe("rowPosition");
  });

  it("emits only rowPosition for a headerless records-are-columns region", () => {
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 2, cols: 2 },
            cells: [
              { row: 1, col: 1, value: "a" },
              { row: 1, col: 2, value: "b" },
              { row: 2, col: 1, value: "c" },
              { row: 2, col: 2, value: "d" },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
          targetEntityDefinitionId: "headerless",
          headerAxes: [],
          recordsAxis: "column",
        },
      ],
    };
    const state = runPipeline(input);
    const regionId = state.detectedRegions[0].id;
    const candidates = state.identityCandidates.get(regionId)!;
    expect(candidates).toHaveLength(1);
    expect(candidates[0].strategy.kind).toBe("rowPosition");
  });
});
