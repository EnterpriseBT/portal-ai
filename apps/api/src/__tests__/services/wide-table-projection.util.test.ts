/**
 * Unit tests for `projectToWideRow` and `buildMappingsForProjection`.
 * Pure helpers — no DB.
 */

import { describe, it, expect } from "@jest/globals";

import {
  projectToWideRow,
  buildMappingsForProjection,
  type WideRowSource,
} from "../../services/wide-table-projection.util.js";

describe("projectToWideRow", () => {
  const baseRecord: WideRowSource = {
    id: "rec-1",
    organizationId: "org-1",
    sourceId: "src-A",
    syncedAt: 1_700_000_000_000,
    isValid: true,
    normalizedData: {
      amount: 100,
      stage: "open",
      close_date: "2026-01-01",
    },
  };

  const mappings = new Map<string, string>([
    ["amount", "c_amount"],
    ["stage", "c_stage"],
    ["close_date", "c_close_date"],
  ]);

  it("emits every metadata column from the record", () => {
    const row = projectToWideRow(baseRecord, mappings);
    expect(row.entity_record_id).toBe("rec-1");
    expect(row.organization_id).toBe("org-1");
    expect(row.synced_at).toBe(1_700_000_000_000);
    expect(row.is_valid).toBe(true);
    expect(row.source_id).toBe("src-A");
  });

  it("maps each normalized_key entry to its c_* column", () => {
    const row = projectToWideRow(baseRecord, mappings);
    expect(row.c_amount).toBe(100);
    expect(row.c_stage).toBe("open");
    expect(row.c_close_date).toBe("2026-01-01");
  });

  it("silently skips normalized keys not in the mapping", () => {
    const row = projectToWideRow(
      {
        ...baseRecord,
        normalizedData: { amount: 100, mystery: "x" },
      },
      mappings
    );
    expect(row.c_amount).toBe(100);
    expect("mystery" in row).toBe(false);
    expect("c_mystery" in row).toBe(false);
  });

  it("handles null / undefined normalizedData by omitting all data columns", () => {
    const rowNull = projectToWideRow(
      { ...baseRecord, normalizedData: null },
      mappings
    );
    expect("c_amount" in rowNull).toBe(false);
    expect(rowNull.entity_record_id).toBe("rec-1");

    const rowUndef = projectToWideRow(
      { ...baseRecord, normalizedData: undefined },
      mappings
    );
    expect("c_amount" in rowUndef).toBe(false);
  });

  it("does not emit data columns when the mapping is empty", () => {
    const row = projectToWideRow(baseRecord, new Map());
    expect(Object.keys(row)).toEqual([
      "entity_record_id",
      "organization_id",
      "synced_at",
      "is_valid",
      "source_id",
    ]);
  });
});

describe("buildMappingsForProjection", () => {
  it("turns the cache's column tuples into a normalizedKey → columnName map", () => {
    const map = buildMappingsForProjection([
      { normalizedKey: "amount", columnName: "c_amount" },
      { normalizedKey: "stage", columnName: "c_stage" },
    ]);
    expect(map.get("amount")).toBe("c_amount");
    expect(map.get("stage")).toBe("c_stage");
    expect(map.get("missing")).toBeUndefined();
  });

  it("returns an empty map for an empty input", () => {
    const map = buildMappingsForProjection([]);
    expect(map.size).toBe(0);
  });
});
