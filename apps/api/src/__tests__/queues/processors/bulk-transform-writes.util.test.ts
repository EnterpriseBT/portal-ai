import { describe, it, expect } from "@jest/globals";
import type { BulkTransformWrite } from "@portalai/core/models";

import {
  getByPath,
  shapeWritesForRecord,
} from "../../../queues/processors/bulk-transform-writes.util.js";

// ── getByPath (cases 1.1–1.5) ────────────────────────────────────────

describe("getByPath", () => {
  // 1.1
  it("returns the whole value when path is empty", () => {
    expect(getByPath({ a: 1 }, "")).toEqual({ a: 1 });
    expect(getByPath(42, "")).toBe(42);
    expect(getByPath(null, "")).toBeNull();
    expect(getByPath(undefined, "")).toBeUndefined();
  });

  // 1.2
  it("walks dot segments through nested objects", () => {
    const value = { a: { b: { c: 7 } } };
    expect(getByPath(value, "a")).toEqual({ b: { c: 7 } });
    expect(getByPath(value, "a.b")).toEqual({ c: 7 });
    expect(getByPath(value, "a.b.c")).toBe(7);
  });

  // 1.3
  it("walks bracket segments through arrays", () => {
    expect(getByPath({ a: [10, 20, 30] }, "a[0]")).toBe(10);
    expect(getByPath({ a: [10, 20, 30] }, "a[2]")).toBe(30);
    // Leading bracket — value itself is an array.
    expect(getByPath([10, 20, 30], "[1]")).toBe(20);
  });

  // 1.4
  it("walks mixed dot + bracket segments", () => {
    const value = { matches: [{ score: 0.9 }, { score: 0.7 }] };
    expect(getByPath(value, "matches[0].score")).toBe(0.9);
    expect(getByPath(value, "matches[1].score")).toBe(0.7);
  });

  // 1.5
  it("returns undefined for missing keys and out-of-bounds indices", () => {
    expect(getByPath({ a: 1 }, "b")).toBeUndefined();
    expect(getByPath({ a: 1 }, "a.b.c")).toBeUndefined();
    expect(getByPath({ a: [10] }, "a[5]")).toBeUndefined();
    // Walking into a primitive resolves to undefined, not a throw.
    expect(getByPath(42, "a")).toBeUndefined();
    // Walking through null mid-path resolves to undefined.
    expect(getByPath({ a: null }, "a.b")).toBeUndefined();
  });
});

// ── shapeWritesForRecord (cases 1.6–1.10) ────────────────────────────

const TARGET_A = "ce-target-a";
const TARGET_B = "ce-target-b";

describe("shapeWritesForRecord", () => {
  // 1.6
  it("shapes a single tool_result write into one target+column entry", () => {
    const writes: BulkTransformWrite[] = [
      {
        targetConnectorEntityId: TARGET_A,
        column: "c_distance",
        valueFrom: { kind: "tool_result" },
      },
    ];
    const result = shapeWritesForRecord(writes, 42, {}, null);
    expect(result.size).toBe(1);
    expect(result.get(TARGET_A)).toEqual({ c_distance: 42 });
  });

  // 1.7
  it("groups two writes against the same target into one map entry", () => {
    const writes: BulkTransformWrite[] = [
      {
        targetConnectorEntityId: TARGET_A,
        column: "c_km",
        valueFrom: { kind: "tool_path", path: "km" },
      },
      {
        targetConnectorEntityId: TARGET_A,
        column: "c_miles",
        valueFrom: { kind: "tool_path", path: "miles" },
      },
    ];
    const result = shapeWritesForRecord(
      writes,
      { km: 5, miles: 3.1 },
      {},
      null
    );
    expect(result.size).toBe(1);
    expect(result.get(TARGET_A)).toEqual({ c_km: 5, c_miles: 3.1 });
  });

  // 1.8
  it("splits writes across different targets into separate map entries", () => {
    const writes: BulkTransformWrite[] = [
      {
        targetConnectorEntityId: TARGET_A,
        column: "c_km",
        valueFrom: { kind: "tool_path", path: "km" },
      },
      {
        targetConnectorEntityId: TARGET_B,
        column: "c_summary",
        valueFrom: { kind: "tool_result" },
      },
    ];
    const result = shapeWritesForRecord(
      writes,
      { km: 5, miles: 3.1 },
      {},
      null
    );
    expect(result.size).toBe(2);
    expect(result.get(TARGET_A)).toEqual({ c_km: 5 });
    expect(result.get(TARGET_B)).toEqual({ c_summary: { km: 5, miles: 3.1 } });
  });

  // 1.9
  it("resolves all five valueFrom kinds in a single pass", () => {
    const writes: BulkTransformWrite[] = [
      {
        targetConnectorEntityId: TARGET_A,
        column: "c_whole",
        valueFrom: { kind: "tool_result" },
      },
      {
        targetConnectorEntityId: TARGET_A,
        column: "c_km",
        valueFrom: { kind: "tool_path", path: "km" },
      },
      {
        targetConnectorEntityId: TARGET_A,
        column: "c_acreage",
        valueFrom: { kind: "sql_alias", alias: "acreage" },
      },
      {
        targetConnectorEntityId: TARGET_A,
        column: "c_id_copy",
        valueFrom: { kind: "source_column", column: "c_id" },
      },
      {
        targetConnectorEntityId: TARGET_A,
        column: "c_origin",
        valueFrom: { kind: "constant", value: "bulk_transform" },
      },
    ];
    const result = shapeWritesForRecord(
      writes,
      { km: 5 },
      { c_id: "p-7" },
      { acreage: 12.5 }
    );
    expect(result.get(TARGET_A)).toEqual({
      c_whole: { km: 5 },
      c_km: 5,
      c_acreage: 12.5,
      c_id_copy: "p-7",
      c_origin: "bulk_transform",
    });
  });

  // 1.10 — defensive guard
  it("throws when a tool_result write is requested but no tool result is provided", () => {
    const writes: BulkTransformWrite[] = [
      {
        targetConnectorEntityId: TARGET_A,
        column: "c_distance",
        valueFrom: { kind: "tool_result" },
      },
    ];
    expect(() => shapeWritesForRecord(writes, null, {}, null)).toThrow();
  });
});
