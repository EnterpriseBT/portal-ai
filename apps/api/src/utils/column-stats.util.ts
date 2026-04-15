import type { ColumnStat } from "@portalai/core/models";

/** Maximum unique values to track per column before marking as capped. */
export const MAX_UNIQUE_VALUES = 1_000;

/** Maximum sample values to store per column stat. */
export const MAX_SAMPLE_VALUES_PER_COLUMN = 10;

export interface ColumnAccumulator {
  name: string;
  nullCount: number;
  totalCount: number;
  uniqueValues: Set<string>;
  uniqueCapped: boolean;
  minLength: number;
  maxLength: number;
  sampleValues: string[];
}

export function createAccumulator(name: string): ColumnAccumulator {
  return {
    name,
    nullCount: 0,
    totalCount: 0,
    uniqueValues: new Set(),
    uniqueCapped: false,
    minLength: Infinity,
    maxLength: 0,
    sampleValues: [],
  };
}

export function updateAccumulator(acc: ColumnAccumulator, value: string): void {
  acc.totalCount++;
  const trimmed = value.trim();

  if (trimmed === "") {
    acc.nullCount++;
    return;
  }

  const len = trimmed.length;
  if (len < acc.minLength) acc.minLength = len;
  if (len > acc.maxLength) acc.maxLength = len;

  if (!acc.uniqueCapped) {
    acc.uniqueValues.add(trimmed);
    if (acc.uniqueValues.size > MAX_UNIQUE_VALUES) {
      acc.uniqueCapped = true;
    }
  }

  if (acc.sampleValues.length < MAX_SAMPLE_VALUES_PER_COLUMN) {
    acc.sampleValues.push(trimmed);
  }
}

export function finalizeAccumulator(acc: ColumnAccumulator): ColumnStat {
  return {
    name: acc.name,
    nullCount: acc.nullCount,
    totalCount: acc.totalCount,
    nullRate: acc.totalCount > 0 ? acc.nullCount / acc.totalCount : 0,
    uniqueCount: acc.uniqueValues.size,
    uniqueCapped: acc.uniqueCapped,
    minLength: acc.minLength === Infinity ? 0 : acc.minLength,
    maxLength: acc.maxLength,
    sampleValues: acc.sampleValues,
  };
}
