import { describe, it, expect } from "@jest/globals";

import {
  createAccumulator,
  updateAccumulator,
  finalizeAccumulator,
  MAX_UNIQUE_VALUES,
  MAX_SAMPLE_VALUES_PER_COLUMN,
} from "../../utils/column-stats.util.js";

describe("createAccumulator", () => {
  it("returns accumulator with name set and counters at zero", () => {
    const acc = createAccumulator("email");

    expect(acc.name).toBe("email");
    expect(acc.nullCount).toBe(0);
    expect(acc.totalCount).toBe(0);
    expect(acc.uniqueValues.size).toBe(0);
    expect(acc.uniqueCapped).toBe(false);
    expect(acc.maxLength).toBe(0);
    expect(acc.sampleValues).toEqual([]);
  });

  it("starts minLength at Infinity so first value always updates it", () => {
    const acc = createAccumulator("col");
    expect(acc.minLength).toBe(Infinity);
  });
});

describe("updateAccumulator", () => {
  it("increments totalCount per call", () => {
    const acc = createAccumulator("col");
    updateAccumulator(acc, "a");
    updateAccumulator(acc, "b");
    updateAccumulator(acc, "c");
    expect(acc.totalCount).toBe(3);
  });

  it("increments nullCount for empty or whitespace-only values", () => {
    const acc = createAccumulator("col");
    updateAccumulator(acc, "");
    updateAccumulator(acc, "   ");
    updateAccumulator(acc, "\t\n");
    updateAccumulator(acc, "value");

    expect(acc.totalCount).toBe(4);
    expect(acc.nullCount).toBe(3);
  });

  it("does not track null values as unique or sample", () => {
    const acc = createAccumulator("col");
    updateAccumulator(acc, "");
    updateAccumulator(acc, "  ");

    expect(acc.uniqueValues.size).toBe(0);
    expect(acc.sampleValues).toEqual([]);
  });

  it("tracks unique values until MAX_UNIQUE_VALUES then caps", () => {
    const acc = createAccumulator("col");
    for (let i = 0; i <= MAX_UNIQUE_VALUES; i++) {
      updateAccumulator(acc, `v${i}`);
    }
    expect(acc.uniqueCapped).toBe(true);

    const sizeAtCap = acc.uniqueValues.size;
    updateAccumulator(acc, "another");
    expect(acc.uniqueValues.size).toBe(sizeAtCap);
    expect(acc.uniqueCapped).toBe(true);
  });

  it("updates minLength and maxLength based on trimmed values", () => {
    const acc = createAccumulator("col");
    updateAccumulator(acc, "  hello  ");
    updateAccumulator(acc, "hi");
    updateAccumulator(acc, "goodbye");

    expect(acc.minLength).toBe(2);
    expect(acc.maxLength).toBe(7);
  });

  it("collects up to MAX_SAMPLE_VALUES_PER_COLUMN then stops", () => {
    const acc = createAccumulator("col");
    for (let i = 0; i < MAX_SAMPLE_VALUES_PER_COLUMN + 5; i++) {
      updateAccumulator(acc, `val${i}`);
    }
    expect(acc.sampleValues).toHaveLength(MAX_SAMPLE_VALUES_PER_COLUMN);
    expect(acc.sampleValues[0]).toBe("val0");
    expect(acc.sampleValues[MAX_SAMPLE_VALUES_PER_COLUMN - 1]).toBe(
      `val${MAX_SAMPLE_VALUES_PER_COLUMN - 1}`,
    );
  });
});

describe("finalizeAccumulator", () => {
  it("computes nullRate as nullCount / totalCount", () => {
    const acc = createAccumulator("col");
    updateAccumulator(acc, "a");
    updateAccumulator(acc, "b");
    updateAccumulator(acc, "");
    updateAccumulator(acc, "");

    const stat = finalizeAccumulator(acc);
    expect(stat.nullRate).toBe(0.5);
  });

  it("converts uniqueValues Set to numeric uniqueCount", () => {
    const acc = createAccumulator("col");
    updateAccumulator(acc, "a");
    updateAccumulator(acc, "b");
    updateAccumulator(acc, "a");

    const stat = finalizeAccumulator(acc);
    expect(stat.uniqueCount).toBe(2);
  });

  it("propagates uniqueCapped flag", () => {
    const acc = createAccumulator("col");
    for (let i = 0; i <= MAX_UNIQUE_VALUES; i++) updateAccumulator(acc, `v${i}`);

    const stat = finalizeAccumulator(acc);
    expect(stat.uniqueCapped).toBe(true);
  });

  it("returns ColumnStat shape with all required fields", () => {
    const acc = createAccumulator("email");
    updateAccumulator(acc, "a@b.com");
    updateAccumulator(acc, "");

    const stat = finalizeAccumulator(acc);
    expect(stat).toEqual({
      name: "email",
      nullCount: 1,
      totalCount: 2,
      nullRate: 0.5,
      uniqueCount: 1,
      uniqueCapped: false,
      minLength: 7,
      maxLength: 7,
      sampleValues: ["a@b.com"],
    });
  });

  it("handles zero-row accumulator without division by zero", () => {
    const acc = createAccumulator("empty");
    const stat = finalizeAccumulator(acc);

    expect(stat.totalCount).toBe(0);
    expect(stat.nullCount).toBe(0);
    expect(stat.nullRate).toBe(0);
    expect(stat.uniqueCount).toBe(0);
    expect(stat.minLength).toBe(0);
    expect(stat.maxLength).toBe(0);
    expect(stat.sampleValues).toEqual([]);
  });
});
