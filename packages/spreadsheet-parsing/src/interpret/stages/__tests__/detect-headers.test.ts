import { describe, it, expect } from "@jest/globals";

import type { InterpretInput } from "../../../plan/index.js";
import { createInitialState } from "../../state.js";
import { detectRegions } from "../detect-regions.js";
import { detectHeaders } from "../detect-headers.js";

function runWith(input: InterpretInput) {
  return detectHeaders(detectRegions(createInitialState(input)));
}

function simpleInput(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 3, cols: 3 },
          cells: [
            { row: 1, col: 1, value: "name" },
            { row: 1, col: 2, value: "age" },
            { row: 1, col: 3, value: "email" },
            { row: 2, col: 1, value: "alice" },
            { row: 2, col: 2, value: 30 },
            { row: 2, col: 3, value: "a@x.com" },
            { row: 3, col: 1, value: "bob" },
            { row: 3, col: 2, value: 25 },
            { row: 3, col: 3, value: "b@x.com" },
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Sheet1",
        bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
        targetEntityDefinitionId: "contacts",
        headerAxes: ["row"],
      },
    ],
  };
}

describe("detectHeaders", () => {
  it("picks the first row as the header candidate for a simple well-formed sheet", () => {
    const state = runWith(simpleInput());
    const regionId = state.detectedRegions[0].id;
    const candidates = state.headerCandidates.get(regionId);
    expect(candidates).toBeDefined();
    expect(candidates!.length).toBeGreaterThanOrEqual(1);
    const best = candidates![0];
    expect(best.axis).toBe("row");
    expect(best.index).toBe(1);
    expect(best.labels).toEqual(["name", "age", "email"]);
    expect(best.score).toBeGreaterThan(0);
  });

  it("skips leading title rows and picks the row with the highest header-ness score", () => {
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 4, cols: 3 },
            cells: [
              { row: 1, col: 1, value: "My Spreadsheet" },
              { row: 2, col: 1, value: "name" },
              { row: 2, col: 2, value: "age" },
              { row: 2, col: 3, value: "email" },
              { row: 3, col: 1, value: "alice" },
              { row: 3, col: 2, value: 30 },
              { row: 3, col: 3, value: "a@x.com" },
              { row: 4, col: 1, value: "bob" },
              { row: 4, col: 2, value: 25 },
              { row: 4, col: 3, value: "b@x.com" },
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
    const state = runWith(input);
    const regionId = state.detectedRegions[0].id;
    const best = state.headerCandidates.get(regionId)![0];
    expect(best.index).toBe(2);
    expect(best.labels).toEqual(["name", "age", "email"]);
  });

  it("produces a column-axis candidate when headerAxes = ['column']", () => {
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 3, cols: 3 },
            cells: [
              { row: 1, col: 1, value: "Name" },
              { row: 2, col: 1, value: "Age" },
              { row: 3, col: 1, value: "Email" },
              { row: 1, col: 2, value: "alice" },
              { row: 2, col: 2, value: 30 },
              { row: 3, col: 2, value: "a@x.com" },
              { row: 1, col: 3, value: "bob" },
              { row: 2, col: 3, value: 25 },
              { row: 3, col: 3, value: "b@x.com" },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
          targetEntityDefinitionId: "contacts",
          headerAxes: ["column"],
        },
      ],
    };
    const state = runWith(input);
    const regionId = state.detectedRegions[0].id;
    const best = state.headerCandidates.get(regionId)![0];
    expect(best.axis).toBe("column");
    expect(best.index).toBe(1);
    expect(best.labels).toEqual(["Name", "Age", "Email"]);
  });

  it("skips header detection for headerless regions", () => {
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
          recordsAxis: "row",
        },
      ],
    };
    const state = runWith(input);
    const regionId = state.detectedRegions[0].id;
    expect(state.headerCandidates.get(regionId)).toEqual([]);
  });

  it("returns both row-axis and column-axis candidates for a 2D crosstab hint", () => {
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 4, cols: 4 },
            cells: [
              { row: 1, col: 1, value: "Quarter" },
              { row: 1, col: 2, value: "North" },
              { row: 1, col: 3, value: "South" },
              { row: 1, col: 4, value: "East" },
              { row: 2, col: 1, value: "Q1" },
              { row: 2, col: 2, value: 100 },
              { row: 2, col: 3, value: 110 },
              { row: 2, col: 4, value: 120 },
              { row: 3, col: 1, value: "Q2" },
              { row: 3, col: 2, value: 200 },
              { row: 3, col: 3, value: 210 },
              { row: 3, col: 4, value: 220 },
              { row: 4, col: 1, value: "Q3" },
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
          targetEntityDefinitionId: "crosstab",
          headerAxes: ["row", "column"],
          axisAnchorCell: { row: 1, col: 1 },
        },
      ],
    };
    const state = runWith(input);
    const regionId = state.detectedRegions[0].id;
    const candidates = state.headerCandidates.get(regionId);
    expect(candidates).toBeDefined();
    const axes = new Set(candidates!.map((c) => c.axis));
    expect(axes.has("row")).toBe(true);
    expect(axes.has("column")).toBe(true);
  });

  it("is deterministic across repeated runs", () => {
    const first = runWith(simpleInput());
    const second = runWith(simpleInput());
    const id = first.detectedRegions[0].id;
    expect(first.headerCandidates.get(id)).toEqual(
      second.headerCandidates.get(id)
    );
  });
});
