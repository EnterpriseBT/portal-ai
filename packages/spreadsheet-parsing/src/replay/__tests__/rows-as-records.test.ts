import { describe, it, expect } from "@jest/globals";

import type { Region } from "../../plan/index.js";
import { makeWorkbook } from "../../workbook/helpers.js";
import { extractRecords } from "../extract-records.js";

function contactsRegion(): Region {
  return {
    id: "r1",
    sheet: "Contacts",
    bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 3 },
    targetEntityDefinitionId: "contacts",
    headerAxes: ["row"],
    segmentsByAxis: {
      row: [{ kind: "field", positionCount: 3 }],
    },
    headerStrategyByAxis: {
      row: {
        kind: "row",
        locator: { kind: "row", sheet: "Contacts", row: 1 },
        confidence: 0.95,
      },
    },
    identityStrategy: {
      kind: "column",
      sourceLocator: { kind: "column", sheet: "Contacts", col: 1 },
      confidence: 0.9,
    },
    columnBindings: [
      {
        sourceLocator: { kind: "byHeaderName", axis: "row", name: "email" },
        columnDefinitionId: "col-email",
        confidence: 0.9,
      },
      {
        sourceLocator: { kind: "byHeaderName", axis: "row", name: "name" },
        columnDefinitionId: "col-name",
        confidence: 0.9,
      },
      {
        sourceLocator: { kind: "byPositionIndex", axis: "row", index: 3 },
        columnDefinitionId: "col-age",
        confidence: 0.8,
      },
    ],
    skipRules: [],
    drift: {
      headerShiftRows: 0,
      addedColumns: "halt",
      removedColumns: { max: 0, action: "halt" },
    },
    confidence: { region: 0.9, aggregate: 0.87 },
    warnings: [],
  };
}

function contactsWorkbook() {
  return makeWorkbook({
    sheets: [
      {
        name: "Contacts",
        dimensions: { rows: 4, cols: 3 },
        cells: [
          { row: 1, col: 1, value: "email" },
          { row: 1, col: 2, value: "name" },
          { row: 1, col: 3, value: "age" },
          { row: 2, col: 1, value: "a@x.com" },
          { row: 2, col: 2, value: "alice" },
          { row: 2, col: 3, value: 30 },
          { row: 3, col: 1, value: "b@x.com" },
          { row: 3, col: 2, value: "bob" },
          { row: 3, col: 3, value: 25 },
          { row: 4, col: 1, value: "c@x.com" },
          { row: 4, col: 2, value: "carol" },
          { row: 4, col: 3, value: 40 },
        ],
      },
    ],
  });
}

describe("extractRecords — 1D headerAxes:['row'] (records-are-rows)", () => {
  it("emits one record per data row with fields keyed by ColumnDefinition id", () => {
    const records = extractRecords(
      contactsRegion(),
      contactsWorkbook().sheets[0]
    );
    expect(records).toHaveLength(3);
    expect(records[0].fields).toEqual({
      "col-email": "a@x.com",
      "col-name": "alice",
      "col-age": 30,
    });
  });

  it("assigns source_id from the identity column value", () => {
    const records = extractRecords(
      contactsRegion(),
      contactsWorkbook().sheets[0]
    );
    expect(records[0].sourceId).toBe("a@x.com");
    expect(records[1].sourceId).toBe("b@x.com");
    expect(records[2].sourceId).toBe("c@x.com");
  });

  it("attaches the region id and targetEntityDefinitionId to every record", () => {
    const records = extractRecords(
      contactsRegion(),
      contactsWorkbook().sheets[0]
    );
    for (const r of records) {
      expect(r.regionId).toBe("r1");
      expect(r.targetEntityDefinitionId).toBe("contacts");
    }
  });

  it("produces a stable checksum that is independent of binding declaration order", () => {
    const baseline = extractRecords(
      contactsRegion(),
      contactsWorkbook().sheets[0]
    );
    const reordered = { ...contactsRegion() };
    reordered.columnBindings = [...reordered.columnBindings].reverse();
    const swapped = extractRecords(reordered, contactsWorkbook().sheets[0]);
    expect(swapped[0].checksum).toBe(baseline[0].checksum);
  });

  it("resolves byPositionIndex bindings for a headerless region", () => {
    const headerless: Region = {
      ...contactsRegion(),
      headerAxes: [],
      recordsAxis: "row",
      segmentsByAxis: undefined,
      headerStrategyByAxis: undefined,
      bounds: { startRow: 2, startCol: 1, endRow: 4, endCol: 3 },
      columnBindings: [
        {
          sourceLocator: { kind: "byPositionIndex", axis: "row", index: 1 },
          columnDefinitionId: "col-email",
          confidence: 0.7,
        },
        {
          sourceLocator: { kind: "byPositionIndex", axis: "row", index: 2 },
          columnDefinitionId: "col-name",
          confidence: 0.7,
        },
      ],
    };
    const records = extractRecords(headerless, contactsWorkbook().sheets[0]);
    expect(records).toHaveLength(3);
    expect(records[0].fields).toEqual({
      "col-email": "a@x.com",
      "col-name": "alice",
    });
  });

  it("skips the header row even when iterating the full region bounds", () => {
    const records = extractRecords(
      contactsRegion(),
      contactsWorkbook().sheets[0]
    );
    for (const r of records) {
      expect(r.fields["col-email"]).not.toBe("email");
    }
  });
});
