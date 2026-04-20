import { describe, it, expect } from "@jest/globals";

import type { IdentityStrategy } from "../../plan/index.js";
import { makeSheetAccessor } from "../../workbook/helpers.js";
import type { SheetData } from "../../workbook/types.js";
import { deriveSourceId } from "../identity.js";

function simpleSheet(): SheetData {
  return {
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
  };
}

describe("deriveSourceId", () => {
  const sheet = makeSheetAccessor(simpleSheet());

  it("column strategy returns the cell value at (row, identity-column)", () => {
    const strategy: IdentityStrategy = {
      kind: "column",
      sourceLocator: { kind: "column", sheet: "Sheet1", col: 1 },
      confidence: 0.9,
    };
    const id = deriveSourceId(strategy, {
      sheet,
      orientation: "rows-as-records",
      row: 2,
      col: 0,
    });
    expect(id).toBe("a-1");
  });

  it("composite strategy joins values at multiple columns with the configured joiner", () => {
    const strategy: IdentityStrategy = {
      kind: "composite",
      sourceLocators: [
        { kind: "column", sheet: "Sheet1", col: 1 },
        { kind: "column", sheet: "Sheet1", col: 2 },
      ],
      joiner: "|",
      confidence: 0.7,
    };
    const id = deriveSourceId(strategy, {
      sheet,
      orientation: "rows-as-records",
      row: 3,
      col: 0,
    });
    expect(id).toBe("a-2|bob");
  });

  it("rowPosition strategy returns `row-{rowNumber}` for rows-as-records", () => {
    const strategy: IdentityStrategy = { kind: "rowPosition", confidence: 0.3 };
    const id = deriveSourceId(strategy, {
      sheet,
      orientation: "rows-as-records",
      row: 4,
      col: 0,
    });
    expect(id).toBe("row-4");
  });

  it("rowPosition strategy returns `col-{colNumber}` for columns-as-records", () => {
    const strategy: IdentityStrategy = { kind: "rowPosition", confidence: 0.3 };
    const id = deriveSourceId(strategy, {
      sheet,
      orientation: "columns-as-records",
      row: 0,
      col: 3,
    });
    expect(id).toBe("col-3");
  });

  it("rowPosition strategy returns `cell-{row}-{col}` for cells-as-records", () => {
    const strategy: IdentityStrategy = { kind: "rowPosition", confidence: 0.3 };
    const id = deriveSourceId(strategy, {
      sheet,
      orientation: "cells-as-records",
      row: 3,
      col: 2,
    });
    expect(id).toBe("cell-3-2");
  });

  it("coerces null identity-column values to empty string", () => {
    const sparseSheet = makeSheetAccessor({
      name: "Sheet1",
      dimensions: { rows: 2, cols: 2 },
      cells: [
        { row: 1, col: 1, value: "id" },
        { row: 2, col: 2, value: "alice" },
      ],
    });
    const strategy: IdentityStrategy = {
      kind: "column",
      sourceLocator: { kind: "column", sheet: "Sheet1", col: 1 },
      confidence: 0.9,
    };
    const id = deriveSourceId(strategy, {
      sheet: sparseSheet,
      orientation: "rows-as-records",
      row: 2,
      col: 0,
    });
    expect(id).toBe("");
  });

  it("coerces Date identity-column values to ISO 8601 strings", () => {
    const dateSheet = makeSheetAccessor({
      name: "Sheet1",
      dimensions: { rows: 2, cols: 1 },
      cells: [
        { row: 1, col: 1, value: "createdAt" },
        { row: 2, col: 1, value: new Date("2025-06-01T00:00:00Z") },
      ],
    });
    const strategy: IdentityStrategy = {
      kind: "column",
      sourceLocator: { kind: "column", sheet: "Sheet1", col: 1 },
      confidence: 0.9,
    };
    const id = deriveSourceId(strategy, {
      sheet: dateSheet,
      orientation: "rows-as-records",
      row: 2,
      col: 0,
    });
    expect(id).toBe("2025-06-01T00:00:00.000Z");
  });
});
